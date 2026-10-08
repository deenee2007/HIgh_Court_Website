'use strict';
const config = require('../config');
const { MemoryDb } = require('./memory');

let db = null;
let client = null;
let kind = '';

async function connect() {
  if (db) return db;
  if (config.mongoUri) {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(config.mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    db = client.db(config.dbName);
    kind = 'mongodb';
  } else {
    if (config.isProd) throw new Error('MONGODB_URI is not set. The website cannot start in production without a database.');
    db = new MemoryDb(config.dataFile);
    kind = config.dataFile ? 'memory (saved to ' + config.dataFile + ')' : 'memory (temporary)';
  }
  await ensureIndexes();
  return db;
}

async function ensureIndexes() {
  const idx = [
    ['users', { email: 1 }, { unique: true }],
    ['sessions', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
    ['entries', { section: 1, slug: 1 }, { unique: true }],
    ['entries', { section: 1, status: 1, order: 1 }],
    ['entries', { legacyPaths: 1 }],
    ['sections', { slug: 1 }, { unique: true }],
    ['revisions', { entryId: 1, at: -1 }],
    ['audit', { at: -1 }],
    ['messages', { createdAt: -1 }],
  ];
  for (const [c, keys, opts] of idx) await db.collection(c).createIndex(keys, opts || {});
}

function col(name) {
  if (!db) throw new Error('Database not connected');
  return db.collection(name);
}

async function close() {
  if (client) await client.close();
  if (db && db.flush) db.flush();
  db = null;
}

module.exports = { connect, col, close, kind: () => kind };
