'use strict';
const { getEnabledTenants, getTenant, alreadyReplied, markReplied, queuePendingDraft, isBlocked } = require('./database');
const { generateReply } = require('./claudeClient');
const OFClient = require('./ofClient');
const { getLogger, getTenantLogger } = require('./logger');
const { TENANT_REFRESH_INTERVAL, MAX_CONCURRENT_TENANTS } = require('./config');

const log = getLogger('scheduler');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isFromFan(msg, fanId) {
  // 1. OnlyFansAPI.com uses is_from_me: false for fans
  if (msg.is_from_me === false) return true;
  
  // 2. Standard OF uses fromUser: true for fans
  if (msg.fromUser === true) return true;
  
  // 3. OnlyFansAPI.com Message History uses fromUser as an object
  if (msg.fromUser && typeof msg.fromUser === 'object' && fanId) {
    if (String(msg.fromUser.id) === String(fanId)) return true;
  }
  
  return false;
}

function buildConversation(messages, fanId) {
  const history = [];
  for (const msg of messages) {
    let text = (msg.text || '').trim();
    // Strip HTML tags (like <p>) so Claude only sees the plain text
    text = text.replace(/<[^>]*>/g, '');
    if (!text) continue;
    
    const role = isFromFan(msg, fanId) ? 'user' : 'assistant';
    if (history.length > 0 && history[history.length - 1].role === role) {
      history[history.length - 1].content += `\n${text}`;
    } else {
      history.push({ role, content: text });
    }
  }
  return history;
}

// ---------------------------------------------------------------------------
// Per-tenant worker
// ---------------------------------------------------------------------------

class TenantWorker {
  constructor(tenant) {
    this.tenantId = tenant.id;
    this.tenantName = tenant.name;
    this.log = getTenantLogger(tenant.id, tenant.name);
    this._stopped = false;
    this._ofClient = null;
    this._activeFanProcesses = new Set(); // Track fanIds currently being processed
  }

  stop() {
    this._stopped = true;
  }

  _ensureOFClient(tenant) {
    if (!this._ofClient) {
      this._ofClient = new OFClient(tenant, this.log);
    }
    return this._ofClient;
  }

  async run() {
    // Stagger startup so all tenants don't hit OF API at once
    await sleep(randInt(0, 5000));
    this.log.info(`Worker started for tenant '${this.tenantName}'`);

    while (!this._stopped) {
      const tenant = await getTenant(this.tenantId);
      if (!tenant || !tenant.enabled) {
        this.log.info('Tenant disabled or removed — stopping worker');
        return;
      }

      try {
        await this._pollOnce(tenant);
      } catch (err) {
        this.log.error(`Poll cycle error: ${err.message}`);
      }

      // Wait poll interval (or stop signal)
      await sleep(tenant.poll_interval_seconds * 1000);
    }
  }

  async _pollOnce(tenant) {
    let client;
    try {
      client = this._ensureOFClient(tenant);
    } catch (err) {
      this.log.error(`Cannot init OF client: ${err.message}`);
      return;
    }

    const chats = await client.getChats();
    const fanNames = chats.map(c => {
      const f = c.fan;
      return f?.name || f?.username || 'Unknown';
    }).join(', ');
    
    this.log.info(`Fetched ${chats.length} chats: [${fanNames}]`);

    // Trigger processing for all chats in parallel
    for (const chat of chats) {
      if (this._stopped) return;
      // Start processing without awaiting so multiple chats can run simultaneously
      this._processChat(tenant, client, chat).catch(err => {
        this.log.error(`Unhandled error in processChat: ${err.message}`);
      });
    }
  }

  async _processChat(tenant, client, chat) {
    const fan = chat?.fan;
    const fanId = String(fan?.id || '');
    if (!fanId) return;

    const name = fan?.name || fan?.username || fanId;

    // Concurrency check: don't start a second process for a fan already in the "waiting delay" or "generating" phase
    if (this._activeFanProcesses.has(fanId)) {
      return;
    }

    try {
      this._activeFanProcesses.add(fanId);

    // Check if fan is blocked via the UI
      if (isBlocked(tenant.id, fanId)) {
        this.log.info(`Skipping ${name}: user is blocked in dashboard`);
        return;
      }

      // Diagnostic logs
      const unreadCount = chat?.unreadMessagesCount || chat?.unread_count || 0;
      const isFan = OFClient.lastMessageIsFromFan(chat);
      
      this.log.info(`Chat: ${name} | Unread: ${unreadCount} | From Fan: ${isFan}`);

      if (unreadCount === 0) return;
      
      this.log.info(`New unread message seen from ${name} (Count: ${unreadCount})`);

      if (!isFan) {
        this.log.info(`Skipping ${name}: Last message was NOT from fan.`);
        return;
      }

      this.log.info(`Fetching history for ${name}...`);
      const messages = await client.getMessages(fanId);
      this.log.info(`Fetched ${messages.length} messages for ${name}`);
      
      if (!messages.length) return;

      // Find the latest message from the fan
      const latestFanMsg = [...messages].reverse().find(m => isFromFan(m, fanId));
      if (!latestFanMsg) {
        this.log.info(`Skipping ${name}: No messages from fan found in history.`);
        return;
      }

      const messageId = String(latestFanMsg.id || '');
      if (!messageId) return;
      
      if (await alreadyReplied(tenant.id, messageId)) {
        this.log.info(`Skipping ${name}: Already replied to message ${messageId}`);
        return;
      }

      const conversation = buildConversation(messages, fanId);
      if (!conversation.length) {
         this.log.info(`Skipping ${name}: Conversation history is empty.`);
         return;
      }
      
      if (conversation[conversation.length - 1].role !== 'user') {
        this.log.info(`Skipping ${name}: Last message in history is from US, not the fan.`);
        return;
      }

      this.log.info(`Taking message from ${name}`);
      this.log.info(`Waiting for AI to generate reply for ${name}...`);
      const reply = await generateReply(tenant, conversation, this.log);
      if (!reply) {
        this.log.error(`Failed to get AI reply for ${name}.`);
        return;
      }

      this.log.info(`AI reply generated for ${name}: "${reply}"`);

      if (tenant.human_review_mode) {
        const draftId = await queuePendingDraft({
          tenantId: tenant.id,
          fanUserId: fanId,
          messageId,
          fanText: latestFanMsg.text || '',
          draft: reply,
        });
        this.log.info(`Draft #${draftId} queued for human review (fan=${name})`);
        return;
      }

      const delay = randInt(tenant.reply_delay_min_seconds, tenant.reply_delay_max_seconds);
      this.log.info(`Waiting ${delay}s before sending reply to ${name}...`);
      await sleep(delay * 1000);

      if (this._stopped) return;

      this.log.info(`Sending message to ${name}`);
      const sent = await client.sendMessage(fanId, reply);
      if (sent) {
        await markReplied(tenant.id, messageId);
        this.log.info(`Message successfully sent to ${name}`);
      }
    } catch (err) {
      this.log.error(`Error in processChat for ${name}: ${err.message}`);
    } finally {
      this._activeFanProcesses.delete(fanId);
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler — manages all tenant workers
// ---------------------------------------------------------------------------

class Scheduler {
  constructor() {
    this._workers = new Map(); // tenantId → { worker, promise }
    this._stopped = false;
    this._refreshTimer = null;
  }

  async start() {
    log.info('Scheduler starting');
    await this._refreshWorkers();
    this._refreshTimer = setInterval(async () => {
      try {
        await this._refreshWorkers();
      } catch (err) {
        log.error(`Worker refresh error: ${err.message}`);
      }
    }, TENANT_REFRESH_INTERVAL);
  }

  async _refreshWorkers() {
    const tenants = await getEnabledTenants();
    const activeIds = new Set(tenants.map(t => t.id));

    // Stop workers for removed/disabled tenants
    for (const [id, { worker }] of this._workers) {
      if (!activeIds.has(id)) {
        worker.stop();
        this._workers.delete(id);
        log.info(`Stopped worker for tenant ${id}`);
      }
    }

    // Start workers for new tenants
    for (const tenant of tenants) {
      if (this._workers.has(tenant.id)) continue;
      const worker = new TenantWorker(tenant);
      const promise = worker.run().catch(err =>
        log.error(`Worker for ${tenant.name} crashed: ${err.message}`)
      );
      this._workers.set(tenant.id, { worker, promise });
      log.info(`Started worker for tenant '${tenant.name}' (${tenant.id})`);
    }
  }

  stop() {
    this._stopped = true;
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    for (const { worker } of this._workers.values()) worker.stop();
    log.info('Scheduler stopped');
  }
}

module.exports = Scheduler;
