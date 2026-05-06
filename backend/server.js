'use strict';
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getLogger } = require('./logger');
const { encrypt, decrypt } = require('./crypto');
const {
  initDb, createTenant, getTenant, getTenantByName, getAllTenants,
  updateTenant, deleteTenant, getPendingDrafts, getDraft, updateDraftStatus,
  markReplied, getStats, getBlockedUsers, blockUser, unblockUser, isBlocked
} = require('./database');
const OFClient = require('./ofClient');
const config = require('./config');

const app = express();
const port = process.env.PORT || 3000;
const log = getLogger('api');

app.use(cors());
app.use(bodyParser.json());

let botProcess = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSafeTenant(t) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    enabled: !!t.enabled,
    of_user_id: t.of_user_id,
    claude_model: t.claude_model,
    system_prompt: t.system_prompt,
    poll_interval_seconds: t.poll_interval_seconds,
    reply_delay_min_seconds: t.reply_delay_min_seconds,
    reply_delay_max_seconds: t.reply_delay_max_seconds,
    history_limit: t.history_limit,
    human_review_mode: !!t.human_review_mode,
    created_at: t.created_at,
    updated_at: t.updated_at,
    has_cookie: !!t.of_cookie_encrypted,
    has_xbc: !!t.of_x_bc_encrypted,
    has_anthropic_key: !!t.anthropic_api_key_encrypted,
  };
}

async function getBotPidFallback() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('pgrep -f "node main.js"', (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const pid = parseInt(stdout.split('\n')[0], 10);
      resolve(pid || null);
    });
  });
}

// ---------------------------------------------------------------------------
// 7.1 Health
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 7.2 Stats
// ---------------------------------------------------------------------------

app.get('/api/stats', async (req, res) => {
  const stats = await getStats();
  const botPid = botProcess ? botProcess.pid : await getBotPidFallback();
  
  res.json({
    bot_status: botPid ? 'running' : 'stopped',
    bot_pid: botPid,
    active_tenants: stats.active_tenants,
    pending_drafts: stats.pending_drafts,
    replied_today: stats.replied_today,
    blocked_users: stats.blocked_users,
    encryption_key_set: !!config.ENCRYPTION_KEY,
    of_api_key_set: !!config.OF_API_KEY
  });
});

// ---------------------------------------------------------------------------
// 7.3 Bot Control
// ---------------------------------------------------------------------------

app.get('/api/bot/status', async (req, res) => {
  const botPid = botProcess ? botProcess.pid : await getBotPidFallback();
  res.json({
    status: botPid ? 'running' : 'stopped',
    pid: botPid
  });
});

app.post('/api/bot/start', async (req, res) => {
  const botPid = botProcess ? botProcess.pid : await getBotPidFallback();
  if (botPid) {
    return res.json({ status: 'already_running' });
  }

  log.info('Starting bot process...');
  botProcess = spawn('node', ['main.js'], {
    cwd: config.BASE_DIR,
    env: process.env,
    detached: true,
    stdio: 'ignore'
  });

  botProcess.unref();

  botProcess.on('exit', () => {
    log.info('Bot process exited.');
    botProcess = null;
  });

  res.json({ status: 'started', pid: botProcess.pid });
});

app.post('/api/bot/stop', async (req, res) => {
  let pid = botProcess ? botProcess.pid : await getBotPidFallback();
  
  if (!pid) {
    return res.json({ status: 'not_running' });
  }

  log.info(`Stopping bot process (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
    
    // Wait up to 5s for it to exit
    let exited = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      const currentPid = botProcess ? botProcess.pid : await getBotPidFallback();
      if (!currentPid) {
        exited = true;
        break;
      }
    }

    if (!exited) {
      log.warn(`Bot process (PID: ${pid}) didn't exit after 5s, sending SIGKILL.`);
      process.kill(pid, 'SIGKILL');
    }

    botProcess = null;
    res.json({ status: 'stopped' });
  } catch (err) {
    log.error(`Failed to stop bot: ${err.message}`);
    res.status(500).json({ detail: `Failed to stop bot: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// 7.4 Tenants (Accounts)
// ---------------------------------------------------------------------------

app.get('/api/tenants', async (req, res) => {
  const tenants = await getAllTenants();
  res.json(tenants.map(toSafeTenant));
});

app.post('/api/tenants', async (req, res) => {
  const body = req.body;
  if (!body.name || !body.of_user_id) {
    return res.status(400).json({ detail: 'Missing name or of_user_id' });
  }

  if (await getTenantByName(body.name)) {
    return res.status(400).json({ detail: `Tenant '${body.name}' already exists` });
  }

  try {
    const fields = {
      name: body.name,
      of_user_id: body.of_user_id,
      of_cookie_encrypted: body.of_cookie ? encrypt(body.of_cookie) : '',
      of_x_bc_encrypted: body.of_x_bc ? encrypt(body.of_x_bc) : '',
      anthropic_api_key_encrypted: body.anthropic_api_key ? encrypt(body.anthropic_api_key) : null,
      claude_model: body.claude_model || config.DEFAULT_CLAUDE_MODEL,
      system_prompt: body.system_prompt || config.DEFAULT_SYSTEM_PROMPT,
      poll_interval_seconds: body.poll_interval_seconds || config.DEFAULT_POLL_INTERVAL,
      reply_delay_min_seconds: body.reply_delay_min_seconds || config.DEFAULT_REPLY_DELAY_MIN,
      reply_delay_max_seconds: body.reply_delay_max_seconds || config.DEFAULT_REPLY_DELAY_MAX,
      history_limit: body.history_limit || config.DEFAULT_HISTORY_LIMIT,
      human_review_mode: body.human_review_mode ? 1 : 0,
    };

    const id = await createTenant(fields);
    res.status(201).json(toSafeTenant(await getTenant(id)));
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/tenants/:id', async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });
  res.json(toSafeTenant(t));
});

app.put('/api/tenants/:id', async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });

  const body = req.body;
  const fields = {};

  if (body.name !== undefined) fields.name = body.name;
  if (body.of_user_id !== undefined) fields.of_user_id = body.of_user_id;
  if (body.of_cookie !== undefined) fields.of_cookie_encrypted = encrypt(body.of_cookie);
  if (body.of_x_bc !== undefined) fields.of_x_bc_encrypted = encrypt(body.of_x_bc);
  if (body.anthropic_api_key !== undefined) fields.anthropic_api_key_encrypted = encrypt(body.anthropic_api_key);
  if (body.claude_model !== undefined) fields.claude_model = body.claude_model;
  if (body.system_prompt !== undefined) fields.system_prompt = body.system_prompt;
  if (body.poll_interval_seconds !== undefined) fields.poll_interval_seconds = body.poll_interval_seconds;
  if (body.reply_delay_min_seconds !== undefined) fields.reply_delay_min_seconds = body.reply_delay_min_seconds;
  if (body.reply_delay_max_seconds !== undefined) fields.reply_delay_max_seconds = body.reply_delay_max_seconds;
  if (body.history_limit !== undefined) fields.history_limit = body.history_limit;
  if (body.human_review_mode !== undefined) fields.human_review_mode = body.human_review_mode ? 1 : 0;

  if (Object.keys(fields).length > 0) {
    await updateTenant(req.params.id, fields);
  }

  res.json(toSafeTenant(await getTenant(req.params.id)));
});

app.delete('/api/tenants/:id', async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });
  await deleteTenant(req.params.id);
  res.json({ ok: true });
});

app.post('/api/tenants/:id/enable', async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });
  await updateTenant(req.params.id, { enabled: 1 });
  res.json(toSafeTenant(await getTenant(req.params.id)));
});

app.post('/api/tenants/:id/disable', async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });
  await updateTenant(req.params.id, { enabled: 0 });
  res.json(toSafeTenant(await getTenant(req.params.id)));
});

// ---------------------------------------------------------------------------
// 7.5 Chats (OnlyFans API Proxy)
// ---------------------------------------------------------------------------

app.get('/api/tenants/:id/chats', async (req, res) => {
  if (!config.OF_API_KEY) {
    return res.status(503).json({ detail: 'OF_API_KEY not configured in backend .env' });
  }
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });

  try {
    const client = new OFClient(t, log);
    const chats = await client.getChats();
    
    // Annotate with _blocked
    for (const chat of chats) {
      chat._blocked = await isBlocked(t.id, chat.fan.id);
    }
    
    res.json({ chats });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/tenants/:id/chats/:fan_id/messages', async (req, res) => {
  if (!config.OF_API_KEY) {
    return res.status(503).json({ detail: 'OF_API_KEY not configured in backend .env' });
  }
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });

  try {
    const client = new OFClient(t, log);
    const messages = await client.getMessages(req.params.fan_id, 30);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// 7.6 Blocked Users
// ---------------------------------------------------------------------------

app.get('/api/blocked', async (req, res) => {
  res.json(await getBlockedUsers());
});

app.post('/api/tenants/:id/block/:fan_id', async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });
  
  await blockUser(t.id, req.params.fan_id, req.query.fan_name || null);
  res.json({ ok: true });
});

app.delete('/api/tenants/:id/block/:fan_id', async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });
  
  await unblockUser(t.id, req.params.fan_id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 7.7 Pending Drafts
// ---------------------------------------------------------------------------

app.get('/api/drafts', async (req, res) => {
  const drafts = await getPendingDrafts(req.query.tenant_id || null);
  // Annotate with tenant_name
  const enrichedDrafts = [];
  for (const d of drafts) {
    const t = await getTenant(d.tenant_id);
    enrichedDrafts.push({ ...d, tenant_name: t ? t.name : 'Unknown' });
  }
  res.json(enrichedDrafts);
});

app.post('/api/drafts/:id/approve', async (req, res) => {
  const d = await getDraft(req.params.id);
  if (!d) return res.status(404).json({ detail: 'Draft not found' });

  const t = await getTenant(d.tenant_id);
  if (!t) return res.status(404).json({ detail: 'Tenant not found' });

  const finalReplyText = req.body.draft_reply || d.draft_reply;

  try {
    let sent = false;
    let error = null;

    if (config.OF_API_KEY) {
      const client = new OFClient(t, log);
      sent = await client.sendMessage(d.fan_user_id, finalReplyText);
      if (!sent) error = 'OnlyFans API call failed';
    } else {
      error = 'OF_API_KEY not set';
    }

    if (sent) {
      await updateDraftStatus(d.id, 'sent', finalReplyText);
      await markReplied(d.tenant_id, d.message_id);
    }

    res.json({ ok: true, sent, error });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/drafts/:id/reject', async (req, res) => {
  const d = await getDraft(req.params.id);
  if (!d) return res.status(404).json({ detail: 'Draft not found' });
  await updateDraftStatus(d.id, 'rejected');
  res.json({ ok: true });
});

app.put('/api/drafts/:id', async (req, res) => {
  const d = await getDraft(req.params.id);
  if (!d) return res.status(404).json({ detail: 'Draft not found' });
  
  if (req.body.draft_reply) {
    await updateDraftStatus(d.id, 'pending', req.body.draft_reply);
  }
  
  res.json(await getDraft(req.params.id));
});

// ---------------------------------------------------------------------------
// 7.8 Logs
// ---------------------------------------------------------------------------

function getLastLines(filePath, n) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    return lines.slice(-n);
  } catch (err) {
    log.error(`Error reading log file ${filePath}: ${err.message}`);
    return [];
  }
}

app.get('/api/logs', (req, res) => {
  const n = parseInt(req.query.n || '200', 10);
  const logFiles = fs.readdirSync(config.LOG_DIR)
    .filter(f => f.endsWith('.log'))
    .map(f => path.join(config.LOG_DIR, f));

  let allLines = [];
  for (const file of logFiles) {
    allLines = allLines.concat(getLastLines(file, n));
  }

  // Sort by timestamp (assuming standard Winston format: YYYY-MM-DD HH:mm:ss)
  allLines.sort();
  
  res.json({ lines: allLines.slice(-n) });
});

app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const mainLogFile = path.join(config.LOG_DIR, 'bot.log');
  
  // 1. Emit last 100 lines
  const initialLines = getLastLines(mainLogFile, 100);
  initialLines.forEach(line => {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  });

  // 2. Poll for changes
  let lastSize = fs.existsSync(mainLogFile) ? fs.statSync(mainLogFile).size : 0;
  
  const interval = setInterval(() => {
    if (!fs.existsSync(mainLogFile)) return;
    
    const stats = fs.statSync(mainLogFile);
    if (stats.size > lastSize) {
      const stream = fs.createReadStream(mainLogFile, { start: lastSize, end: stats.size });
      let data = '';
      stream.on('data', chunk => {
        data += chunk;
      });
      stream.on('end', () => {
        const newLines = data.trim().split('\n').filter(l => l);
        newLines.forEach(line => {
          res.write(`data: ${JSON.stringify({ line })}\n\n`);
        });
        lastSize = stats.size;
      });
    } else if (stats.size < lastSize) {
      // File truncated
      lastSize = stats.size;
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

async function startServer() {
  await initDb();
  app.listen(port, () => {
    log.info(`API Server listening on port ${port}`);
  });
}

startServer().catch(err => {
  log.error(`Failed to start server: ${err.message}`);
  process.exit(1);
});
