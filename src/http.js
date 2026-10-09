'use strict';
// Minimal web framework: routing, cookies, body parsing and static files.
// Kept deliberately small so the whole site runs on Node.js with very few
// third party packages (smaller attack surface for an official website).
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const zlib = require('zlib');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- body parsing ----------
function setDeep(obj, key, value) {
  // Supports names like data[career][0][title] and tags[]
  const parts = [];
  key.replace(/^([^[\]]+)|\[([^[\]]*)\]/g, (m, a, b) => { parts.push(a !== undefined ? a : b); return ''; });
  if (!parts.length) return;
  let o = obj;
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    const last = i === parts.length - 1;
    const nextIsIndex = !last && /^\d*$/.test(parts[i + 1]);
    if (k === '' && Array.isArray(o)) {
      if (last) o.push(value);
      else { const n = nextIsIndex ? [] : {}; o.push(n); o = n; }
      continue;
    }
    if (last) {
      if (o[k] === undefined) o[k] = value;
      else if (Array.isArray(o[k])) o[k].push(value);
      else o[k] = [o[k], value];
    } else {
      if (o[k] == null || typeof o[k] !== 'object') o[k] = nextIsIndex ? [] : {};
      o = o[k];
    }
  }
}

function collect(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new HttpError(413, 'The submitted data is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  if (req.body) return req.body;
  const type = (req.headers['content-type'] || '').toLowerCase();
  const body = {};
  const files = {};
  if (type.startsWith('multipart/form-data')) {
    const limit = config.uploadLimitMb * 1024 * 1024;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) throw new HttpError(413, `Upload is too large. The limit per save is ${config.uploadLimitMb} MB.`);
    let seen = 0;
    const counted = Readable.from((async function* () {
      for await (const chunk of req) {
        seen += chunk.length;
        if (seen > limit) throw new HttpError(413, `Upload is too large. The limit per save is ${config.uploadLimitMb} MB.`);
        yield chunk;
      }
    })());
    const request = new Request('http://local' + req.url, { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Readable.toWeb(counted), duplex: 'half' });
    const form = await request.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') setDeep(body, k, v);
      else if (v && v.size > 0) setDeep(files, k, v);
    }
  } else {
    const buf = await collect(req, 2 * 1024 * 1024);
    for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) setDeep(body, k, v);
  }
  req.body = body;
  req.files = files;
  return body;
}

// ---------- cookies ----------
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      const k = p.slice(0, i).trim();
      try { out[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch { out[k] = ''; }
    }
  });
  return out;
}

function cookieString(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${opts.path || '/'}; SameSite=${opts.sameSite || 'Lax'}`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (opts.secure ?? config.isProd) s += '; Secure';
  if (opts.maxAge !== undefined) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  return s;
}

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// Scripts and styles are compressed once and kept in memory (much faster on mobile data)
const COMPRESSIBLE = new Set(['.css', '.js', '.mjs', '.svg', '.json', '.txt', '.xml']);
const gzCache = new Map();
function gzipped(file, etag) {
  const hit = gzCache.get(file);
  if (hit && hit.etag === etag) return hit.buf;
  const buf = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
  gzCache.set(file, { etag, buf });
  return buf;
}

function serveStatic(prefixes, dir) {
  const root = path.resolve(dir);
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (!prefixes.some((p) => req.path.startsWith(p))) return false;
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return false; }
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) return false;
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', /^\/(uploads|assets|fonts|vendor)\//.test(req.path) ? 'public, max-age=604800' : 'public, max-age=3600');
    if (ext === '.svg') res.setHeader('Content-Security-Policy', "script-src 'none'");
    if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return true; }
    if (COMPRESSIBLE.has(ext) && st.size > 1024) {
      res.setHeader('Vary', 'Accept-Encoding');
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const buf = gzipped(file, etag);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', buf.length);
        res.end(req.method === 'HEAD' ? undefined : buf);
        return true;
      }
    }
    res.setHeader('Content-Length', st.size);
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(file).pipe(res);
    return true;
  };
}

// ---------- router ----------
function compile(pattern) {
  const keys = [];
  const re = pattern.replace(/\/:([a-zA-Z_]+)/g, (m, k) => { keys.push(k); return '/([^/]+)'; });
  return { re: new RegExp('^' + re + '/?$'), keys };
}

class App {
  constructor() { this.routes = []; this.before = []; this.statics = []; this.notFound = null; this.onError = null; }
  use(fn) { this.before.push(fn); }
  static(prefixes, dir) { this.statics.push(serveStatic(prefixes, dir)); }
  add(method, pattern, handlers) { this.routes.push({ method, ...compile(pattern), handlers }); }
  get(p, ...h) { this.add('GET', p, h); }
  post(p, ...h) { this.add('POST', p, h); }

  async handle(req, res) {
    const url = new URL(req.url, 'http://local');
    req.path = url.pathname.replace(/\/{2,}/g, '/');
    req.query = Object.fromEntries(url.searchParams);
    req.cookies = parseCookies(req.headers.cookie);
    req.ip = (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    req.secure = config.trustProxy ? req.headers['x-forwarded-proto'] === 'https' : Boolean(req.socket.encrypted);
    res.locals = {};
    decorate(res);
    try {
      for (const s of this.statics) if (s(req, res)) return;
      for (const fn of this.before) { await fn(req, res); if (res.writableEnded) return; }
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      for (const r of this.routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(req.path);
        if (!m) continue;
        req.params = {};
        r.keys.forEach((k, i) => { try { req.params[k] = decodeURIComponent(m[i + 1]); } catch { req.params[k] = m[i + 1]; } });
        for (const h of r.handlers) {
          const result = await h(req, res);
          if (res.writableEnded || result === 'done') return;
          if (result === 'next') break; // fall through to the next matching route
        }
        if (res.writableEnded) return;
      }
      if (this.notFound) return await this.notFound(req, res);
      res.status(404).end('Not found');
    } catch (err) {
      if (this.onError) return this.onError(err, req, res);
      console.error(err);
      if (!res.headersSent) res.status(500).end('Server error');
    }
  }
}

function decorate(res) {
  res.status = function (code) { this.statusCode = code; return this; };
  res.html = function (body, code) {
    if (code) this.statusCode = code;
    const s = String(body);
    this.setHeader('Content-Type', 'text/html; charset=utf-8');
    this.setHeader('Content-Length', Buffer.byteLength(s));
    this.end(s);
  };
  res.json = function (obj, code) {
    if (code) this.statusCode = code;
    const s = JSON.stringify(obj);
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(s);
  };
  res.redirect = function (url, code = 303) {
    this.statusCode = code;
    this.setHeader('Location', url);
    this.end();
  };
  res.cookie = function (name, value, opts) {
    const prev = this.getHeader('Set-Cookie');
    const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
    list.push(cookieString(name, value, opts));
    this.setHeader('Set-Cookie', list);
  };
  res.clearCookie = function (name, opts = {}) { this.cookie(name, '', { ...opts, maxAge: 0 }); };
}

module.exports = { App, HttpError, parseBody, setDeep };
