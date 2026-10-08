'use strict';
const crypto = require('crypto');
const config = require('../config');
const { col } = require('../db');
const C = require('../content');
const V = require('../views/site');
const { parseBody } = require('../http');
const { rateLimit, safeEqual } = require('../security');
const { loadSession, canEdit } = require('../auth');
const { asArray } = require('../fields');

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
