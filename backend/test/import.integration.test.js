'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const h = require('./helpers');

const sums = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
let dir;
test.before(async () => {
  await h.start(); await h.resetDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
  for (const f of fs.readdirSync(h.FIXTURES)) fs.copyFileSync(path.join(h.FIXTURES, f), path.join(dir, f));
});
test.after(async () => { await h.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('legacy import is complete, idempotent and read-only on the source', async () => {
  const { runImport } = require('../src/services/legacyImport');
  const prisma = require('../src/db');
  const before = sums(dir);
  const jsons = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const r1 = await runImport({ dir });
  const s1 = r1.summary;
  assert.equal(r1.errors.length, 0);
  assert.ok(r1.verification.every((v) => v.ok), 'verification passes');
  assert.equal(s1.crawls_imported, jsons.length);
  assert.equal(await prisma.crawlJob.count({ where: { source: 'IMPORT' } }), jsons.length);
  assert.equal(await prisma.crawledPage.count(), jsons.reduce((a, j) => a + j.results.length, 0));
  assert.equal(await prisma.crawlInlink.count(), jsons.reduce((a, j) => a + Object.values(j.inlinks || {}).reduce((x, l) => x + l.length, 0), 0));
  assert.equal(await prisma.crawlReport.count(), jsons.reduce((a, j) => a + Object.keys(j.reports || {}).length, 0));
  assert.ok(s1.conversations_imported > 0 && s1.messages_imported > 0);
  assert.equal(await prisma.aiConversation.count(), s1.conversations_imported);
  assert.equal(await prisma.crawlTitleHistory.count(), s1.titles_imported);
  assert.ok(s1.titles_imported > 0);
  const scored = await prisma.seoScore.count();
  assert.equal(scored, jsons.length);

  const counts = async () => [await prisma.crawlJob.count(), await prisma.crawledPage.count(), await prisma.aiMessage.count(), await prisma.crawlTitleHistory.count()];
  const c1 = await counts();
  const r2 = await runImport({ dir });
  const s2 = r2.summary;
  assert.equal(s2.crawls_imported, 0);
  assert.equal(s2.conversations_imported, 0);
  assert.equal(s2.titles_imported, 0);
  assert.deepEqual(await counts(), c1);
  assert.deepEqual(sums(dir), before, 'source files unchanged');
});
