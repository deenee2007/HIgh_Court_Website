'use strict';
// A small in-memory stand-in for MongoDB, used only for local development and
// automated checks when no MONGODB_URI is set. It implements the subset of the
// official driver's API that this application uses. Production always uses MongoDB.
const fs = require('fs');

const clone = (v) => (v === undefined ? v : structuredClone(v));

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
function unsetPath(obj, path) {
  const keys = path.split('.');
  const last = keys.pop();
  const o = keys.reduce((x, k) => (x == null ? undefined : x[k]), obj);
  if (o && typeof o === 'object') delete o[last];
}

function cmp(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function eq(v, target) {
  if (Array.isArray(v) && !Array.isArray(target)) return v.some((x) => eq(x, target));
  if (v instanceof Date || target instanceof Date) return cmp(v, target) === 0;
  return v === target || (v == null && target == null);
}

function matchCond(value, cond) {
  if (cond instanceof RegExp) return typeof value === 'string' && cond.test(value);
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
    const ops = Object.keys(cond);
    if (ops.length && ops.every((k) => k.startsWith('$'))) {
      return ops.every((op) => {
        const arg = cond[op];
        switch (op) {
          case '$eq': return eq(value, arg);
          case '$ne': return !eq(value, arg);
          case '$in': return arg.some((a) => eq(value, a));
          case '$nin': return !arg.some((a) => eq(value, a));
          case '$gt': return value != null && cmp(value, arg) > 0;
          case '$gte': return value != null && cmp(value, arg) >= 0;
          case '$lt': return value != null && cmp(value, arg) < 0;
          case '$lte': return value != null && cmp(value, arg) <= 0;
          case '$exists': return (value !== undefined) === Boolean(arg);
          case '$regex': {
            const re = arg instanceof RegExp ? arg : new RegExp(arg, cond.$options || '');
            return typeof value === 'string' && re.test(value);
          }
          case '$options': return true;
          default: throw new Error('Unsupported operator ' + op);
        }
      });
    }
  }
  return eq(value, cond);
}

function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter || {})) {
    if (key === '$or') { if (!cond.some((f) => matches(doc, f))) return false; continue; }
    if (key === '$and') { if (!cond.every((f) => matches(doc, f))) return false; continue; }
    if (!matchCond(getPath(doc, key), cond)) return false;
  }
  return true;
}

class Cursor {
  constructor(docs) { this.docs = docs; this._sort = null; this._skip = 0; this._limit = 0; }
  sort(spec) { this._sort = spec; return this; }
  skip(n) { this._skip = n; return this; }
  limit(n) { this._limit = n; return this; }
  project() { return this; }
  async toArray() {
    let out = this.docs.slice();
    if (this._sort) {
      const keys = Object.entries(this._sort);
      out.sort((a, b) => {
        for (const [k, dir] of keys) {
          const c = cmp(getPath(a, k), getPath(b, k));
          if (c) return c * dir;
        }
        return 0;
      });
    }
    if (this._skip) out = out.slice(this._skip);
    if (this._limit) out = out.slice(0, this._limit);
    return out.map(clone);
  }
}

class Collection {
  constructor(store, name) { this.store = store; this.name = name; }
  get docs() { return (this.store.data[this.name] ||= []); }
  find(filter = {}) { return new Cursor(this.docs.filter((d) => matches(d, filter))); }
  async findOne(filter = {}, options = {}) {
    const c = this.find(filter);
    if (options.sort) c.sort(options.sort);
    return (await c.limit(1).toArray())[0] || null;
  }
  async countDocuments(filter = {}) { return this.docs.filter((d) => matches(d, filter)).length; }
  async insertOne(doc) {
    if (doc._id == null) throw new Error('memory store requires _id');
    if (this.docs.some((d) => d._id === doc._id)) throw Object.assign(new Error('duplicate key'), { code: 11000 });
    this.docs.push(clone(doc));
    this.store.changed();
    return { insertedId: doc._id };
  }
  async insertMany(docs) { for (const d of docs) await this.insertOne(d); return { insertedCount: docs.length }; }
  applyUpdate(doc, update) {
    if (!Object.keys(update).some((k) => k.startsWith('$'))) {
      const id = doc._id;
      for (const k of Object.keys(doc)) delete doc[k];
      Object.assign(doc, clone(update), { _id: id });
      return;
    }
    for (const [k, v] of Object.entries(update.$set || {})) setPath(doc, k, clone(v));
    for (const k of Object.keys(update.$unset || {})) unsetPath(doc, k);
    for (const [k, v] of Object.entries(update.$inc || {})) setPath(doc, k, (getPath(doc, k) || 0) + v);
    for (const [k, v] of Object.entries(update.$push || {})) {
      const arr = getPath(doc, k) || [];
      arr.push(clone(v));
      setPath(doc, k, arr);
    }
  }
  async updateOne(filter, update, options = {}) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) {
      if (options.upsert) {
        const base = {};
        for (const [k, v] of Object.entries(filter)) if (!k.startsWith('$') && (typeof v !== 'object' || v === null)) setPath(base, k, v);
        this.applyUpdate(base, update);
        for (const [k, v] of Object.entries(update.$setOnInsert || {})) setPath(base, k, clone(v));
        await this.insertOne(base);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
    this.applyUpdate(doc, update);
    this.store.changed();
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async replaceOne(filter, doc, options = {}) { return this.updateOne(filter, doc, options); }
  async updateMany(filter, update) {
    const docs = this.docs.filter((d) => matches(d, filter));
    docs.forEach((d) => this.applyUpdate(d, update));
    if (docs.length) this.store.changed();
    return { matchedCount: docs.length, modifiedCount: docs.length };
  }
  async deleteOne(filter) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i >= 0) { this.docs.splice(i, 1); this.store.changed(); }
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.store.data[this.name] = this.docs.filter((d) => !matches(d, filter));
    const n = before - this.docs.length;
    if (n) this.store.changed();
    return { deletedCount: n };
  }
  async createIndex() { return 'ok'; }
  async distinct(key, filter = {}) {
    const set = new Set();
    this.docs.filter((d) => matches(d, filter)).forEach((d) => { const v = getPath(d, key); (Array.isArray(v) ? v : [v]).forEach((x) => x != null && set.add(x)); });
    return [...set];
  }
}

class MemoryDb {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.timer = null;
    if (file && fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'), (k, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) ? new Date(v) : v));
    }
  }
  collection(name) { return new Collection(this, name); }
  async listCollections() { return { toArray: async () => Object.keys(this.data).map((name) => ({ name })) }; }
  changed() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => fs.writeFileSync(this.file, JSON.stringify(this.data)), 200);
  }
  flush() { if (this.file) { clearTimeout(this.timer); fs.writeFileSync(this.file, JSON.stringify(this.data)); } }
}

module.exports = { MemoryDb, matches };
