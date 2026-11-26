'use strict';
// Recompute page + website scores for every completed crawl from saved data.
const prisma = require('../db');
const { exportCrawl } = require('../services/exportService');
const ingest = require('../services/ingestService');

(async () => {
  const crawls = await prisma.crawlJob.findMany({ where: { status: { in: ['COMPLETED', 'STOPPED'] } }, select: { id: true, name: true, status: true, finishedAt: true, stopReason: true } });
  for (const c of crawls) {
    const d = await exportCrawl(c.id, { withComparison: false });
    const r = await ingest.persistCrawl(c.id, d.results.map(({ seo_score: _s, ...row }) => row), d.inlinks, d.reports,
      { name: c.name, status: c.status, finishedAt: c.finishedAt, stopReason: c.stopReason, titleHistory: false });
    console.log(`${c.id} ${c.name}: ${r.site.overall}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
