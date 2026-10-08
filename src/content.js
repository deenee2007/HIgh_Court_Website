'use strict';
// Data access for sections, entries, menu, home page, settings and the activity log.
const crypto = require('crypto');
const { col } = require('./db');
const { LAYOUTS } = require('./layouts');

const newId = () => crypto.randomBytes(12).toString('hex');
const RESERVED = new Set(['admin', 'assets', 'css', 'js', 'uploads', 'vendor', 'sitemap.xml', 'robots.txt', 'contact', 'search', 'api', 'favicon.ico', 'health', 'login', 'logout']);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- small cache (data changes rarely, pages are read often) ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}
const invalidate = () => cache.clear();

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  siteName: 'High Court of Justice, Gombe State',
  shortName: 'GOMBE STATE HIGH COURT',
  logo: '/assets/img/logos/high-court-logo.png',
  pageBanner: '/assets/img/logos/complex.jpg',
  footerAbout: '',
  address: '', phone: '', email: '',
  facebook: '', twitter: '', youtube: '', instagram: '',
  ctaLabel: 'E-Affidavit', ctaUrl: '', ctaIcon: 'fas fa-file-signature',
  mapEmbed: '',
  metaDescription: 'Official website of the High Court of Justice, Gombe State, Nigeria.',
  footerCredit: 'Directorate of ICT',
  footerCreditUrl: '/directorates/ict',
};
async function getSettings() {
  return cached('settings', 30000, async () => ({ ...DEFAULT_SETTINGS, ...((await col('settings').findOne({ _id: 'site' })) || {}) }));
}
async function saveSettings(values) {
  await col('settings').updateOne({ _id: 'site' }, { $set: values }, { upsert: true });
  invalidate();
}

// ---------- sections ----------
async function getSections() {
  return cached('sections', 30000, async () => (await col('sections').find({}).sort({ order: 1, name: 1 }).toArray()).map(normalizeSection));
}
function normalizeSection(s) {
  const layout = LAYOUTS[s.layout] ? s.layout : 'cards';
  return { detail: LAYOUTS[layout].detail, rootUrls: Boolean(LAYOUTS[layout].rootUrls), sort: LAYOUTS[layout].sort || 'manual', perPage: 24, fields: [], ...s, layout };
}
async function getSection(slug) {
  return (await getSections()).find((s) => s.slug === slug) || null;
}
async function saveSection(doc) {
  const now = new Date();
  if (doc._id) { const { _id, ...rest } = doc; await col('sections').updateOne({ _id }, { $set: { ...rest, updatedAt: now } }); }
  else { doc._id = newId(); doc.createdAt = now; doc.updatedAt = now; await col('sections').insertOne(doc); }
  invalidate();
  return doc;
}

// ---------- entries ----------
function sortSpec(section) {
  switch (section.sort) {
    case 'date': return { 'data.date': -1, createdAt: -1 };
    case 'newest': return { createdAt: -1 };
    case 'title': return { title: 1 };
    default: return { order: 1, createdAt: 1 };
  }
}
function entryUrl(section, entry) {
  if (!section || !entry) return '#';
  if (section.rootUrls) return '/' + entry.slug;
  return section.detail ? `/${section.slug}/${entry.slug}` : `/${section.slug}#${entry.slug}`;
}
const sectionUrl = (s) => '/' + s.slug;

async function listEntries(section, opts = {}) {
  const filter = { section: section.slug };
  if (opts.status) filter.status = opts.status;
  const and = [];
  if (opts.q) {
    const re = new RegExp(escapeRe(String(opts.q).slice(0, 100)), 'i');
    const or = [{ title: re }];
    section.fields.filter((f) => ['text', 'textarea', 'select', 'email'].includes(f.type)).forEach((f) => or.push({ ['data.' + f.key]: re }));
    and.push({ $or: or });
  }
  for (const [k, v] of Object.entries(opts.filters || {})) if (v) filter['data.' + k] = v;
  if (opts.year && opts.yearField) and.push({ ['data.' + opts.yearField]: new RegExp('^' + escapeRe(opts.year)) });
  if (opts.where) Object.assign(filter, opts.where);
  if (and.length) filter.$and = and;
  const total = await col('entries').countDocuments(filter);
  let cursor = col('entries').find(filter).sort(opts.sort || sortSpec(section));
  if (opts.skip) cursor = cursor.skip(opts.skip);
  if (opts.limit) cursor = cursor.limit(opts.limit);
  let items = await cursor.toArray();
  if (section.layout === 'notices' && opts.status === 'published') {
    const today = new Date().toISOString().slice(0, 10);
    items = items.filter((e) => !e.data || !e.data.expires || e.data.expires >= today);
  }
  return { items, total };
}

async function getEntry(sectionSlug, slug, publishedOnly) {
  const filter = { section: sectionSlug, slug };
  if (publishedOnly) filter.status = 'published';
  return col('entries').findOne(filter);
}
const getEntryById = (id) => col('entries').findOne({ _id: String(id) });

async function uniqueSlug(sectionSlug, base, excludeId) {
  let slug = base || 'item';
  for (let i = 2; i < 500; i++) {
    const clash = await col('entries').findOne({ section: sectionSlug, slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    const reserved = (await getSection(sectionSlug))?.rootUrls && (RESERVED.has(slug) || (await getSection(slug)));
    if (!clash && !reserved) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${newId().slice(0, 6)}`;
}

async function saveRevision(entry, user) {
  await col('revisions').insertOne({ _id: newId(), entryId: entry._id, section: entry.section, title: entry.title, slug: entry.slug, status: entry.status, data: entry.data, at: new Date(), by: user ? user.name : 'system' });
  // keep the 30 most recent versions per entry
  const old = await col('revisions').find({ entryId: entry._id }).sort({ at: -1 }).skip(30).toArray();
  for (const r of old) await col('revisions').deleteOne({ _id: r._id });
}

// ---------- menu ----------
async function getMenu() {
  return cached('menu', 30000, async () => col('menu').find({}).sort({ order: 1 }).toArray());
}
async function getMenuTree() {
  return cached('menuTree', 30000, async () => {
    const items = await getMenu();
    const sections = await getSections();
    const build = async (parent) => {
      const out = [];
      for (const it of items.filter((i) => (i.parent || null) === parent && i.visible !== false)) {
        const node = { ...it, children: await build(it._id) };
        if (it.autoSection) {
          const s = sections.find((x) => x.slug === it.autoSection);
          if (s) {
            const { items: ents } = await listEntries(s, { status: 'published', limit: 60 });
            node.children = node.children.concat(ents.map((e) => ({ _id: e._id, label: e.title, url: entryUrl(s, e), children: [] })));
          }
        }
        out.push(node);
      }
      return out;
    };
    return build(null);
  });
}
async function ensureSectionMenuItem(section, parent) {
  // parent: '' = top level, 'none' = not in the menu, otherwise a menu item id
  const existing = await col('menu').findOne({ section: section.slug });
  if (parent === 'none') { if (existing) await col('menu').deleteOne({ _id: existing._id }); invalidate(); return; }
  const p = parent || null;
  if (existing) {
    await col('menu').updateOne({ _id: existing._id }, { $set: { label: existing.label || section.name, url: '/' + section.slug, parent: p, ...(existing.parent !== p ? { order: await nextMenuOrder(p) } : {}) } });
  } else {
    await col('menu').insertOne({ _id: newId(), label: section.name, url: '/' + section.slug, parent: p, order: await nextMenuOrder(p), section: section.slug, visible: true });
  }
  invalidate();
}
async function nextMenuOrder(parent) {
  const last = await col('menu').findOne({ parent: parent || null }, { sort: { order: -1 } });
  return last ? (last.order || 0) + 1 : 1;
}

// ---------- home page ----------
async function getHome() {
  return cached('home', 30000, async () => (await col('home').findOne({ _id: 'home' })) || { _id: 'home', blocks: [] });
}
async function saveHome(blocks) {
  await col('home').updateOne({ _id: 'home' }, { $set: { blocks } }, { upsert: true });
  invalidate();
}

// ---------- activity log ----------
async function audit(user, action, target, details = '') {
  await col('audit').insertOne({ _id: newId(), at: new Date(), userId: user ? user._id : null, userName: user ? user.name : 'system', action, target: String(target || '').slice(0, 200), details: String(details || '').slice(0, 500) });
}

module.exports = {
  newId, RESERVED, escapeRe, invalidate, getSettings, saveSettings, DEFAULT_SETTINGS,
  getSections, getSection, saveSection, normalizeSection, listEntries, getEntry, getEntryById, uniqueSlug, saveRevision,
  entryUrl, sectionUrl, sortSpec, getMenu, getMenuTree, ensureSectionMenuItem, nextMenuOrder, getHome, saveHome, audit,
};
