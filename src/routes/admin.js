'use strict';
const config = require('../config');
const db = require('../db');
const { col } = db;
const C = require('../content');
const A = require('../views/admin');
const F = require('../fields');
const { LAYOUTS } = require('../layouts');
const { BLOCKS } = require('../blocks');
const { parseBody, HttpError } = require('../http');
const { rateLimit, safeEqual, token } = require('../security');
const { saveUpload } = require('../media');
const auth = require('../auth');
const { VERSION } = require('./public');
const { safeUrl } = require('../views/html');

const MAX_FAILS = 5;
const TEMP_HOURS = 72; // how long a temporary password given by an administrator stays valid
const LOCK_MINUTES = 15;

// ---------- helpers ----------
function setFlash(res, type, text) {
  res.cookie('gsc_flash', Buffer.from(JSON.stringify({ type, text })).toString('base64url'), { path: '/admin', maxAge: 60 });
}
function readFlash(req, res) {
  const v = req.cookies.gsc_flash;
  if (!v) return null;
  res.clearCookie('gsc_flash', { path: '/admin' });
  try { const f = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')); return f && typeof f.text === 'string' ? { type: f.type === 'error' ? 'error' : 'ok', text: f.text.slice(0, 300) } : null; } catch { return null; }
}

async function ctxFor(req, res) {
  const sections = await C.getSections();
  const warnings = [];
  if (!config.cloudinary && auth.isSuper(req.user)) warnings.push(config.isProd ? 'Cloudinary is not configured: uploaded files are stored on the server and will be lost on the next deploy. Add CLOUDINARY_URL in the Render environment settings.' : 'Development mode: uploads are saved in public/uploads.');
  if (!config.mongoUri && auth.isSuper(req.user)) warnings.push(`Database: ${db.kind()}. Content is not stored in MongoDB.`);
  return {
    user: req.user, csrf: req.session.csrf, settings: await C.getSettings(), sections, version: VERSION, flash: readFlash(req, res),
    unread: auth.can(req.user, 'messages') ? await col('messages').countDocuments({ read: false }) : 0, warnings, entryUrl: C.entryUrl,
  };
}

const deny = async (req, res) => res.html(A.notAllowed(await ctxFor(req, res)), 403);
const needPerm = (perm) => async (req, res) => { if (!auth.can(req.user, perm)) { await deny(req, res); return 'done'; } };
const needSuper = async (req, res) => { if (!auth.isSuper(req.user)) { await deny(req, res); return 'done'; } };

async function sectionOr404(req, res, level = 'edit') {
  const s = await C.getSection(req.params.section);
  if (!s) throw new HttpError(404, 'Section not found');
  const ok = level === 'publish' ? auth.canPublish(req.user, s.slug) : auth.canEdit(req.user, s.slug);
  if (!ok) { await deny(req, res); return null; }
  return s;
}

async function refOptions(section) {
  const out = {};
  for (const f of section.fields.filter((x) => x.type === 'reference' && x.refSection)) {
    const target = await C.getSection(f.refSection);
    out[f.key] = target ? (await C.listEntries(target, { limit: 1000 })).items.map((e) => ({ _id: e._id, title: e.title })) : [];
  }
  return out;
}

function camelKey(label) {
  const words = String(label || '').normalize('NFKD').replace(/[^a-zA-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const k = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('').slice(0, 40);
  return /^[a-z]/.test(k) ? k : 'field' + k;
}

// ---------- registration ----------
function register(app) {
  // Authentication gate for everything under /admin
  app.use(async (req, res) => {
    if (!req.path.startsWith('/admin')) return;
    if (['/admin/login', '/admin/setup'].includes(req.path)) return;
    const user = await auth.loadSession(req);
    if (!user) {
      if (req.method === 'GET') return res.redirect('/admin/login' + (req.path !== '/admin' ? '?next=' + encodeURIComponent(req.path) : ''));
      return res.redirect('/admin/login');
    }
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const sent = body._csrf || req.headers['x-csrf-token'];
      if (!safeEqual(sent, req.session.csrf)) throw new HttpError(403, 'Your session expired or the form was out of date. Go back, reload the page and try again.');
    }
    // Someone signed in with a temporary password must choose their own before doing anything else
    if (user.mustChangePassword && !['/admin/change-password', '/admin/logout'].includes(req.path)) {
      if (req.method === 'GET') return res.redirect('/admin/change-password');
      throw new HttpError(403, 'Please choose your own password before continuing.');
    }
  });

  // ----- sign in -----
  app.get('/admin/login', async (req, res) => {
    if (!(await col('users').countDocuments({}))) return res.redirect('/admin/setup');
    if (await auth.loadSession(req)) return res.redirect('/admin');
    const t = token(16);
    res.cookie('gsc_lt', t, { path: '/admin', maxAge: 3600 });
    res.html(A.loginPage({ settings: await C.getSettings(), version: VERSION, loginToken: t, notice: req.query.out ? 'You have signed out.' : '' }));
  });

  app.post('/admin/login', async (req, res) => {
    const body = await parseBody(req);
    const settings = await C.getSettings();
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const fail = (msg) => {
      const t = token(16);
      res.cookie('gsc_lt', t, { path: '/admin', maxAge: 3600 });
      res.html(A.loginPage({ settings, version: VERSION, loginToken: t, email, error: msg }), 401);
    };
    if (!safeEqual(body._login, req.cookies.gsc_lt)) return fail('The sign in form expired. Please try again.');
    const ipLimit = rateLimit('login:' + req.ip, 20, 15 * 60 * 1000);
    if (!ipLimit.ok) return fail(`Too many attempts. Wait ${Math.ceil(ipLimit.retryAfter / 60)} minutes and try again.`);
    const user = await col('users').findOne({ email });
    if (user && user.lockUntil && new Date(user.lockUntil) > new Date()) {
      await auth.verifyPassword(String(body.password || ''), '');
      return fail(`This account is locked for ${LOCK_MINUTES} minutes after several wrong passwords.`);
    }
    const ok = await auth.verifyPassword(String(body.password || ''), user ? user.passwordHash : '');
    if (!user || !ok || !user.active) {
      if (user) {
        const fails = (user.failedLogins || 0) + 1;
        await col('users').updateOne({ _id: user._id }, { $set: { failedLogins: fails >= MAX_FAILS ? 0 : fails, ...(fails >= MAX_FAILS ? { lockUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } : {}) } });
        if (fails >= MAX_FAILS) await C.audit(user, 'account locked after failed sign in attempts', user.email, req.ip);
      }
      return fail('The email or password is not correct.');
    }
    if (user.mustChangePassword && user.tempExpires && new Date(user.tempExpires) < new Date()) {
      await C.audit(user, 'tried to sign in with an expired temporary password', user.email, req.ip);
      return fail('This temporary password has expired. Ask an administrator to give you a new one.');
    }
    await col('users').updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockUntil: null, lastLoginAt: new Date(), lastLoginIp: req.ip } });
    await auth.createSession(res, user, req);
    if (user.mustChangePassword) {
      res.clearCookie('gsc_lt', { path: '/admin' });
      await C.audit(user, 'signed in with a temporary password', user.email, req.ip);
      return res.redirect('/admin/change-password');
    }
    res.clearCookie('gsc_lt', { path: '/admin' });
    await C.audit(user, 'signed in', user.email, req.ip);
    const next = String(req.query.next || '');
    res.redirect(/^\/admin(\/[a-z0-9/_-]*)?$/i.test(next) ? next : '/admin');
  });

  app.post('/admin/logout', async (req, res) => {
    await auth.destroySession(req, res);
    res.redirect('/admin/login?out=1');
  });

  // ----- first run: create the super admin -----
  const setupState = async () => ({ open: !(await col('users').countDocuments({})), needToken: Boolean(config.setupToken) || config.isProd });
  app.get('/admin/setup', async (req, res) => {
    const st = await setupState();
    if (!st.open) return res.redirect('/admin/login');
    const settings = await C.getSettings();
    if (config.isProd && !config.setupToken) return res.html(A.loginPage({ settings, version: VERSION, loginToken: '', error: 'To create the first account, set a SETUP_TOKEN environment variable in Render, then reload this page.' }), 503);
    const t = token(16);
    res.cookie('gsc_lt', t, { path: '/admin', maxAge: 3600 });
    res.html(A.setupPage({ settings, version: VERSION, loginToken: t, needToken: st.needToken }));
  });
  app.post('/admin/setup', async (req, res) => {
    const st = await setupState();
    if (!st.open) return res.redirect('/admin/login');
    const body = await parseBody(req);
    const settings = await C.getSettings();
    const again = (error) => { const t = token(16); res.cookie('gsc_lt', t, { path: '/admin', maxAge: 3600 }); res.html(A.setupPage({ settings, version: VERSION, loginToken: t, needToken: st.needToken, error, values: body }), 400); };
    if (!safeEqual(body._login, req.cookies.gsc_lt)) return again('The form expired. Please try again.');
    if (!rateLimit('setup:' + req.ip, 10, 15 * 60 * 1000).ok) return again('Too many attempts. Try again later.');
    if (st.needToken && !safeEqual(String(body.token || '').trim(), config.setupToken)) return again('The setup code is not correct.');
    const email = String(body.email || '').trim().toLowerCase();
    if (!body.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return again('Enter your name and a valid email.');
    const problem = auth.passwordProblem(body.password, { email });
    if (problem) return again(problem);
    if (body.password !== body.password2) return again('The two passwords do not match.');
    const user = { _id: C.newId(), name: String(body.name).trim().slice(0, 120), email, passwordHash: await auth.hashPassword(body.password), role: 'superadmin', perms: {}, access: {}, active: true, createdAt: new Date() };
    await col('users').insertOne(user);
    await C.audit(user, 'created the first super admin account', email);
    await auth.createSession(res, user, req);
    res.redirect('/admin');
  });

  // ----- dashboard -----
  app.get('/admin', async (req, res) => {
    const ctx = await ctxFor(req, res);
    const sections = ctx.sections.filter((s) => auth.canEdit(req.user, s.slug));
    const counts = [];
    for (const s of sections) counts.push({ section: s, published: await col('entries').countDocuments({ section: s.slug, status: 'published' }), drafts: await col('entries').countDocuments({ section: s.slug, status: 'draft' }) });
    const slugs = sections.map((s) => s.slug);
    const drafts = (await col('entries').find({ section: { $in: slugs }, $or: [{ status: 'draft' }, { pending: { $exists: true } }] }).sort({ updatedAt: -1 }).limit(15).toArray())
      .filter((e) => e.status === 'draft' || e.pending)
      .map((e) => ({ ...e, title: e.pending ? e.pending.title : e.title, sectionName: (sections.find((s) => s.slug === e.section) || {}).name + (e.pending ? ' (changes waiting)' : '') }));
    const recent = auth.can(req.user, 'audit') ? await col('audit').find({}).sort({ at: -1 }).limit(12).toArray() : await col('audit').find({ userId: req.user._id }).sort({ at: -1 }).limit(12).toArray();
    res.html(A.dashboard(ctx, { counts, drafts, recent }));
  });

  // ----- content -----
  app.get('/admin/content/:section', async (req, res) => {
    const s = await sectionOr404(req, res);
    if (!s) return;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 50;
    const status = ['published', 'draft'].includes(req.query.status) ? req.query.status : '';
    const q = String(req.query.q || '').slice(0, 100);
    const { items, total } = await C.listEntries(s, { status, q, limit: perPage, skip: (page - 1) * perPage });
    res.html(A.entryList(await ctxFor(req, res), s, { items, total, page, perPage, q, status }));
  });

  app.get('/admin/content/:section/new', async (req, res) => {
    const s = await sectionOr404(req, res);
    if (!s) return;
    res.html(A.entryForm(await ctxFor(req, res), s, { title: '', slug: '', data: {}, status: 'draft' }, { refOptions: await refOptions(s) }));
  });

  app.get('/admin/content/:section/:id', async (req, res) => {
    const s = await sectionOr404(req, res);
    if (!s) return;
    const e = await C.getEntryById(req.params.id);
    if (!e || e.section !== s.slug) throw new HttpError(404, 'Item not found');
    const ctx = await ctxFor(req, res);
    let view = e;
    if (e.pending) {
      view = { ...e, title: e.pending.title, slug: e.pending.slug, data: e.pending.data };
      ctx.warnings.push(`Showing changes saved by ${e.pending.by} on ${new Date(e.pending.at).toLocaleString('en-GB')} that are waiting for approval. The live page still shows the earlier version.${auth.canPublish(req.user, s.slug) ? ' Publish to make them live, or use History to go back.' : ''}`);
    }
    res.html(A.entryForm(ctx, s, view, { refOptions: await refOptions(s) }));
  });

  async function saveEntry(req, res, s, existing) {
    const body = req.body;
    const files = req.files || {};
    const canPub = auth.canPublish(req.user, s.slug);
    const base = existing && existing.pending ? existing.pending : existing;
    const prevData = (base && base.data) || {};
    const title = String(body.title || '').trim().slice(0, 300);
    const data = {};
    for (const f of s.fields) data[f.key] = await F.parse(f, body, files, prevData[f.key]);
    // keep values of fields that were removed from the section, so nothing is lost by accident
    for (const [k, v] of Object.entries(prevData)) if (!(k in data)) data[k] = v;
    const draftEntry = { ...(existing || {}), title, data, slug: String(body.slug || '') };
    const missing = s.fields.filter((f) => f.required && F.isEmpty(data[f.key])).map((f) => f.label);
    if (!title) missing.unshift(s.titleLabel || 'Title');
    if (missing.length) {
      return res.html(A.entryForm(await ctxFor(req, res), s, draftEntry, { error: 'Please fill in: ' + missing.join(', ') + '.', refOptions: await refOptions(s) }), 400);
    }
    const slug = await C.uniqueSlug(s.slug, F.slugify(body.slug || title) || 'item', existing && existing._id);
    const now = new Date();
    const who = req.user.name;
    const wantsPublish = body.action === 'publish' && canPub;

    if (!existing) {
      const last = await col('entries').findOne({ section: s.slug }, { sort: { order: -1 } });
      const doc = { _id: C.newId(), section: s.slug, slug, title, data, status: wantsPublish ? 'published' : 'draft', order: last ? (last.order || 0) + 1 : 0, createdAt: now, updatedAt: now, createdBy: who, updatedBy: who, legacyPaths: [] };
      if (wantsPublish) doc.publishedAt = now;
      await col('entries').insertOne(doc);
      await C.audit(req.user, wantsPublish ? 'created and published' : 'created a draft of', `${s.singular || s.name}: ${title}`);
      C.invalidate();
      setFlash(res, 'ok', wantsPublish ? 'Published.' : 'Saved as a draft.');
      return res.redirect(`/admin/content/${s.slug}/${doc._id}`);
    }

    await C.saveRevision(existing.pending ? { ...existing, ...existing.pending } : existing, req.user);
    if (!canPub && existing.status === 'published') {
      // Live page stays unchanged until someone with publishing rights approves
      await col('entries').updateOne({ _id: existing._id }, { $set: { pending: { title, slug, data, by: who, at: now }, updatedAt: now, updatedBy: who } });
      await C.audit(req.user, 'submitted changes for approval to', `${s.singular || s.name}: ${title}`);
      setFlash(res, 'ok', 'Your changes are saved and waiting for approval. The live page has not changed yet.');
    } else {
      const status = wantsPublish ? 'published' : 'draft';
      const set = { title, slug, data, status, updatedAt: now, updatedBy: who };
      if (status === 'published' && existing.status !== 'published') set.publishedAt = now;
      if (existing.slug !== slug && existing.status === 'published') set.legacyPaths = [...new Set([...(existing.legacyPaths || []), C.entryUrl(s, existing)])];
      await col('entries').updateOne({ _id: existing._id }, { $set: set, $unset: { pending: '' } });
      const verb = status === 'published' ? (existing.status === 'published' ? 'updated' : 'published') : existing.status === 'published' ? 'unpublished' : 'saved a draft of';
      await C.audit(req.user, verb, `${s.singular || s.name}: ${title}`);
      setFlash(res, 'ok', status === 'published' ? 'Saved and published.' : existing.status === 'published' ? 'Saved as a draft. The page is no longer visible to the public.' : 'Draft saved.');
    }
    C.invalidate();
    res.redirect(`/admin/content/${s.slug}/${existing._id}`);
  }

  app.post('/admin/content/:section/new', async (req, res) => {
    const s = await sectionOr404(req, res);
    if (!s) return;
    return saveEntry(req, res, s, null);
  });

  app.post('/admin/content/:section/:id', async (req, res) => {
    const s = await sectionOr404(req, res);
    if (!s) return;
    const e = await C.getEntryById(req.params.id);
    if (!e || e.section !== s.slug) throw new HttpError(404, 'Item not found');
    return saveEntry(req, res, s, e);
  });

  app.post('/admin/content/:section/:id/delete', async (req, res) => {
    const s = await sectionOr404(req, res, 'publish');
    if (!s) return;
    const e = await C.getEntryById(req.params.id);
    if (!e || e.section !== s.slug) throw new HttpError(404, 'Item not found');
    await C.saveRevision(e, req.user);
    await col('entries').deleteOne({ _id: e._id });
    await C.audit(req.user, 'deleted', `${s.singular || s.name}: ${e.title}`);
    C.invalidate();
    setFlash(res, 'ok', `"${e.title}" was deleted.`);
    res.redirect('/admin/content/' + s.slug);
  });

  app.post('/admin/content/:section/:id/move', async (req, res) => {
    const s = await sectionOr404(req, res, 'publish');
    if (!s) return;
    const all = await col('entries').find({ section: s.slug }).sort({ order: 1, createdAt: 1 }).toArray();
    const i = all.findIndex((x) => x._id === req.params.id);
    const j = req.body.dir === 'up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < all.length) {
      [all[i], all[j]] = [all[j], all[i]];
      for (let k = 0; k < all.length; k++) if (all[k].order !== k) await col('entries').updateOne({ _id: all[k]._id }, { $set: { order: k } });
      C.invalidate();
    }
    res.redirect(req.headers.referer && /\/admin\//.test(req.headers.referer) ? new URL(req.headers.referer).pathname + new URL(req.headers.referer).search : '/admin/content/' + s.slug);
  });

  app.get('/admin/content/:section/:id/history', async (req, res) => {
    const s = await sectionOr404(req, res);
    if (!s) return;
    const e = await C.getEntryById(req.params.id);
    if (!e || e.section !== s.slug) throw new HttpError(404, 'Item not found');
    const revisions = await col('revisions').find({ entryId: e._id }).sort({ at: -1 }).limit(30).toArray();
    res.html(A.historyPage(await ctxFor(req, res), s, e, revisions));
  });

  app.post('/admin/content/:section/:id/restore/:rev', async (req, res) => {
    const s = await sectionOr404(req, res);
    if (!s) return;
    const e = await C.getEntryById(req.params.id);
    const r = await col('revisions').findOne({ _id: req.params.rev, entryId: req.params.id });
    if (!e || !r) throw new HttpError(404, 'Version not found');
    await C.saveRevision(e, req.user);
    const now = new Date();
    if (e.status === 'published') await col('entries').updateOne({ _id: e._id }, { $set: { pending: { title: r.title, slug: e.slug, data: r.data, by: req.user.name, at: now }, updatedAt: now, updatedBy: req.user.name } });
    else await col('entries').updateOne({ _id: e._id }, { $set: { title: r.title, data: r.data, updatedAt: now, updatedBy: req.user.name } });
    await C.audit(req.user, 'restored an earlier version of', `${s.singular || s.name}: ${r.title}`);
    C.invalidate();
    setFlash(res, 'ok', e.status === 'published' ? 'The earlier version is loaded below. Review it, then publish to make it live.' : 'The earlier version was restored.');
    res.redirect(`/admin/content/${s.slug}/${e._id}`);
  });

  // Images inserted inside the text editor
  app.post('/admin/upload', async (req, res) => {
    if (!req.user) throw new HttpError(403, 'Not signed in');
    const file = req.files && req.files.file;
    if (!file || Array.isArray(file)) return res.json({ error: 'No file received' }, 400);
    if (!rateLimit('upload:' + req.user._id, 120, 3600 * 1000).ok) return res.json({ error: 'Too many uploads, try again later.' }, 429);
    try {
      const url = await saveUpload(file, 'image');
      await C.audit(req.user, 'uploaded an image', url);
      res.json({ location: url });
    } catch (err) {
      res.json({ error: err.message }, err.status || 500);
    }
  });

  // ----- sections -----
  app.get('/admin/sections', needPerm('structure'), async (req, res) => {
    const ctx = await ctxFor(req, res);
    const counts = {};
    for (const s of ctx.sections) counts[s.slug] = await col('entries').countDocuments({ section: s.slug });
    res.html(A.sectionList(ctx, ctx.sections, counts));
  });

  async function sectionFormOpts(s) {
    const menu = await C.getMenu();
    const own = s.slug ? menu.find((m) => m.section === s.slug) : null;
    const home = await C.getHome();
    return {
      menuGroups: menu.filter((m) => !m.parent && (!s.slug || m.section !== s.slug)),
      menuParent: own ? own.parent || '' : s._id ? 'none' : '',
      onHome: s._id ? (home.blocks || []).some((b) => b.type === 'section' && b.data.section === s.slug) : false,
      insideOf: s.insideOf || '',
    };
  }

  app.get('/admin/sections/new', needPerm('structure'), async (req, res) => {
    const s = { layout: 'cards', sort: 'manual', detail: true, fields: [] };
    res.html(A.sectionForm(await ctxFor(req, res), s, await sectionFormOpts(s)));
  });

  app.get('/admin/sections/:slug', needPerm('structure'), async (req, res) => {
    const s = await C.getSection(req.params.slug);
    if (!s) throw new HttpError(404, 'Section not found');
    res.html(A.sectionForm(await ctxFor(req, res), s, await sectionFormOpts(s)));
  });

  async function saveSection(req, res, existing) {
    const b = req.body;
    const name = String(b.name || '').trim().slice(0, 80);
    const layout = LAYOUTS[b.layout] ? b.layout : 'cards';
    const s = existing ? { ...existing } : { fields: [], system: false };
    const again = async (error) => res.html(A.sectionForm(await ctxFor(req, res), { ...s, name, layout }, { ...(await sectionFormOpts(s)), error }), 400);
    if (!name) return again('Please give the section a name.');
    if (!existing) {
      const slug = F.slugify(b.slug || name, 50);
      if (!slug) return again('Please choose a web address.');
      const pageClash = await col('entries').findOne({ slug, section: { $in: (await C.getSections()).filter((x) => x.rootUrls).map((x) => x.slug) } });
      if (C.RESERVED.has(slug) || (await C.getSection(slug)) || pageClash) return again(`The address /${slug} is already in use. Choose another.`);
      s.slug = slug;
      s.order = (await C.getSections()).length + 1;
      s.fields = b.presetFields ? JSON.parse(JSON.stringify(LAYOUTS[layout].fields)) : [];
    }
    Object.assign(s, {
      name, layout,
      singular: String(b.singular || '').trim().slice(0, 60) || name,
      titleLabel: String(b.titleLabel || '').trim().slice(0, 60) || LAYOUTS[layout].titleLabel,
      intro: String(b.intro || '').trim().slice(0, 500),
      sort: ['manual', 'date', 'newest', 'title'].includes(b.sort) ? b.sort : 'manual',
      display: ['table', 'rows', 'portrait'].includes(b.display) ? b.display : '',
      detail: layout === 'pages' ? true : F.asArray(b.detail).concat(b.detail).includes('1'),
    });
    s.rootUrls = Boolean(LAYOUTS[layout].rootUrls);
    s.banner = await F.parse({ key: 'banner', type: 'image' }, b, req.files || {}, existing && existing.banner);

    if (existing && b.fields !== undefined) {
      const seen = new Set();
      s.fields = F.asArray(b.fields).map((f) => {
        const label = String(f.label || '').trim().slice(0, 80);
        if (!label) return null;
        let key = String(f.key || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || camelKey(label);
        if (!/^[a-zA-Z]/.test(key)) key = 'f' + key;
        while (seen.has(key)) key += '2';
        seen.add(key);
        const type = F.TYPES[f.type] ? f.type : 'text';
        return { key, label, type, required: f.required === '1', showInList: f.showInList === '1', filter: f.filter === '1', help: String(f.help || '').trim().slice(0, 200),
          options: type === 'select' ? String(f.options || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 100) : [], refSection: type === 'reference' ? String(f.refSection || '') : '' };
      }).filter(Boolean);
    } else if (existing && b.fields === undefined) {
      s.fields = [];
    }
    s.groupBy = s.fields.some((f) => f.key === b.groupBy && f.type === 'select') ? b.groupBy : '';
    // "Show inside the pages of another section" adds a Belongs to field
    const insideOf = String(b.insideOf || '');
    const target = insideOf ? await C.getSection(insideOf) : null;
    s.insideOf = target ? target.slug : '';
    if (target && !s.fields.some((f) => f.type === 'reference' && f.refSection === target.slug)) {
      let key = 'belongsTo';
      while (s.fields.some((f) => f.key === key)) key += '2';
      s.fields.unshift({ key, label: `Belongs to (${target.singular || target.name})`, type: 'reference', refSection: target.slug, required: false, help: `Choose the ${String(target.singular || target.name).toLowerCase()} this item appears under.`, options: [] });
    }
    delete s.presetFields;
    const saved = await C.saveSection(s);
    await C.ensureSectionMenuItem(saved, b.menuParent === undefined ? 'none' : String(b.menuParent));
    // home page block
    const home = await C.getHome();
    let blocks = home.blocks || [];
    const onHome = F.asArray(b.onHome).concat(b.onHome).includes('1');
    const has = blocks.some((x) => x.type === 'section' && x.data.section === saved.slug);
    if (onHome && !has) {
      const contactIdx = blocks.findIndex((x) => x.type === 'contact');
      const block = { id: C.newId(), type: 'section', visible: true, data: { section: saved.slug, heading: saved.name, intro: saved.intro, limit: 6, buttonLabel: 'View all' } };
      if (contactIdx >= 0) blocks.splice(contactIdx, 0, block); else blocks.push(block);
      await C.saveHome(blocks);
    } else if (!onHome && has) {
      blocks = blocks.filter((x) => !(x.type === 'section' && x.data.section === saved.slug));
      await C.saveHome(blocks);
    }
    await C.audit(req.user, existing ? 'changed the settings of section' : 'created section', saved.name);
    C.invalidate();
    setFlash(res, 'ok', existing ? 'Section saved.' : 'Section created. Review its fields below, then start adding content.');
    res.redirect('/admin/sections/' + saved.slug);
  }

  app.post('/admin/sections/new', needPerm('structure'), async (req, res) => saveSection(req, res, null));
  app.post('/admin/sections/:slug', needPerm('structure'), async (req, res) => {
    const s = await C.getSection(req.params.slug);
    if (!s) throw new HttpError(404, 'Section not found');
    return saveSection(req, res, s);
  });
  app.post('/admin/sections/:slug/delete', needPerm('structure'), async (req, res) => {
    const s = await C.getSection(req.params.slug);
    if (!s) throw new HttpError(404, 'Section not found');
    if (s.system) { setFlash(res, 'error', 'Built in sections cannot be deleted. You can remove them from the menu and home page instead.'); return res.redirect('/admin/sections/' + s.slug); }
    const n = await col('entries').countDocuments({ section: s.slug });
    await col('entries').deleteMany({ section: s.slug });
    await col('revisions').deleteMany({ section: s.slug });
    await col('sections').deleteOne({ _id: s._id });
    await col('menu').deleteMany({ section: s.slug });
    const home = await C.getHome();
    await C.saveHome((home.blocks || []).filter((x) => !(x.type === 'section' && x.data.section === s.slug)));
    await C.audit(req.user, 'deleted section', s.name, `${n} items removed`);
    C.invalidate();
    setFlash(res, 'ok', `Section "${s.name}" was deleted.`);
    res.redirect('/admin/sections');
  });

  // ----- menu -----
  app.get('/admin/menu', needPerm('structure'), async (req, res) => {
    const ctx = await ctxFor(req, res);
    const pageSections = ctx.sections.filter((s) => s.rootUrls);
    ctx.pages = [];
    for (const s of pageSections) ctx.pages.push(...(await C.listEntries(s, { limit: 500 })).items);
    res.html(A.menuPage(ctx, await C.getMenu(), ctx.sections));
  });
  app.post('/admin/menu', needPerm('structure'), async (req, res) => {
    const b = req.body;
    const label = String(b.label || '').trim().slice(0, 60);
    const url = String(b.target || b.url || '').trim().slice(0, 300) || '#';
    if (!label) { setFlash(res, 'error', 'Give the menu entry a label.'); return res.redirect('/admin/menu'); }
    const parent = b.parent ? String(b.parent) : null;
    const sectionSlug = /^\/[a-z0-9-]+$/.test(url) && (await C.getSection(url.slice(1))) && !(await col('menu').findOne({ section: url.slice(1) })) ? url.slice(1) : undefined;
    await col('menu').insertOne({ _id: C.newId(), label, url: safeUrl(url) || '#', parent, order: await C.nextMenuOrder(parent), visible: true, ...(sectionSlug ? { section: sectionSlug } : {}) });
    await C.audit(req.user, 'added menu entry', label);
    C.invalidate();
    setFlash(res, 'ok', 'Menu entry added.');
    res.redirect('/admin/menu');
  });
  app.post('/admin/menu/:id', needPerm('structure'), async (req, res) => {
    const b = req.body;
    const items = await C.getMenu();
    const it = items.find((x) => x._id === req.params.id);
    if (!it) throw new HttpError(404, 'Menu entry not found');
    const siblings = items.filter((x) => (x.parent || null) === (it.parent || null)).sort((a, c) => a.order - c.order);
    if (b.do === 'delete') {
      await col('menu').deleteOne({ _id: it._id });
      for (const k of items.filter((x) => x.parent === it._id)) await col('menu').updateOne({ _id: k._id }, { $set: { parent: null, order: await C.nextMenuOrder(null) } });
      await C.audit(req.user, 'removed menu entry', it.label);
    } else if (b.do === 'up' || b.do === 'down') {
      const i = siblings.findIndex((x) => x._id === it._id);
      const j = b.do === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < siblings.length) {
        [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
        for (let k = 0; k < siblings.length; k++) await col('menu').updateOne({ _id: siblings[k]._id }, { $set: { order: k + 1 } });
      }
    } else {
      const parent = b.parent ? String(b.parent) : null;
      if (parent && (parent === it._id || items.some((x) => x.parent === it._id))) { setFlash(res, 'error', 'An entry that has sub items cannot be moved under another entry.'); return res.redirect('/admin/menu'); }
      const set = { label: String(b.label || it.label).trim().slice(0, 60), visible: F.asArray(b.visible).concat(b.visible).includes('1'), parent, autoSection: parent ? '' : String(b.autoSection || '') };
      if (!it.section) set.url = safeUrl(String(b.url || '#').trim().slice(0, 300)) || '#';
      if ((it.parent || null) !== parent) set.order = await C.nextMenuOrder(parent);
      await col('menu').updateOne({ _id: it._id }, { $set: set });
      await C.audit(req.user, 'changed menu entry', set.label);
    }
    C.invalidate();
    setFlash(res, 'ok', 'Menu updated.');
    res.redirect('/admin/menu');
  });

  // ----- home page -----
  app.get('/admin/home', needPerm('structure'), async (req, res) => {
    const ctx = await ctxFor(req, res);
    res.html(A.homeEditor(ctx, (await C.getHome()).blocks || [], ctx.sections));
  });
  app.post('/admin/home', needPerm('structure'), async (req, res) => {
    const type = BLOCKS[req.body.type] ? req.body.type : null;
    if (!type) throw new HttpError(400, 'Unknown block type');
    const blocks = [...((await C.getHome()).blocks || [])];
    const data = {};
    if (type === 'section' || type === 'notices') {
      const s = await C.getSection(String(req.body.section || ''));
      if (!s) { setFlash(res, 'error', 'Choose which section the block should show.'); return res.redirect('/admin/home'); }
      Object.assign(data, { section: s.slug, heading: s.name, limit: 6 });
    }
    if (type === 'contact') Object.assign(data, { heading: 'Contact Us', showForm: true, showMap: true });
    const block = { id: C.newId(), type, visible: true, data };
    blocks.push(block);
    await C.saveHome(blocks);
    await C.audit(req.user, 'added a home page block', BLOCKS[type].label);
    res.redirect('/admin/home/' + block.id);
  });
  app.get('/admin/home/:id', needPerm('structure'), async (req, res) => {
    const b = ((await C.getHome()).blocks || []).find((x) => x.id === req.params.id);
    if (!b || !BLOCKS[b.type]) throw new HttpError(404, 'Block not found');
    const ctx = await ctxFor(req, res);
    res.html(A.blockForm(ctx, b, ctx.sections));
  });
  app.post('/admin/home/:id/edit', needPerm('structure'), async (req, res) => {
    const blocks = [...((await C.getHome()).blocks || [])];
    const b = blocks.find((x) => x.id === req.params.id);
    if (!b || !BLOCKS[b.type]) throw new HttpError(404, 'Block not found');
    const data = {};
    for (const f of BLOCKS[b.type].fields) data[f.key] = await F.parse(f, req.body, req.files || {}, b.data[f.key]);
    b.data = data;
    await C.saveHome(blocks);
    await C.audit(req.user, 'edited a home page block', BLOCKS[b.type].label);
    setFlash(res, 'ok', 'Block saved.');
    res.redirect('/admin/home');
  });
  app.post('/admin/home/:id', needPerm('structure'), async (req, res) => {
    const blocks = [...((await C.getHome()).blocks || [])];
    const i = blocks.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw new HttpError(404, 'Block not found');
    const d = req.body.do;
    if (d === 'up' && i > 0) [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
    else if (d === 'down' && i < blocks.length - 1) [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]];
    else if (d === 'toggle') blocks[i] = { ...blocks[i], visible: blocks[i].visible === false };
    else if (d === 'delete') blocks.splice(i, 1);
    await C.saveHome(blocks);
    await C.audit(req.user, 'rearranged the home page', d);
    res.redirect('/admin/home');
  });

  // ----- settings -----
  app.get('/admin/settings', needPerm('settings'), async (req, res) => {
    const ctx = await ctxFor(req, res);
    res.html(A.settingsPage(ctx, ctx.settings));
  });
  app.post('/admin/settings', needPerm('settings'), async (req, res) => {
    const current = await C.getSettings();
    const values = {};
    for (const [, list] of A.SETTINGS_FIELDS) for (const [key, label, type] of list) values[key] = await F.parse({ key, label, type }, req.body, req.files || {}, current[key]);
    if (values.mapEmbed && !/^https:\/\/www\.google\.com\/maps\/embed/.test(values.mapEmbed)) values.mapEmbed = current.mapEmbed;
    await C.saveSettings(values);
    await C.audit(req.user, 'changed the site settings', '');
    setFlash(res, 'ok', 'Settings saved.');
    res.redirect('/admin/settings');
  });

  // ----- users -----
  app.get('/admin/users', needPerm('users'), async (req, res) => {
    const users = await col('users').find({}).sort({ name: 1 }).toArray();
    res.html(A.userList(await ctxFor(req, res), users));
  });
  app.get('/admin/users/new', needPerm('users'), async (req, res) => {
    const ctx = await ctxFor(req, res);
    res.html(A.userForm(ctx, { role: 'staff', active: true, access: { '*': 'none' }, perms: {} }, ctx.sections));
  });
  app.get('/admin/users/:id', needPerm('users'), async (req, res) => {
    const u = await col('users').findOne({ _id: req.params.id });
    if (!u) throw new HttpError(404, 'User not found');
    const ctx = await ctxFor(req, res);
    if (u.role === 'superadmin' && !auth.isSuper(req.user)) return deny(req, res);
    res.html(A.userForm(ctx, u, ctx.sections));
  });

  async function saveUser(req, res, existing) {
    const b = req.body;
    const me = req.user;
    const ctx = await ctxFor(req, res);
    const form = { ...(existing || {}), name: String(b.name || '').trim().slice(0, 120), email: String(b.email || '').trim().toLowerCase().slice(0, 200) };
    const again = (error) => res.html(A.userForm(ctx, { ...form, access: b.access || {}, perms: b.perms || {} }, ctx.sections, { error }), 400);
    if (!form.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return again('Enter a name and a valid email address.');
    const clash = await col('users').findOne({ email: form.email });
    if (clash && (!existing || clash._id !== existing._id)) return again('Another account already uses this email.');
    if (b.password || !existing) {
      const p = auth.passwordProblem(b.password, form);
      if (p) return again(p);
    }
    let role = existing ? existing.role : 'staff';
    if (auth.isSuper(me) && ['staff', 'superadmin'].includes(b.role)) role = b.role;
    // Staff who manage users cannot hand out more than they have themselves
    const perms = {};
    for (const k of Object.keys(auth.PERMS)) perms[k] = Boolean(b.perms && b.perms[k] === '1') && auth.can(me, k);
    const order = ['none', 'edit', 'publish'];
    const cap = (slug, lv) => (auth.isSuper(me) ? lv : order[Math.min(order.indexOf(lv), order.indexOf(auth.sectionLevel(me, slug === '*' ? '' : slug)))] || 'none');
    const access = {};
    for (const [slug, lv] of Object.entries(b.access || {})) {
      if (lv === 'inherit') continue;
      if (slug !== '*' && !ctx.sections.some((s) => s.slug === slug)) continue;
      if (!auth.LEVELS[lv]) continue;
      access[slug] = slug === '*' && !auth.isSuper(me) ? 'none' : cap(slug, lv);
    }
    let active = F.asArray(b.active).concat(b.active).includes('1');
    if (existing && existing._id === me._id) { active = true; role = existing.role; }
    if (existing && existing.role === 'superadmin' && (role !== 'superadmin' || !active)) {
      const supers = await col('users').countDocuments({ role: 'superadmin', active: true });
      if (supers <= 1) return again('This is the only active super admin. Create another super admin first.');
    }
    const set = { name: form.name, email: form.email, role, perms, access, active, updatedAt: new Date() };
    if (b.password) {
      set.passwordHash = await auth.hashPassword(b.password);
      set.failedLogins = 0;
      set.lockUntil = null;
      // A password given by an administrator is temporary: the owner must replace it at first sign in
      const ownAccount = existing && existing._id === me._id;
      set.mustChangePassword = !ownAccount;
      set.tempExpires = ownAccount ? null : new Date(Date.now() + TEMP_HOURS * 3600 * 1000);
    }
    if (existing) {
      await col('users').updateOne({ _id: existing._id }, { $set: set });
      if (b.password || !active) await auth.destroyUserSessions(existing._id, existing._id === me._id ? req.session._id : undefined);
      await C.audit(me, b.password && existing._id !== me._id ? 'reset the password of' : 'updated user account', form.email, b.password && existing._id !== me._id ? 'temporary password issued' : b.password ? 'password changed' : '');
      setFlash(res, 'ok', b.password && existing._id !== me._id ? `User saved. Give ${form.name} the temporary password privately. It works once, for ${TEMP_HOURS} hours, and they must then choose their own.` : 'User saved.');
      return res.redirect('/admin/users/' + existing._id);
    }
    const doc = { _id: C.newId(), ...set, createdAt: new Date(), createdBy: me.name };
    await col('users').insertOne(doc);
    await C.audit(me, 'created user account', form.email, role);
    setFlash(res, 'ok', `User created. Give ${form.name} the temporary password privately. It is valid for ${TEMP_HOURS} hours, and they must choose their own password when they first sign in.`);
    res.redirect('/admin/users/' + doc._id);
  }

  app.post('/admin/users/new', needPerm('users'), async (req, res) => saveUser(req, res, null));
  app.post('/admin/users/:id', needPerm('users'), async (req, res) => {
    const u = await col('users').findOne({ _id: req.params.id });
    if (!u) throw new HttpError(404, 'User not found');
    if (u.role === 'superadmin' && !auth.isSuper(req.user)) return deny(req, res);
    return saveUser(req, res, u);
  });
  app.post('/admin/users/:id/signout', needPerm('users'), async (req, res) => {
    const u = await col('users').findOne({ _id: req.params.id });
    if (!u || (u.role === 'superadmin' && !auth.isSuper(req.user))) return deny(req, res);
    await auth.destroyUserSessions(u._id);
    await C.audit(req.user, 'signed out user everywhere', u.email);
    setFlash(res, 'ok', `${u.name} has been signed out of all devices.`);
    res.redirect('/admin/users/' + u._id);
  });
  app.post('/admin/users/:id/delete', needPerm('users'), async (req, res) => {
    const u = await col('users').findOne({ _id: req.params.id });
    if (!u || (u.role === 'superadmin' && !auth.isSuper(req.user))) return deny(req, res);
    if (u._id === req.user._id) { setFlash(res, 'error', 'You cannot delete your own account.'); return res.redirect('/admin/users/' + u._id); }
    if (u.role === 'superadmin' && (await col('users').countDocuments({ role: 'superadmin' })) <= 1) { setFlash(res, 'error', 'The last super admin cannot be deleted.'); return res.redirect('/admin/users/' + u._id); }
    await col('users').deleteOne({ _id: u._id });
    await auth.destroyUserSessions(u._id);
    await C.audit(req.user, 'deleted user account', u.email);
    setFlash(res, 'ok', 'User deleted.');
    res.redirect('/admin/users');
  });

  // ----- forced password change after a temporary password -----
  app.get('/admin/change-password', async (req, res) => {
    if (!req.user.mustChangePassword) return res.redirect('/admin/account');
    res.html(A.changePasswordPage({ settings: await C.getSettings(), version: VERSION, csrf: req.session.csrf, user: req.user }));
  });
  app.post('/admin/change-password', async (req, res) => {
    if (!req.user.mustChangePassword) return res.redirect('/admin/account');
    const b = req.body;
    const again = async (error) => res.html(A.changePasswordPage({ settings: await C.getSettings(), version: VERSION, csrf: req.session.csrf, user: req.user, error }), 400);
    if (!rateLimit('pw:' + req.user._id, 10, 15 * 60 * 1000).ok) return again('Too many attempts. Try again later.');
    const p = auth.passwordProblem(b.password, req.user);
    if (p) return again(p);
    if (b.password !== b.password2) return again('The two passwords do not match.');
    if (await auth.verifyPassword(String(b.password), req.user.passwordHash)) return again('Choose a password different from the temporary one.');
    await col('users').updateOne({ _id: req.user._id }, { $set: { passwordHash: await auth.hashPassword(b.password), mustChangePassword: false, tempExpires: null, updatedAt: new Date() } });
    await auth.destroyUserSessions(req.user._id, req.session._id);
    await C.audit(req.user, 'chose their own password', req.user.email);
    setFlash(res, 'ok', 'Your password has been set. Welcome to the website dashboard.');
    res.redirect('/admin');
  });

  // ----- my account -----
  app.get('/admin/account', async (req, res) => res.html(A.accountPage(await ctxFor(req, res))));
  app.post('/admin/account', async (req, res) => {
    const b = req.body;
    const ctx = await ctxFor(req, res);
    if (!rateLimit('pw:' + req.user._id, 10, 15 * 60 * 1000).ok) return res.html(A.accountPage(ctx, { error: 'Too many attempts. Try again later.' }), 429);
    if (!(await auth.verifyPassword(String(b.current || ''), req.user.passwordHash))) return res.html(A.accountPage(ctx, { error: 'Your current password is not correct.' }), 400);
    const p = auth.passwordProblem(b.password, req.user);
    if (p) return res.html(A.accountPage(ctx, { error: p }), 400);
    if (b.password !== b.password2) return res.html(A.accountPage(ctx, { error: 'The two new passwords do not match.' }), 400);
    if (await auth.verifyPassword(String(b.password), req.user.passwordHash)) return res.html(A.accountPage(ctx, { error: 'The new password must be different from the current one.' }), 400);
    await col('users').updateOne({ _id: req.user._id }, { $set: { passwordHash: await auth.hashPassword(b.password), mustChangePassword: false, tempExpires: null, updatedAt: new Date() } });
    await auth.destroyUserSessions(req.user._id, req.session._id);
    await C.audit(req.user, 'changed their password', req.user.email);
    setFlash(res, 'ok', 'Password changed. Other devices have been signed out.');
    res.redirect('/admin/account');
  });

  // ----- messages -----
  app.get('/admin/messages', needPerm('messages'), async (req, res) => {
    const items = await col('messages').find({}).sort({ createdAt: -1 }).limit(200).toArray();
    res.html(A.messagesPage(await ctxFor(req, res), items, null));
  });
  app.get('/admin/messages/:id', needPerm('messages'), async (req, res) => {
    const m = await col('messages').findOne({ _id: req.params.id });
    if (!m) throw new HttpError(404, 'Message not found');
    if (!m.read) await col('messages').updateOne({ _id: m._id }, { $set: { read: true } });
    const items = await col('messages').find({}).sort({ createdAt: -1 }).limit(200).toArray();
    res.html(A.messagesPage(await ctxFor(req, res), items, m));
  });
  app.post('/admin/messages/:id/delete', needPerm('messages'), async (req, res) => {
    const m = await col('messages').findOne({ _id: req.params.id });
    if (m) { await col('messages').deleteOne({ _id: m._id }); await C.audit(req.user, 'deleted a message from', m.email); }
    setFlash(res, 'ok', 'Message deleted.');
    res.redirect('/admin/messages');
  });

  // ----- activity log -----
  app.get('/admin/activity', needPerm('audit'), async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const items = await col('audit').find({}).sort({ at: -1 }).skip((page - 1) * 100).limit(101).toArray();
    res.html(A.activityPage(await ctxFor(req, res), items.slice(0, 100), page, items.length > 100));
  });

  // ----- backup -----
  app.get('/admin/backup', needSuper, async (req, res) => res.html(A.backupPage(await ctxFor(req, res), { db: db.kind() })));
  app.post('/admin/backup', needSuper, async (req, res) => {
    const { exportAll } = require('../backup');
    const data = await exportAll();
    await C.audit(req.user, 'downloaded a backup', '');
    const name = `website-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const body = JSON.stringify(data, null, 1);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
  });
}

module.exports = { register };
