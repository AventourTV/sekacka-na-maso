'use strict';
const { initDb } = require('./database');
const Scheduler = require('./scheduler');
const { getLogger } = require('./logger');

const log = getLogger('main');

async function main() {
  log.info('Starting OFM Bot');
  await initDb();

  const scheduler = new Scheduler();
  await scheduler.start();

  const shutdown = () => {
    log.info('Shutting down...');
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
