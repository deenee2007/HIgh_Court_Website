'use strict';
// Imports the original website content.
//   npm run seed             only runs when the database is empty
//   npm run seed -- --force  replaces ALL content with the original (user accounts are kept)
const db = require('../src/db');
const { seed } = require('../src/seed');

(async () => {
  const force = process.argv.includes('--force');
  await db.connect();
  if (force && !process.argv.includes('--yes')) {
    console.log('This deletes all sections, items, menu, home page and settings, then imports the original website again.');
    console.log('Run again with --force --yes to confirm.');
    await db.close();
    return;
  }
  const done = await seed({ force });
  console.log(done ? 'Done.' : 'The database already has content. Nothing was changed (use --force --yes to replace it).');
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
