#!/usr/bin/env node
'use strict';
/**
 * Export fan→creator message pairs as training data.
 *
 *   node exportTrainingData.js --tenant-id <id>
 *   node exportTrainingData.js --all
 */

const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer') || {};
const { initDb, getEnabledTenants, getTenant } = require('./database');
const OFClient = require('./ofClient');
const { getLogger } = require('./logger');
const { EXPORT_DIR } = require('./config');

const log = getLogger('export');

function extractPairs(messages) {
  const pairs = [];
  let pending = null;
  for (const msg of messages) {
    const text = (msg.text || '').trim();
    if (!text) continue;
    if (msg.fromUser) {
      pending = text;
    } else if (pending !== null) {
      pairs.push({ fan: pending, creator: text });
      pending = null;
    }
  }
  return pairs;
}

function toJsonlLine(pair, systemPrompt) {
  return JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: pair.fan },
      { role: 'assistant', content: pair.creator },
    ],
  });
}

async function exportTenant(tenant) {
  log.info(`Exporting tenant '${tenant.name}'`);
  let client;
  try {
    client = new OFClient(tenant, log);
  } catch (err) {
    log.error(`Cannot init OF client for ${tenant.name}: ${err.message}`);
    return 0;
  }

  const chats = await client.getChats();
  log.info(`Tenant ${tenant.name} — ${chats.length} chats`);

  const allPairs = [];
  for (const chat of chats) {
    const fanId = String(chat?.withUser?.id || '');
    if (!fanId) continue;
    const msgs = await client.getMessages(fanId, 100);
    allPairs.push(...extractPairs(msgs));
  }

  if (!allPairs.length) {
    log.warn(`Tenant ${tenant.name} — no pairs extracted`);
    return 0;
  }

  const safeName = tenant.name.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const outDir = path.join(EXPORT_DIR, safeName);
  fs.mkdirSync(outDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonlPath = path.join(outDir, `${ts}_training.jsonl`);
  const csvPath = path.join(outDir, `${ts}_training.csv`);

  // Write JSONL
  const jsonlLines = allPairs.map(p => toJsonlLine(p, tenant.system_prompt));
  fs.writeFileSync(jsonlPath, jsonlLines.join('\n') + '\n', 'utf8');

  // Write CSV
  const csvHeader = 'fan,creator\n';
  const csvRows = allPairs
    .map(p => `"${p.fan.replace(/"/g, '""')}","${p.creator.replace(/"/g, '""')}"`)
    .join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvRows + '\n', 'utf8');

  console.log(`[${tenant.name}] ${allPairs.length} examples → ${jsonlPath}`);
  return allPairs.length;
}

async function main() {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');
  const tenantIdIdx = args.indexOf('--tenant-id');
  const tenantId = tenantIdIdx !== -1 ? args[tenantIdIdx + 1] : null;

  if (!allFlag && !tenantId) {
    console.error('Usage: node exportTrainingData.js --tenant-id <id> | --all');
    process.exit(1);
  }

  initDb();

  const tenants = allFlag ? getEnabledTenants() : [getTenant(tenantId)].filter(Boolean);
  if (!tenants.length) { console.error('No tenants found'); process.exit(1); }

  let total = 0;
  for (const t of tenants) total += await exportTenant(t);

  console.log(`\n${'='.repeat(60)}\nDone — ${total} examples across ${tenants.length} tenant(s)\n${'='.repeat(60)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
