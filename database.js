'use strict';
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { DATABASE_FILE, DEFAULT_CLAUDE_MODEL, DEFAULT_POLL_INTERVAL, DEFAULT_REPLY_DELAY_MIN,
  DEFAULT_REPLY_DELAY_MAX, DEFAULT_HUMAN_REVIEW, DEFAULT_HISTORY_LIMIT, DEFAULT_SYSTEM_PROMPT } = require('./config');

let _db;

function db() {
  if (!_db) {
    _db = new Database(DATABASE_FILE);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

function initDb() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id                         TEXT PRIMARY KEY,
      name                       TEXT NOT NULL UNIQUE,
      enabled                    INTEGER NOT NULL DEFAULT 1,
      of_user_id                 TEXT NOT NULL,
      of_cookie_encrypted        TEXT NOT NULL,
      of_x_bc_encrypted          TEXT NOT NULL,
      anthropic_api_key_encrypted TEXT,
      claude_model               TEXT NOT NULL DEFAULT '${DEFAULT_CLAUDE_MODEL}',
      system_prompt              TEXT NOT NULL DEFAULT '',
      poll_interval_seconds      INTEGER NOT NULL DEFAULT ${DEFAULT_POLL_INTERVAL},
      reply_delay_min_seconds    INTEGER NOT NULL DEFAULT ${DEFAULT_REPLY_DELAY_MIN},
      reply_delay_max_seconds    INTEGER NOT NULL DEFAULT ${DEFAULT_REPLY_DELAY_MAX},
      history_limit              INTEGER NOT NULL DEFAULT ${DEFAULT_HISTORY_LIMIT},
      human_review_mode          INTEGER NOT NULL DEFAULT ${DEFAULT_HUMAN_REVIEW ? 1 : 0},
      created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS replied_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      message_id  TEXT NOT NULL,
      replied_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tenant_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS pending_drafts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      fan_user_id      TEXT NOT NULL,
      message_id       TEXT NOT NULL,
      fan_message_text TEXT NOT NULL,
      draft_reply      TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

function createTenant(fields) {
  const id = crypto.randomBytes(16).toString('hex');
  db().prepare(`
    INSERT INTO tenants (id, name, of_user_id, of_cookie_encrypted, of_x_bc_encrypted,
      anthropic_api_key_encrypted, claude_model, system_prompt, poll_interval_seconds,
      reply_delay_min_seconds, reply_delay_max_seconds, history_limit, human_review_mode)
    VALUES (@id, @name, @of_user_id, @of_cookie_encrypted, @of_x_bc_encrypted,
      @anthropic_api_key_encrypted, @claude_model, @system_prompt, @poll_interval_seconds,
      @reply_delay_min_seconds, @reply_delay_max_seconds, @history_limit, @human_review_mode)
  `).run({ id, ...fields });
  return id;
}

function getTenant(id) {
  return db().prepare('SELECT * FROM tenants WHERE id = ?').get(id) || null;
}

function getTenantByName(name) {
  return db().prepare('SELECT * FROM tenants WHERE name = ?').get(name) || null;
}

function getAllTenants() {
  return db().prepare('SELECT * FROM tenants ORDER BY created_at').all();
}

function getEnabledTenants() {
  return db().prepare('SELECT * FROM tenants WHERE enabled = 1').all();
}

function updateTenant(id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  db().prepare(`UPDATE tenants SET ${sets}, updated_at = datetime('now') WHERE id = @id`)
    .run({ id, ...fields });
}

function deleteTenant(id) {
  db().prepare('DELETE FROM tenants WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Replied messages
// ---------------------------------------------------------------------------

function alreadyReplied(tenantId, messageId) {
  return !!db().prepare(
    'SELECT 1 FROM replied_messages WHERE tenant_id = ? AND message_id = ?'
  ).get(tenantId, messageId);
}

function markReplied(tenantId, messageId) {
  db().prepare(
    'INSERT OR IGNORE INTO replied_messages (tenant_id, message_id) VALUES (?, ?)'
  ).run(tenantId, messageId);
}

// ---------------------------------------------------------------------------
// Pending drafts
// ---------------------------------------------------------------------------

function queuePendingDraft({ tenantId, fanUserId, messageId, fanText, draft }) {
  const result = db().prepare(`
    INSERT INTO pending_drafts (tenant_id, fan_user_id, message_id, fan_message_text, draft_reply)
    VALUES (?, ?, ?, ?, ?)
  `).run(tenantId, fanUserId, messageId, fanText, draft);
  return result.lastInsertRowid;
}

function getPendingDrafts(tenantId = null) {
  if (tenantId) {
    return db().prepare(
      "SELECT * FROM pending_drafts WHERE status = 'pending' AND tenant_id = ? ORDER BY created_at"
    ).all(tenantId);
  }
  return db().prepare(
    "SELECT * FROM pending_drafts WHERE status = 'pending' ORDER BY created_at"
  ).all();
}

function getDraft(id) {
  return db().prepare('SELECT * FROM pending_drafts WHERE id = ?').get(id) || null;
}

function updateDraftStatus(id, status, newReply = null) {
  if (newReply !== null) {
    db().prepare(
      "UPDATE pending_drafts SET status = ?, draft_reply = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, newReply, id);
  } else {
    db().prepare(
      "UPDATE pending_drafts SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, id);
  }
}

function isBlocked(tenantId, fanUserId) {
  return !!db().prepare(
    'SELECT 1 FROM blocked_users WHERE tenant_id = ? AND fan_user_id = ?'
  ).get(tenantId, String(fanUserId));
}

module.exports = {
  initDb, createTenant, getTenant, getTenantByName, getAllTenants,
  getEnabledTenants, updateTenant, deleteTenant,
  alreadyReplied, markReplied,
  queuePendingDraft, getPendingDrafts, getDraft, updateDraftStatus,
  isBlocked,
};
