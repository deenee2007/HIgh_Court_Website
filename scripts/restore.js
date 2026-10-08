'use strict';
// Restores a backup made with "npm run backup" or the Backup page of the dashboard.
//   npm run restore -- website-backup-2026-10-08.json --yes
// Content is replaced. Existing user accounts keep their passwords.
const fs = require('fs');
const db = require('../src/db');
const { importAll } = require('../src/backup');

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('Usage: npm run restore -- backup-file.json --yes');
  if (!process.argv.includes('--yes')) {
    console.log('This REPLACES all current content with the backup. Run again with --yes to confirm.');
    return;
  }
  await db.connect();
  await importAll(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log('Restore complete. Restart the website so it picks up the restored content.');
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
