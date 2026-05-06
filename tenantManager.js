#!/usr/bin/env node
'use strict';
/**
 * CLI for managing tenants and reviewing pending drafts.
 */

const readline = require('readline');
const fs = require('fs');
const yargs = require('yargs');
const { encrypt, decrypt } = require('./crypto');
const {
  initDb, createTenant, getTenant, getTenantByName, getAllTenants,
  updateTenant, deleteTenant, getPendingDrafts, getDraft, updateDraftStatus, markReplied,
} = require('./database');
const OFClient = require('./ofClient');
const { getLogger } = require('./logger');
const {
  DEFAULT_CLAUDE_MODEL, DEFAULT_POLL_INTERVAL, DEFAULT_REPLY_DELAY_MIN,
  DEFAULT_REPLY_DELAY_MAX, DEFAULT_HUMAN_REVIEW, DEFAULT_HISTORY_LIMIT, DEFAULT_SYSTEM_PROMPT,
} = require('./config');

const log = getLogger('tenant_manager');

function parseBool(val) {
  if (val == null) return null;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(val).toLowerCase());
}

function printTenant(t, showSecrets = false) {
  console.log(`id              : ${t.id}`);
  console.log(`name            : ${t.name}`);
  console.log(`enabled         : ${!!t.enabled}`);
  console.log(`of_user_id      : ${t.of_user_id}`);
  console.log(`claude_model    : ${t.claude_model}`);
  console.log(`poll_interval   : ${t.poll_interval_seconds}s`);
  console.log(`reply_delay     : ${t.reply_delay_min_seconds}–${t.reply_delay_max_seconds}s`);
  console.log(`history_limit   : ${t.history_limit}`);
  console.log(`human_review    : ${!!t.human_review_mode}`);
  console.log(`prompt (first)  : ${(t.system_prompt || '').slice(0, 80)}…`);
  console.log(`created_at      : ${t.created_at}`);
  if (showSecrets) {
    console.log(`of_cookie       : ${decrypt(t.of_cookie_encrypted)}`);
    console.log(`of_x_bc         : ${decrypt(t.of_x_bc_encrypted)}`);
    if (t.anthropic_api_key_encrypted)
      console.log(`anthropic_key   : ${decrypt(t.anthropic_api_key_encrypted)}`);
  }
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdAdd(argv) {
  await initDb();
  if (await getTenantByName(argv.name)) {
    console.error(`Tenant '${argv.name}' already exists`); process.exit(1);
  }
  let prompt = argv.prompt || DEFAULT_SYSTEM_PROMPT;
  if (argv['prompt-file']) prompt = fs.readFileSync(argv['prompt-file'], 'utf8');

  const id = await createTenant({
    name: argv.name,
    of_user_id: argv['of-user-id'],
    of_cookie_encrypted: argv['of-cookie'] ? encrypt(argv['of-cookie']) : '',
    of_x_bc_encrypted: argv['of-x-bc'] ? encrypt(argv['of-x-bc']) : '',
    anthropic_api_key_encrypted: argv['anthropic-key'] ? encrypt(argv['anthropic-key']) : null,
    claude_model: argv.model || DEFAULT_CLAUDE_MODEL,
    system_prompt: prompt,
    poll_interval_seconds: argv.poll || DEFAULT_POLL_INTERVAL,
    reply_delay_min_seconds: argv['delay-min'] || DEFAULT_REPLY_DELAY_MIN,
    reply_delay_max_seconds: argv['delay-max'] || DEFAULT_REPLY_DELAY_MAX,
    history_limit: argv['history-limit'] || DEFAULT_HISTORY_LIMIT,
    human_review_mode: parseBool(argv['human-review']) ?? (DEFAULT_HUMAN_REVIEW ? 1 : 0),
  });
  console.log(`Created tenant ${id} (${argv.name})`);
  process.exit(0);
}

async function cmdList() {
  await initDb();
  const rows = await getAllTenants();
  if (!rows.length) { console.log('(no tenants)'); process.exit(0); }
  console.log(`${'ID'.padEnd(34)} ${'NAME'.padEnd(24)} ${'ON'.padEnd(5)} ${'POLL'.padEnd(6)} REVIEW`);
  for (const t of rows) {
    console.log(
      `${t.id.padEnd(34)} ${t.name.padEnd(24)} ${String(!!t.enabled).padEnd(5)} ` +
      `${String(t.poll_interval_seconds).padEnd(6)} ${!!t.human_review_mode}`
    );
  }
  process.exit(0);
}

async function cmdShow(argv) {
  await initDb();
  const t = await getTenant(argv.id);
  if (!t) { console.error(`Tenant ${argv.id} not found`); process.exit(1); }
  printTenant(t, !!argv.secrets);
  process.exit(0);
}

async function cmdUpdate(argv) {
  await initDb();
  const t = await getTenant(argv.id);
  if (!t) { console.error(`Tenant ${argv.id} not found`); process.exit(1); }
  const fields = {};
  if (argv.name)             fields.name = argv.name;
  if (argv['of-user-id'])    fields.of_user_id = argv['of-user-id'];
  if (argv['of-cookie'])     fields.of_cookie_encrypted = encrypt(argv['of-cookie']);
  if (argv['of-x-bc'])       fields.of_x_bc_encrypted = encrypt(argv['of-x-bc']);
  if (argv['anthropic-key']) fields.anthropic_api_key_encrypted = encrypt(argv['anthropic-key']);
  if (argv.model)            fields.claude_model = argv.model;
  if (argv.prompt)           fields.system_prompt = argv.prompt;
  if (argv['prompt-file'])   fields.system_prompt = fs.readFileSync(argv['prompt-file'], 'utf8');
  if (argv.poll)             fields.poll_interval_seconds = argv.poll;
  if (argv['delay-min'])     fields.reply_delay_min_seconds = argv['delay-min'];
  if (argv['delay-max'])     fields.reply_delay_max_seconds = argv['delay-max'];
  if (argv['history-limit']) fields.history_limit = argv['history-limit'];
  const hr = parseBool(argv['human-review']);
  if (hr !== null)           fields.human_review_mode = hr ? 1 : 0;
  if (!Object.keys(fields).length) { console.log('Nothing to update'); process.exit(0); }
  await updateTenant(argv.id, fields);
  console.log(`Updated tenant ${argv.id}`);
  process.exit(0);
}

async function cmdSetEnabled(id, enabled) {
  await initDb();
  const t = await getTenant(id);
  if (!t) { console.error(`Tenant ${id} not found`); process.exit(1); }
  await updateTenant(id, { enabled: enabled ? 1 : 0 });
  console.log(`Tenant ${id} enabled=${enabled}`);
  process.exit(0);
}

async function cmdDelete(argv) {
  await initDb();
  if (!await getTenant(argv.id)) { console.error(`Tenant ${argv.id} not found`); process.exit(1); }
  await deleteTenant(argv.id);
  console.log(`Deleted tenant ${argv.id}`);
  process.exit(0);
}

function cmdKeyGen() {
  console.log(require('crypto').randomBytes(32).toString('hex'));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Draft review
// ---------------------------------------------------------------------------

async function cmdDraftsList(argv) {
  await initDb();
  const drafts = await getPendingDrafts(argv.tenant || null);
  if (!drafts.length) { console.log('(no pending drafts)'); process.exit(0); }
  for (const d of drafts) {
    console.log(`#${d.id} tenant=${d.tenant_id.slice(0, 8)} fan=${d.fan_user_id} msg=${d.message_id}`);
    console.log(`  fan  : ${d.fan_message_text.slice(0, 120)}`);
    console.log(`  draft: ${d.draft_reply.slice(0, 120)}`);
    console.log();
  }
  process.exit(0);
}

async function cmdDraftsReview(argv) {
  await initDb();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  while (true) {
    const drafts = await getPendingDrafts(argv.tenant || null);
    if (!drafts.length) { console.log('(no more pending drafts)'); break; }
    const d = drafts[0];

    console.log('\n' + '='.repeat(60));
    console.log(`Draft #${d.id}  tenant=${d.tenant_id.slice(0, 8)}  fan=${d.fan_user_id}`);
    console.log(`Fan said   : ${d.fan_message_text}`);
    console.log(`Draft reply: ${d.draft_reply}`);
    console.log('='.repeat(60));

    const ans = (await ask(rl, '[a]pprove / [r]eject / [e]dit / [s]kip / [q]uit: ')).trim().toLowerCase();

    if (ans === 'q') break;
    if (ans === 's') continue;
    if (ans === 'r') { await updateDraftStatus(d.id, 'rejected'); console.log('Rejected.'); continue; }

    let replyText = d.draft_reply;
    if (ans === 'e') {
      replyText = (await ask(rl, 'New reply text: ')).trim();
      if (!replyText) { console.log('Empty — skipping.'); continue; }
      await updateDraftStatus(d.id, 'pending', replyText);
    }

    if (ans === 'a' || ans === 'e') {
      const tenant = await getTenant(d.tenant_id);
      if (!tenant) { await updateDraftStatus(d.id, 'rejected'); console.log('Tenant gone.'); continue; }
      const client = new OFClient(tenant, log);
      const ok = await client.sendMessage(d.fan_user_id, replyText);
      if (ok) {
        await markReplied(d.tenant_id, d.message_id);
        await updateDraftStatus(d.id, 'sent');
        console.log('Sent.');
      } else {
        console.log('Send failed — left as pending.');
      }
    }
  }
  rl.close();
  process.exit(0);
}

async function cmdDraftsApprove(argv) {
  await initDb();
  const d = await getDraft(argv.draftId);
  if (!d) { console.error(`Draft ${argv.draftId} not found`); process.exit(1); }
  const tenant = await getTenant(d.tenant_id);
  if (!tenant) { console.error('Tenant not found'); process.exit(1); }
  const client = new OFClient(tenant, log);
  const ok = await client.sendMessage(d.fan_user_id, d.draft_reply);
  if (ok) {
    await markReplied(d.tenant_id, d.message_id);
    await updateDraftStatus(d.id, 'sent');
    console.log('Sent.');
  } else {
    console.log('Send failed.');
  }
  process.exit(0);
}

async function cmdDraftsReject(argv) {
  await initDb();
  const d = await getDraft(argv.draftId);
  if (!d) { console.error(`Draft ${argv.draftId} not found`); process.exit(1); }
  await updateDraftStatus(d.id, 'rejected');
  console.log(`Draft ${argv.draftId} rejected.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

const commonTenantOpts = (y) => y
  .option('name', { type: 'string' })
  .option('of-user-id', { type: 'string' })
  .option('of-cookie', { type: 'string' })
  .option('of-x-bc', { type: 'string' })
  .option('anthropic-key', { type: 'string' })
  .option('model', { type: 'string' })
  .option('prompt', { type: 'string' })
  .option('prompt-file', { type: 'string' })
  .option('poll', { type: 'number' })
  .option('delay-min', { type: 'number' })
  .option('delay-max', { type: 'number' })
  .option('history-limit', { type: 'number' })
  .option('human-review', { type: 'string' });

yargs
  .command('add', 'Create a new tenant', (y) => commonTenantOpts(y)
    .demandOption(['name', 'of-user-id']),
    cmdAdd)
  .command('list', 'List all tenants', () => {}, cmdList)
  .command('show <id>', 'Show tenant details', (y) => y.option('secrets', { type: 'boolean' }), cmdShow)
  .command('update <id>', 'Update tenant fields', commonTenantOpts, cmdUpdate)
  .command('enable <id>', 'Enable a tenant', () => {}, (argv) => cmdSetEnabled(argv.id, true))
  .command('disable <id>', 'Disable a tenant', () => {}, (argv) => cmdSetEnabled(argv.id, false))
  .command('delete <id>', 'Delete a tenant', () => {}, cmdDelete)
  .command('keygen', 'Generate a new ENCRYPTION_KEY', () => {}, cmdKeyGen)
  .command('drafts', 'Manage pending drafts', (y) => {
    y.command('list', 'List pending drafts', (y2) => y2.option('tenant', { type: 'string' }), cmdDraftsList)
     .command('review', 'Interactively approve drafts', (y2) => y2.option('tenant', { type: 'string' }), (a) => cmdDraftsReview(a))
     .command('approve <draftId>', 'Approve and send a draft', () => {}, (a) => cmdDraftsApprove(a))
     .command('reject <draftId>', 'Reject a draft', () => {}, cmdDraftsReject)
     .demandCommand();
  })
  .demandCommand()
  .help()
  .argv;
