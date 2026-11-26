'use strict';
// Usage: node src/scripts/importLegacy.js [--dir <path>] [--out <dir>] [--force]
const fs = require('fs');
const path = require('path');
const prisma = require('../db');
const { runImport, markdownReport, defaultDir } = require('../services/legacyImport');

(async () => {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const dir = opt('--dir', defaultDir());
  const out = opt('--out', path.join(process.cwd(), 'import-reports'));
  const r = await runImport({ dir, force: args.includes('--force') });
  fs.mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(out, `import-${stamp}.json`), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(out, `import-${stamp}.md`), markdownReport(r));
  console.log(markdownReport(r));
  console.log(`\nReports written to ${out}`);
  await prisma.$disconnect();
  process.exit(r.summary.failed_verification || r.errors.length ? 2 : 0);
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
