'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const { decrypt } = require('./crypto');
const { SHARED_ANTHROPIC_API_KEY } = require('./config');

const _clients = new Map();

function clientForTenant(tenant) {
  const apiKey = tenant.anthropic_api_key_encrypted
    ? decrypt(tenant.anthropic_api_key_encrypted)
    : SHARED_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(`Tenant ${tenant.name}: no Anthropic API key (per-tenant or shared)`);
  }

  if (!_clients.has(apiKey)) {
    _clients.set(apiKey, new Anthropic({ apiKey }));
  }
  return _clients.get(apiKey);
}

async function generateReply(tenant, conversationHistory, log) {
  if (!conversationHistory || conversationHistory.length === 0) {
    log.warn('generateReply: empty history');
    return null;
  }

  let trimmed = conversationHistory.slice(-tenant.history_limit);
  if (trimmed[0]?.role !== 'user') trimmed = trimmed.slice(1);
  if (trimmed.length === 0) {
    log.warn('generateReply: no user turn after trimming');
    return null;
  }

  try {
    const client = clientForTenant(tenant);
    const response = await client.messages.create({
      model: tenant.claude_model,
      max_tokens: 512,
      system: tenant.system_prompt,
      messages: trimmed,
    });
    const reply = response.content[0].text.trim();
    log.debug(`Claude reply generated (${reply.length} chars)`);
    return reply;
  } catch (err) {
    log.error(`Claude API error: ${err.message}`);
    return null;
  }
}

module.exports = { generateReply };
