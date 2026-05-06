'use strict';
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { 
  MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_URL,
  DEFAULT_CLAUDE_MODEL, DEFAULT_POLL_INTERVAL, DEFAULT_REPLY_DELAY_MIN,
  DEFAULT_REPLY_DELAY_MAX, DEFAULT_HUMAN_REVIEW, DEFAULT_HISTORY_LIMIT 
} = require('./config');

let _pool;

async function getPool() {
  if (!_pool) {
    const config = MYSQL_URL || {
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };
    _pool = mysql.createPool(config);
  }
  return _pool;
}

async function initDb() {
  const pool = await getPool();
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id                         VARCHAR(255) PRIMARY KEY,
      name                       VARCHAR(255) NOT NULL UNIQUE,
      enabled                    TINYINT(1) NOT NULL DEFAULT 1,
      of_user_id                 VARCHAR(255) NOT NULL,
      of_cookie_encrypted        TEXT NOT NULL,
      of_x_bc_encrypted          TEXT NOT NULL,
      anthropic_api_key_encrypted TEXT,
      claude_model               VARCHAR(255) NOT NULL DEFAULT '${DEFAULT_CLAUDE_MODEL}',
      system_prompt              TEXT NOT NULL,
      poll_interval_seconds      INT NOT NULL DEFAULT ${DEFAULT_POLL_INTERVAL},
      reply_delay_min_seconds    INT NOT NULL DEFAULT ${DEFAULT_REPLY_DELAY_MIN},
      reply_delay_max_seconds    INT NOT NULL DEFAULT ${DEFAULT_REPLY_DELAY_MAX},
      history_limit              INT NOT NULL DEFAULT ${DEFAULT_HISTORY_LIMIT},
      human_review_mode          TINYINT(1) NOT NULL DEFAULT ${DEFAULT_HUMAN_REVIEW ? 1 : 0},
      created_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS replied_messages (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id   VARCHAR(255) NOT NULL,
      message_id  VARCHAR(255) NOT NULL,
      replied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, message_id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_drafts (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id        VARCHAR(255) NOT NULL,
      fan_user_id      VARCHAR(255) NOT NULL,
      message_id       VARCHAR(255) NOT NULL,
      fan_message_text TEXT NOT NULL,
      draft_reply      TEXT NOT NULL,
      status           VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id    VARCHAR(255) NOT NULL,
      fan_user_id  VARCHAR(255) NOT NULL,
      fan_name     VARCHAR(255),
      blocked_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, fan_user_id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

async function createTenant(fields) {
  const id = crypto.randomBytes(16).toString('hex');
  const pool = await getPool();
  
  await pool.query(`
    INSERT INTO tenants (id, name, of_user_id, of_cookie_encrypted, of_x_bc_encrypted,
      anthropic_api_key_encrypted, claude_model, system_prompt, poll_interval_seconds,
      reply_delay_min_seconds, reply_delay_max_seconds, history_limit, human_review_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, fields.name, fields.of_user_id, fields.of_cookie_encrypted, fields.of_x_bc_encrypted,
    fields.anthropic_api_key_encrypted, fields.claude_model, fields.system_prompt, 
    fields.poll_interval_seconds, fields.reply_delay_min_seconds, 
    fields.reply_delay_max_seconds, fields.history_limit, fields.human_review_mode
  ]);
  
  return id;
}

async function getTenant(id) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [id]);
  return rows[0] || null;
}

async function getTenantByName(name) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM tenants WHERE name = ?', [name]);
  return rows[0] || null;
}

async function getAllTenants() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM tenants ORDER BY created_at');
  return rows;
}

async function getEnabledTenants() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM tenants WHERE enabled = 1');
  return rows;
}

async function updateTenant(id, fields) {
  const pool = await getPool();
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = Object.values(fields);
  values.push(id);
  
  await pool.query(`UPDATE tenants SET ${sets} WHERE id = ?`, values);
}

async function deleteTenant(id) {
  const pool = await getPool();
  await pool.query('DELETE FROM tenants WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Replied messages
// ---------------------------------------------------------------------------

async function alreadyReplied(tenantId, messageId) {
  const pool = await getPool();
  const [rows] = await pool.query(
    'SELECT 1 FROM replied_messages WHERE tenant_id = ? AND message_id = ?',
    [tenantId, messageId]
  );
  return rows.length > 0;
}

async function markReplied(tenantId, messageId) {
  const pool = await getPool();
  await pool.query(
    'INSERT IGNORE INTO replied_messages (tenant_id, message_id) VALUES (?, ?)',
    [tenantId, messageId]
  );
}

// ---------------------------------------------------------------------------
// Pending drafts
// ---------------------------------------------------------------------------

async function queuePendingDraft({ tenantId, fanUserId, messageId, fanText, draft }) {
  const pool = await getPool();
  const [result] = await pool.query(`
    INSERT INTO pending_drafts (tenant_id, fan_user_id, message_id, fan_message_text, draft_reply)
    VALUES (?, ?, ?, ?, ?)
  `, [tenantId, fanUserId, messageId, fanText, draft]);
  return result.insertId;
}

async function getPendingDrafts(tenantId = null) {
  const pool = await getPool();
  if (tenantId) {
    const [rows] = await pool.query(
      "SELECT * FROM pending_drafts WHERE status = 'pending' AND tenant_id = ? ORDER BY created_at",
      [tenantId]
    );
    return rows;
  }
  const [rows] = await pool.query(
    "SELECT * FROM pending_drafts WHERE status = 'pending' ORDER BY created_at"
  );
  return rows;
}

async function getDraft(id) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM pending_drafts WHERE id = ?', [id]);
  return rows[0] || null;
}

async function updateDraftStatus(id, status, newReply = null) {
  const pool = await getPool();
  if (newReply !== null) {
    await pool.query(
      "UPDATE pending_drafts SET status = ?, draft_reply = ? WHERE id = ?",
      [status, newReply, id]
    );
  } else {
    await pool.query(
      "UPDATE pending_drafts SET status = ? WHERE id = ?",
      [status, id]
    );
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

async function getStats() {
  const pool = await getPool();
  
  const [activeTenants] = await pool.query('SELECT COUNT(*) as count FROM tenants WHERE enabled = 1');
  const [pendingDrafts] = await pool.query("SELECT COUNT(*) as count FROM pending_drafts WHERE status = 'pending'");
  const [blockedUsers] = await pool.query('SELECT COUNT(*) as count FROM blocked_users');
  const [repliedToday] = await pool.query("SELECT COUNT(*) as count FROM replied_messages WHERE replied_at >= CURDATE()");

  return {
    active_tenants: activeTenants[0].count,
    pending_drafts: pendingDrafts[0].count,
    blocked_users: blockedUsers[0].count,
    replied_today: repliedToday[0].count
  };
}

// ---------------------------------------------------------------------------
// Blocked Users
// ---------------------------------------------------------------------------

async function getBlockedUsers() {
  const pool = await getPool();
  const [rows] = await pool.query(`
    SELECT b.*, t.name as tenant_name 
    FROM blocked_users b
    JOIN tenants t ON b.tenant_id = t.id
    ORDER BY b.blocked_at DESC
  `);
  return rows;
}

async function blockUser(tenantId, fanUserId, fanName = null) {
  const pool = await getPool();
  await pool.query(`
    INSERT IGNORE INTO blocked_users (tenant_id, fan_user_id, fan_name)
    VALUES (?, ?, ?)
  `, [tenantId, fanUserId, fanName]);
}

async function unblockUser(tenantId, fanUserId) {
  const pool = await getPool();
  await pool.query('DELETE FROM blocked_users WHERE tenant_id = ? AND fan_user_id = ?', [tenantId, fanUserId]);
}

async function isBlocked(tenantId, fanUserId) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT 1 FROM blocked_users WHERE tenant_id = ? AND fan_user_id = ?', [tenantId, fanUserId]);
  return rows.length > 0;
}

module.exports = {
  initDb, createTenant, getTenant, getTenantByName, getAllTenants,
  getEnabledTenants, updateTenant, deleteTenant,
  alreadyReplied, markReplied,
  queuePendingDraft, getPendingDrafts, getDraft, updateDraftStatus,
  getStats, getBlockedUsers, blockUser, unblockUser, isBlocked
};
