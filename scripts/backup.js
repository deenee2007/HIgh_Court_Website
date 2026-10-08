'use strict';
// Saves a full backup of the website content to a JSON file.
//   npm run backup                     writes backups/website-backup-YYYY-MM-DD.json
//   npm run backup -- my-file.json     writes to the given file
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { exportAll } = require('../src/backup');

(async () => {
  await db.connect();
  const data = await exportAll();
  const file = process.argv[2] || path.join('backups', `website-backup-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  const n = Object.values(data.collections).reduce((a, b) => a + b.length, 0);
  console.log(`Backup written to ${file} (${n} records).`);
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
