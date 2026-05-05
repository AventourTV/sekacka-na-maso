'use strict';
require('dotenv').config();
const path = require('path');

module.exports = {
  BASE_DIR: __dirname,
  LOG_DIR: path.join(__dirname, 'logs'),
  EXPORT_DIR: path.join(__dirname, 'exports'),
  DATABASE_FILE: process.env.DATABASE_FILE || path.join(__dirname, 'of_bot.db'),

  // Master key for encrypting OF cookies + per-tenant Anthropic keys at rest.
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',

  // Shared Anthropic key — fallback when a tenant has no per-tenant key
  SHARED_ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',

  // OnlyFansAPI.com Key
  OF_API_KEY: process.env.OF_API_KEY || '',

  // Defaults applied when creating new tenants
  DEFAULT_CLAUDE_MODEL: 'claude-sonnet-4-6',
  DEFAULT_POLL_INTERVAL: 15,
  DEFAULT_REPLY_DELAY_MIN: 30,
  DEFAULT_REPLY_DELAY_MAX: 120,
  DEFAULT_HUMAN_REVIEW: false,
  DEFAULT_HISTORY_LIMIT: 10,
  DEFAULT_SYSTEM_PROMPT:
    'You are a warm, flirtatious content creator chatting with a fan on OnlyFans. ' +
    'Keep replies short (1–3 sentences), personal, and engaging. ' +
    'Never break character or reveal you are an AI.',

  // Scheduler
  MAX_CONCURRENT_TENANTS: parseInt(process.env.MAX_CONCURRENT_TENANTS || '0', 10),
  // How often to re-read tenant list from DB (ms)
  TENANT_REFRESH_INTERVAL: parseInt(process.env.TENANT_REFRESH_INTERVAL || '60', 10) * 1000,
};
