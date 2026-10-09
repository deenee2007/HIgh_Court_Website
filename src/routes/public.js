'use strict';
const crypto = require('crypto');
const config = require('../config');
const { col } = require('../db');
const C = require('../content');
const V = require('../views/site');
const { parseBody } = require('../http');
const { rateLimit, safeEqual } = require('../security');
const { loadSession, canEdit } = require('../auth');
const { asArray, slugify } = require('../fields');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const DOC_TYPES = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// Finds the document stored in a file field of an item, if the visitor may see it
async function findDocument(req, id, field) {
  const entry = await C.getEntryById(id);
  if (!entry) return null;
  const section = await C.getSection(entry.section);
  if (!section) return null;
  const f = section.fields.find((x) => x.key === field && x.type === 'file');
  const url = entry.data && entry.data[field];
  if (!f || !url || typeof url !== 'string') return null;
  if (entry.status !== 'published') {
    const user = await loadSession(req);
    if (!user || !canEdit(user, section.slug)) return null;
  }
  return { entry, section, field, url };
}

function isAllowedRemote(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return false;
    if (config.cloudinary && !u.pathname.startsWith('/' + config.cloudinary.cloudName + '/')) return false;
    return true;
  } catch { return false; }
}

const VERSION = require('../../package.json').version + '.' + Date.now().toString(36);
const LEGACY = { '/index.html': '/', '/gallery.html': '/gallery', '/judgments.html': '/judgments', '/cause_list.html': '/cause-lists', '/rules.html': '/rules', '/small_claims.html': '/small-claims', '/e-filing.html': '/e-filing', '/about.html': '/about' };

let formSecret = null;
async function getFormSecret() {
  if (formSecret) return formSecret;
  const doc = await col('settings').findOne({ _id: 'secrets' });
  if (doc && doc.form) return (formSecret = doc.form);
  const s = crypto.randomBytes(32).toString('hex');
  await col('settings').updateOne({ _id: 'secrets' }, { $set: { form: s } }, { upsert: true });
  return (formSecret = s);
}
async function formToken() {
  const ts = Date.now().toString(36);
  return `${ts}.${crypto.createHmac('sha256', await getFormSecret()).update(ts).digest('base64url').slice(0, 32)}`;
}
async function checkFormToken(t) {
  const [ts, sig] = String(t || '').split('.');
  if (!ts || !sig) return false;
  const expect = crypto.createHmac('sha256', await getFormSecret()).update(ts).digest('base64url').slice(0, 32);
  const age = Date.now() - parseInt(ts, 36);
  return safeEqual(sig, expect) && age > 2000 && age < 6 * 3600 * 1000;
}

async function baseCtx(req) {
  return {
    settings: await C.getSettings(), menu: await C.getMenuTree(), path: req.path, query: req.query,
    siteUrl: config.siteUrl, version: VERSION,
  };
}

async function sendError(req, res, status, message) {
  try {
    const ctx = await baseCtx(req);
    res.html(V.errorPage(ctx, status, message), status);
  } catch (e) {
    res.status(status).end(status === 404 ? 'Not found' : 'Error');
  }
}

async function homeData(blocks) {
  const sections = await C.getSections();
  const out = [];
  for (const block of blocks.filter((b) => b.visible !== false)) {
    let data = {};
    if (block.type === 'notices' || block.type === 'section') {
      const section = sections.find((s) => s.slug === block.data.section);
      if (!section) continue;
      const limit = block.type === 'notices' ? 30 : Number(block.data.limit) || 0;
      const { items } = await C.listEntries(section, { status: 'published', limit: limit || 200 });
      data = { section, items };
    }
    out.push({ block, data });
  }
  return out;
}

async function relatedFor(section, entry) {
  const sections = await C.getSections();
  const related = [];
  for (const s of sections) {
    for (const f of s.fields.filter((x) => x.type === 'reference' && x.refSection === section.slug)) {
      const { items } = await C.listEntries(s, { status: 'published', where: { ['data.' + f.key]: entry._id }, limit: 100 });
      if (items.length) related.push({ section: s, field: f, items });
    }
  }
  const parents = [];
  for (const f of section.fields.filter((x) => x.type === 'reference' && entry.data[x.key])) {
    const target = sections.find((s) => s.slug === f.refSection);
    const p = await C.getEntryById(entry.data[f.key]);
    if (target && p && p.status === 'published') parents.push({ label: f.label, title: p.title, url: C.entryUrl(target, p) });
  }
  return { related, parents };
}

async function renderEntry(req, res, section, slug) {
  let entry = await C.getEntry(section.slug, slug, true);
  let preview = false;
  if (!entry && req.query.preview) {
    const user = await loadSession(req);
    if (user && canEdit(user, section.slug)) { entry = await C.getEntry(section.slug, slug, false); preview = Boolean(entry); }
  }
  if (!entry) return sendError(req, res, 404);
  const ctx = { ...(await baseCtx(req)), preview, ...(await relatedFor(section, entry)) };
  if (preview) res.setHeader('Cache-Control', 'no-store');
  res.html(V.entryPage(ctx, section, entry));
}

function register(app) {
  app.get('/health', async (req, res) => { await col('settings').findOne({ _id: 'site' }); res.json({ ok: true }); });

  app.get('/', async (req, res) => {
    const home = await C.getHome();
    const ctx = { ...(await baseCtx(req)), formToken: await formToken() };
    res.html(V.homePage(ctx, await homeData(home.blocks || [])));
  });

  app.get('/robots.txt', async (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`User-agent: *\nDisallow: /admin\n${config.siteUrl ? `Sitemap: ${config.siteUrl}/sitemap.xml\n` : ''}`);
  });

  app.get('/sitemap.xml', async (req, res) => {
    const base = config.siteUrl || `https://${req.headers.host}`;
    const urls = ['/'];
    for (const s of await C.getSections()) {
      if (s.layout !== 'pages') urls.push('/' + s.slug);
      if (s.detail) {
        const { items } = await C.listEntries(s, { status: 'published', limit: 5000 });
        items.forEach((e) => urls.push(C.entryUrl(s, e)));
      }
    }
    const esc = (u) => u.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `<url><loc>${esc(base + u)}</loc></url>`).join('\n')}\n</urlset>`);
  });

  // The document itself, sent so browsers can display it (or save it with ?download=1)
  app.get('/doc/:id/:field', async (req, res) => {
    const doc = await findDocument(req, req.params.id, req.params.field);
    if (!doc) return sendError(req, res, 404, 'This document is not available.');
    const ext = (path.extname(decodeURIComponent(doc.url.split('?')[0])).slice(1) || 'pdf').toLowerCase();
    const type = DOC_TYPES[ext] || 'application/octet-stream';
    const name = `${slugify(doc.entry.title, 90) || 'document'}.${ext}`;
    const disposition = req.query.download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `${disposition}; filename="${name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.removeHeader('Content-Security-Policy'); // let the browser's own PDF reader work when the file is opened directly
    res.setHeader('Cache-Control', doc.entry.status === 'published' ? 'public, max-age=3600' : 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    if (doc.url.startsWith('/')) {
      // a file kept with the website (for example the original PDFs in /assets)
      const root = path.resolve(config.publicDir);
      let rel;
      try { rel = decodeURIComponent(doc.url.split('?')[0]); } catch { return sendError(req, res, 404); }
      const file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return sendError(req, res, 404, 'This document is not available.');
      const size = fs.statSync(file).size;
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
        let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
        if (start < 0) start = 0;
        if (start >= size || end < start) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); return res.end(); }
        end = Math.min(end, size - 1);
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(file, { start, end }).pipe(res);
        return 'done';
      }
      res.setHeader('Content-Length', size);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
      return 'done';
    }

    if (!isAllowedRemote(doc.url)) return sendError(req, res, 404, 'This document is not available.');
    const headers = {};
    if (req.headers.range) headers.Range = String(req.headers.range).slice(0, 100);
    let upstream;
    try {
      upstream = await fetch(doc.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60000) });
    } catch (err) {
      console.error('Document fetch failed', doc.url, err.message);
      return sendError(req, res, 502, 'The document could not be loaded just now. Please try again in a moment.');
    }
    if (!upstream.ok && upstream.status !== 206) {
      console.error('Document storage answered', upstream.status, doc.url, upstream.headers.get('x-cld-error') || '');
      return sendError(req, res, 502, 'The document could not be loaded just now. Please try again in a moment.');
    }
    res.statusCode = upstream.status === 206 ? 206 : 200;
    for (const h of ['content-length', 'content-range']) { const v = upstream.headers.get(h); if (v) res.setHeader(h, v); }
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    return 'done';
  });

  // A page of the website that shows the document
  app.get('/view/:id/:field', async (req, res) => {
    const doc = await findDocument(req, req.params.id, req.params.field);
    if (!doc) return sendError(req, res, 404, 'This document is not available.');
    const ctx = await baseCtx(req);
    const backUrl = doc.section.detail && doc.field !== 'file' ? C.entryUrl(doc.section, doc.entry) : `/${doc.section.slug}#${doc.entry.slug}`;
    if (doc.entry.status !== 'published') res.setHeader('Cache-Control', 'no-store');
    res.html(V.documentViewer(ctx, { ...doc, backUrl }));
  });

  app.post('/contact', async (req, res) => {
    const body = await parseBody(req);
    const back = (q) => res.redirect('/?' + q + '#contact');
    if (body.website) return back('sent=1'); // honeypot filled in: silently ignore bots
    if (!(await checkFormToken(body._form))) return back('error=form');
    if (!rateLimit('contact:' + req.ip, 5, 3600 * 1000).ok) return back('error=rate');
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 5000);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 2) return back('error=form');
    await col('messages').insertOne({ _id: C.newId(), name, email, subject: String(body.subject || '').trim().slice(0, 200), message, ip: req.ip, read: false, createdAt: new Date() });
    back('sent=1');
  });

  app.get('/:slug', async (req, res) => {
    const slug = req.params.slug;
    if (LEGACY[req.path]) return res.redirect(LEGACY[req.path], 301);
    const section = await C.getSection(slug);
    if (section && section.layout !== 'pages') {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const listAll = ['profiles', 'honours', 'notices'].includes(section.layout);
      const perPage = listAll ? 1000 : section.layout === 'documents' ? 50 : Number(section.perPage) || 24;
      const opts = { status: 'published', limit: perPage, skip: (page - 1) * perPage };
      const extra = { page, perPage, q: '', filters: {}, year: '', years: [] };
      if (section.layout === 'documents') {
        extra.q = String(req.query.q || '').slice(0, 100);
        for (const f of section.fields.filter((x) => x.filter && x.type === 'select')) extra.filters[f.key] = String(req.query[f.key] || '');
        const dateField = section.fields.find((x) => x.filter && x.type === 'date');
        if (dateField) {
          extra.year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : '';
          const all = await col('entries').distinct('data.' + dateField.key, { section: section.slug, status: 'published' });
          extra.years = [...new Set(all.filter(Boolean).map((d) => String(d).slice(0, 4)))].sort().reverse();
        }
        Object.assign(opts, { q: extra.q, filters: extra.filters, year: extra.year, yearField: dateField && dateField.key });
        const latest = await col('entries').findOne({ section: section.slug, status: 'published' }, { sort: { updatedAt: -1 } });
        extra.updated = latest ? latest.updatedAt : '';
      }
      const { items, total } = await C.listEntries(section, opts);
      const ctx = await baseCtx(req);
      return res.html(V.sectionPage(ctx, section, { items, total, ...extra }));
    }
    const pageSections = (await C.getSections()).filter((s) => s.rootUrls);
    for (const s of pageSections) {
      const e = await C.getEntry(s.slug, slug, false);
      if (e) return renderEntry(req, res, s, slug);
    }
    return 'next';
  });

  app.get('/:section/:slug', async (req, res) => {
    const section = await C.getSection(req.params.section);
    if (!section || !section.detail || section.rootUrls) return 'next';
    return renderEntry(req, res, section, req.params.slug);
  });
}

// Old addresses (for example /ict.html or /profiles/justice_halima.html) lead to the new pages
async function legacyRedirect(req, res) {
  if (req.method !== 'GET') return false;
  if (LEGACY[req.path]) { res.redirect(LEGACY[req.path], 301); return true; }
  if (!/\.html?$/.test(req.path)) return false;
  const e = await col('entries').findOne({ legacyPaths: req.path, status: 'published' });
  if (!e) return false;
  const s = await C.getSection(e.section);
  if (!s) return false;
  res.redirect(C.entryUrl(s, e), 301);
  return true;
}

module.exports = { register, sendError, legacyRedirect, baseCtx, VERSION };
