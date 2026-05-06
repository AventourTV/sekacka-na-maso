'use strict';
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const { LOG_DIR } = require('./config');

fs.mkdirSync(LOG_DIR, { recursive: true });

const fmt = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, name }) =>
    `${timestamp} [${level.toUpperCase()}] ${name || 'bot'} — ${message}`
  )
);

const _loggers = {};

function getLogger(name = 'bot') {
  if (_loggers[name]) return _loggers[name];
  const logger = winston.createLogger({
    level: 'debug',
    format: fmt,
    transports: [
      new winston.transports.Console({ level: 'info', format: fmt }),
      new winston.transports.File({ filename: path.join(LOG_DIR, 'bot.log'), level: 'debug' }),
    ],
    defaultMeta: { name },
  });
  _loggers[name] = logger;
  return logger;
}

function getTenantLogger(tenantId, tenantName) {
  const key = `tenant.${tenantName}`;
  if (_loggers[key]) return _loggers[key];
  const safeName = tenantName.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const logger = winston.createLogger({
    level: 'debug',
    format: fmt,
    transports: [
      new winston.transports.Console({ level: 'info', format: fmt }),
      new winston.transports.File({
        filename: path.join(LOG_DIR, `tenant_${safeName}.log`),
        level: 'debug',
      }),
    ],
    defaultMeta: { name: `[${tenantId.slice(0, 8)}] ${tenantName}` },
  });
  _loggers[key] = logger;
  return logger;
}

module.exports = { getLogger, getTenantLogger };
