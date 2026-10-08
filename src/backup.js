'use strict';
const { col } = require('./db');

const COLLECTIONS = ['sections', 'entries', 'menu', 'home', 'settings', 'users', 'messages', 'revisions', 'audit'];

async function exportAll() {
  const out = { format: 'gombe-high-court-backup', version: 1, createdAt: new Date().toISOString(), collections: {} };
  for (const name of COLLECTIONS) {
    let docs = await col(name).find({}).toArray();
    if (name === 'users') docs = docs.map(({ passwordHash, ...u }) => u); // passwords are never exported
    if (name === 'settings') docs = docs.filter((d) => d._id !== 'secrets');
    if (name === 'audit') docs = docs.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5000);
    out.collections[name] = docs;
  }
  return out;
}

const DATE_KEYS = new Set(['createdAt', 'updatedAt', 'publishedAt', 'at', 'lastLoginAt', 'lockUntil', 'expiresAt', 'lastSeen']);
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = DATE_KEYS.has(k) && typeof x === 'string' ? new Date(x) : revive(x);
    return o;
  }
  return v;
}

// Replaces content with the backup. User accounts are merged so nobody is locked out:
// existing accounts keep their passwords; accounts only in the backup are restored disabled.
async function importAll(data, { log = console.log } = {}) {
  if (!data || data.format !== 'gombe-high-court-backup') throw new Error('This file is not a website backup.');
  for (const name of COLLECTIONS) {
    const docs = revive(data.collections[name] || []);
    if (name === 'users') {
      for (const u of docs) {
        const existing = await col('users').findOne({ _id: u._id });
        if (existing) await col('users').updateOne({ _id: u._id }, { $set: { name: u.name, role: u.role, perms: u.perms, access: u.access } });
        else await col('users').insertOne({ ...u, active: false, passwordHash: '' });
      }
      continue;
    }
    await col(name).deleteMany(name === 'settings' ? { _id: { $ne: 'secrets' } } : {});
    if (docs.length) await col(name).insertMany(docs);
    log(`${name}: ${docs.length}`);
  }
}

module.exports = { exportAll, importAll };
