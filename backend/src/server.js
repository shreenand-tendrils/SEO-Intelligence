'use strict';
const config = require('./config');
const prisma = require('./db');
const logger = require('./utils/logger');
const { createApp } = require('./app');

async function main() {
  await prisma.$connect();
  // Crawls left running by a previous process cannot resume: mark them failed.
  const stale = await prisma.crawlJob.updateMany({ where: { status: { in: ['QUEUED', 'RUNNING', 'POST_PROCESSING', 'SAVING'] }, updatedAt: { lt: new Date(Date.now() - 30 * 60000) } },
    data: { status: 'FAILED', error: 'Interrupted: no progress for 30 minutes.', finishedAt: new Date() } });
  if (stale.count) logger.warn('marked stale crawls failed', { count: stale.count });
  const server = createApp().listen(config.port, config.host, () => logger.info('backend listening', { port: config.port, crawler: config.crawlerUrl }));
  server.requestTimeout = 10 * 60000;
  const shutdown = async (sig) => {
    logger.info('shutting down', { sig });
    server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { logger.error('startup failed', { error: e.message }); process.exit(1); });
