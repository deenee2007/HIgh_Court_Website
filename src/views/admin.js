'use strict';
// Admin dashboard templates
const { html, raw, sel, chk, safeUrl } = require('./html');
const { img } = require('../media');
const F = require('../fields');
const { LAYOUTS } = require('../layouts');
const { BLOCKS } = require('../blocks');
const { PERMS, LEVELS, isSuper, can, canEdit, canPublish, sectionLevel } = require('../auth');

const BS_CSS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
const BS_JS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js';
const FA_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
const TINYMCE = 'https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.3/tinymce.min.js';

const dt = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
const badge = (status) => (status === 'published' ? html`<span class="badge text-bg-success">Published</span>` : html`<span class="badge text-bg-secondary">Draft</span>`);

function shell(ctx, { title, body, editor = false, active = '' }) {
  const u = ctx.user;
  const sections = (ctx.sections || []).filter((s) => canEdit(u, s.slug));
  const link = (href, icon, label, key, extra = '') => html`<a class="nav-link${active === key ? ' active' : ''}" href="${href}"><i class="${icon} fa-fw me-2"></i>${label}${extra}</a>`;
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${title} | Admin | ${ctx.settings.shortName}</title>
  <link href="${BS_CSS}" rel="stylesheet" crossorigin="anonymous">
  <link href="${FA_CSS}" rel="stylesheet" crossorigin="anonymous" referrerpolicy="no-referrer">
  <link href="/css/admin.css?v=${ctx.version}" rel="stylesheet">
</head>
<body data-csrf="${ctx.csrf}">
<div class="admin-wrap">
  <aside class="admin-side" id="adminSide">
    <a href="/admin" class="brand"><img src="${img(ctx.settings.logo, 80)}" alt="" width="34" height="34"> <span>Website Admin</span></a>
    <nav class="nav flex-column">
      ${link('/admin', 'fas fa-gauge', 'Dashboard', 'dashboard')}
      <div class="side-label">Content</div>
      ${sections.map((s) => link('/admin/content/' + s.slug, iconFor(s.layout), s.name, 'content:' + s.slug))}
      ${can(u, 'messages') ? link('/admin/messages', 'fas fa-inbox', 'Messages', 'messages', ctx.unread ? html` <span class="badge text-bg-warning ms-1">${ctx.unread}</span>` : '') : ''}
      ${can(u, 'structure') ? html`<div class="side-label">Structure</div>
        ${link('/admin/sections', 'fas fa-layer-group', 'Sections', 'sections')}
        ${link('/admin/menu', 'fas fa-bars', 'Menu', 'menu')}
        ${link('/admin/home', 'fas fa-house', 'Home page', 'home')}` : ''}
      <div class="side-label">Administration</div>
      ${can(u, 'settings') ? link('/admin/settings', 'fas fa-sliders', 'Site settings', 'settings') : ''}
      ${can(u, 'users') ? link('/admin/users', 'fas fa-users', 'Users', 'users') : ''}
      ${can(u, 'audit') ? link('/admin/activity', 'fas fa-clock-rotate-left', 'Activity log', 'activity') : ''}
      ${isSuper(u) ? link('/admin/backup', 'fas fa-download', 'Backup', 'backup') : ''}
      ${link('/admin/account', 'fas fa-user-gear', 'My account', 'account')}
    </nav>
  </aside>
  <div class="admin-main">
    <header class="admin-top">
      <button class="btn btn-sm btn-light d-lg-none" type="button" data-toggle-side aria-label="Menu"><i class="fas fa-bars"></i></button>
      <div class="ms-auto d-flex align-items-center gap-3">
        <a href="/" target="_blank" rel="noopener" class="small text-decoration-none"><i class="fas fa-up-right-from-square me-1"></i>View website</a>
        <span class="small text-muted d-none d-sm-inline">${u.name}${isSuper(u) ? ' (Super admin)' : ''}</span>
        <form method="post" action="/admin/logout" class="m-0">${csrfField(ctx)}<button class="btn btn-sm btn-outline-secondary">Sign out</button></form>
      </div>
    </header>
    <main class="admin-content">
      ${ctx.warnings && ctx.warnings.length ? ctx.warnings.map((w) => html`<div class="alert alert-warning py-2 small">${w}</div>`) : ''}
      ${ctx.flash ? html`<div class="alert alert-${ctx.flash.type === 'error' ? 'danger' : 'success'} alert-dismissible fade show" role="alert">${ctx.flash.text}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>` : ''}
      ${body}
    </main>
  </div>
</div>
<script src="${BS_JS}" crossorigin="anonymous"></script>
${editor ? html`<script src="${TINYMCE}" referrerpolicy="origin" crossorigin="anonymous"></script>` : ''}
<script src="/js/admin.js?v=${ctx.version}"></script>
</body></html>`;
}

function iconFor(layout) {
  return { profiles: 'fas fa-user-tie', departments: 'fas fa-sitemap', articles: 'far fa-newspaper', documents: 'far fa-file-lines', gallery: 'far fa-images', honours: 'fas fa-award', notices: 'fas fa-bullhorn', pages: 'far fa-file', cards: 'fas fa-table-cells-large' }[layout] || 'far fa-folder';
}

function pageHead(title, actions = '', sub = '') {
  return html`<div class="d-flex flex-wrap align-items-center gap-2 mb-4"><div><h1 class="h3 mb-0">${title}</h1>${sub ? html`<div class="text-muted small mt-1">${sub}</div>` : ''}</div><div class="ms-auto d-flex gap-2">${actions}</div></div>`;
}

// ---------- login and setup ----------
function authPage(ctx, { title, body }) {
  return html`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
    <title>${title}</title><link href="${BS_CSS}" rel="stylesheet" crossorigin="anonymous"><link href="/css/admin.css?v=${ctx.version}" rel="stylesheet"></head>
    <body class="login-body"><div class="login-card card shadow-sm"><div class="card-body p-4 p-md-5">
      <div class="text-center mb-4"><img src="${img(ctx.settings.logo, 160)}" width="72" height="72" class="rounded-circle mb-3" alt=""><h1 class="h4">${title}</h1><div class="text-muted small">${ctx.settings.siteName}</div></div>
      ${ctx.error ? html`<div class="alert alert-danger small">${ctx.error}</div>` : ''}${ctx.notice ? html`<div class="alert alert-success small">${ctx.notice}</div>` : ''}
      ${body}</div></div></body></html>`;
}

function loginPage(ctx) {
  return authPage(ctx, { title: 'Sign in', body: html`<form method="post" action="/admin/login">
    <input type="hidden" name="_login" value="${ctx.loginToken}">
    <div class="mb-3"><label class="form-label" for="email">Email</label><input class="form-control" id="email" name="email" type="email" autocomplete="username" required autofocus value="${ctx.email || ''}"></div>
    <div class="mb-4"><label class="form-label" for="password">Password</label><input class="form-control" id="password" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-success w-100">Sign in</button></form>` });
}

function setupPage(ctx) {
  return authPage(ctx, { title: 'Create the super admin', body: html`<p class="small text-muted">No accounts exist yet. Create the first account. It will have full control and can create other accounts.</p>
    <form method="post" action="/admin/setup">
      <input type="hidden" name="_login" value="${ctx.loginToken}">
      ${ctx.needToken ? html`<div class="mb-3"><label class="form-label" for="token">Setup code</label><input class="form-control" id="token" name="token" required><div class="form-text">The SETUP_TOKEN value from the Render environment settings.</div></div>` : ''}
      <div class="mb-3"><label class="form-label" for="name">Full name</label><input class="form-control" id="name" name="name" required value="${ctx.values?.name || ''}"></div>
      <div class="mb-3"><label class="form-label" for="email">Email</label><input class="form-control" id="email" name="email" type="email" required value="${ctx.values?.email || ''}"></div>
      <div class="mb-3"><label class="form-label" for="password">Password</label><input class="form-control" id="password" name="password" type="password" autocomplete="new-password" required minlength="10"><div class="form-text">At least 10 characters, with letters and numbers.</div></div>
      <div class="mb-4"><label class="form-label" for="password2">Repeat password</label><input class="form-control" id="password2" name="password2" type="password" autocomplete="new-password" required></div>
      <button class="btn btn-success w-100">Create account</button></form>` });
}

// ---------- dashboard ----------
function dashboard(ctx, d) {
  const u = ctx.user;
  return shell(ctx, { title: 'Dashboard', active: 'dashboard', body: html`
    ${pageHead(`Welcome, ${u.name.split(' ')[0]}`, '', 'Choose a section on the left to add or edit content.')}
    <div class="row g-3 mb-4">
      ${d.counts.map((c) => html`<div class="col-6 col-md-4 col-xl-3"><a class="card stat-card h-100 text-decoration-none" href="/admin/content/${c.section.slug}"><div class="card-body">
        <div class="d-flex align-items-center gap-2 text-muted small"><i class="${iconFor(c.section.layout)}"></i>${c.section.name}</div>
        <div class="fs-3 fw-bold text-dark">${c.published}</div><div class="small text-muted">published${c.drafts ? html`, <span class="text-warning-emphasis">${c.drafts} draft${c.drafts > 1 ? 's' : ''}</span>` : ''}</div>
      </div></a></div>`)}
    </div>
    <div class="row g-4">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white fw-bold">Drafts waiting to be published</div>
        <ul class="list-group list-group-flush">${d.drafts.length ? d.drafts.map((e) => html`<li class="list-group-item d-flex justify-content-between"><a href="/admin/content/${e.section}/${e._id}">${e.title}</a><span class="small text-muted">${e.sectionName}, ${dt(e.updatedAt)}</span></li>`) : html`<li class="list-group-item text-muted small">No drafts.</li>`}</ul></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header bg-white fw-bold">Recent changes</div>
        <ul class="list-group list-group-flush">${d.recent.length ? d.recent.map((a) => html`<li class="list-group-item small"><strong>${a.userName}</strong> ${a.action} <em>${a.target}</em><span class="text-muted float-end">${dt(a.at)}</span></li>`) : html`<li class="list-group-item text-muted small">Nothing yet.</li>`}</ul></div></div>
    </div>` });
}

// ---------- entries ----------
function entryList(ctx, section, d) {
  const manual = section.sort === 'manual';
  const canPub = canPublish(ctx.user, section.slug);
  return shell(ctx, { title: section.name, active: 'content:' + section.slug, body: html`
    ${pageHead(section.name, html`<a href="/admin/content/${section.slug}/new" class="btn btn-success"><i class="fas fa-plus me-1"></i>Add ${section.singular || 'item'}</a>
      ${section.layout !== 'pages' ? html`<a href="/${section.slug}" target="_blank" rel="noopener" class="btn btn-outline-secondary">View on site</a>` : ''}`, LAYOUTS[section.layout]?.label)}
    <form class="row g-2 mb-3" method="get">
      <div class="col-md-5"><input type="search" class="form-control" name="q" value="${d.q}" placeholder="Search ${section.name.toLowerCase()}"></div>
      <div class="col-md-3"><select name="status" class="form-select"><option value="">All statuses</option><option value="published"${sel('published', d.status)}>Published</option><option value="draft"${sel('draft', d.status)}>Drafts</option></select></div>
      <div class="col-md-2 d-grid"><button class="btn btn-outline-success">Filter</button></div>
    </form>
    <div class="card"><div class="table-responsive"><table class="table table-hover align-middle mb-0">
      <thead class="table-light"><tr>${manual ? html`<th style="width:90px">Order</th>` : ''}<th>${section.titleLabel || 'Title'}</th><th>Status</th><th>Last change</th><th class="text-end">Actions</th></tr></thead>
      <tbody>${d.items.length ? d.items.map((e, i) => html`<tr>
        ${manual ? html`<td><form method="post" action="/admin/content/${section.slug}/${e._id}/move" class="d-flex gap-1">${csrfField(ctx)}
          <button name="dir" value="up" class="btn btn-sm btn-light"${i === 0 && d.page === 1 ? raw(' disabled') : ''} title="Move up">&uarr;</button>
          <button name="dir" value="down" class="btn btn-sm btn-light"${i === d.items.length - 1 && d.page * d.perPage >= d.total ? raw(' disabled') : ''} title="Move down">&darr;</button></form></td>` : ''}
        <td><a href="/admin/content/${section.slug}/${e._id}" class="fw-semibold text-decoration-none">${e.title}</a>${thumb(section, e)}</td>
        <td>${badge(e.status)}</td>
        <td class="small text-muted">${dt(e.updatedAt)}${e.updatedBy ? html`<br>${e.updatedBy}` : ''}</td>
        <td class="text-end text-nowrap"><a href="/admin/content/${section.slug}/${e._id}" class="btn btn-sm btn-outline-success">Edit</a>
          ${e.status === 'published' && (section.detail || section.rootUrls) ? html` <a href="${ctx.entryUrl(section, e)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary">View</a>` : ''}</td>
      </tr>`) : html`<tr><td colspan="5" class="text-center text-muted py-4">Nothing here yet.</td></tr>`}</tbody>
    </table></div></div>
    ${d.total > d.perPage ? html`<nav class="mt-3"><ul class="pagination">${Array.from({ length: Math.ceil(d.total / d.perPage) }, (_, i) => html`<li class="page-item${i + 1 === d.page ? ' active' : ''}"><a class="page-link" href="?page=${i + 1}&q=${encodeURIComponent(d.q)}&status=${d.status}">${i + 1}</a></li>`)}</ul></nav>` : ''}
    ${!canPub ? html`<p class="small text-muted mt-3">You can create and edit drafts here. Someone with publishing rights must publish them.</p>` : ''}` });
}

function thumb(section, e) {
  const f = section.fields.find((x) => x.type === 'image');
  const v = f && e.data[f.key];
  return v ? html`<img src="${img(v, 80, 80, 'fill')}" alt="" class="list-thumb ms-2">` : '';
}

function entryForm(ctx, section, e, opts = {}) {
  const isNew = !e._id;
  const canPub = canPublish(ctx.user, section.slug);
  const action = isNew ? `/admin/content/${section.slug}/new` : `/admin/content/${section.slug}/${e._id}`;
  const hasRich = section.fields.some((f) => f.type === 'richtext');
  return shell(ctx, { title: isNew ? 'Add ' + (section.singular || 'item') : e.title, active: 'content:' + section.slug, editor: hasRich, body: html`
    <nav aria-label="breadcrumb"><ol class="breadcrumb small"><li class="breadcrumb-item"><a href="/admin/content/${section.slug}">${section.name}</a></li><li class="breadcrumb-item active">${isNew ? 'New' : e.title}</li></ol></nav>
    ${pageHead(isNew ? 'Add ' + (section.singular || 'item') : 'Edit ' + (section.singular || 'item').toLowerCase(), isNew ? '' : html`${badge(e.status)}
      ${section.detail || section.rootUrls ? html`<a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="${ctx.entryUrl(section, e)}${e.status === 'published' ? '' : '?preview=1'}">${e.status === 'published' ? 'View' : 'Preview'}</a>` : ''}
      <a class="btn btn-sm btn-outline-secondary" href="/admin/content/${section.slug}/${e._id}/history">History</a>`)}
    ${opts.error ? html`<div class="alert alert-danger">${opts.error}</div>` : ''}
    <form method="post" action="${action}" enctype="multipart/form-data" class="entry-form" novalidate>
      ${csrfField(ctx)}
      <input type="hidden" name="updatedAt" value="${e.updatedAt ? new Date(e.updatedAt).toISOString() : ''}">
      <div class="row g-4">
        <div class="col-lg-9">
          <div class="card mb-4"><div class="card-body">
            <div class="mb-3"><label class="form-label fw-semibold" for="title">${section.titleLabel || 'Title'} <span class="text-danger">*</span></label>
              <input class="form-control form-control-lg" id="title" name="title" value="${e.title || ''}" required maxlength="300" data-slug-source></div>
            <details class="small"><summary class="text-muted">Web address</summary>
              <div class="input-group input-group-sm mt-2"><span class="input-group-text">${section.rootUrls ? '/' : `/${section.slug}/`}</span><input class="form-control" name="slug" value="${e.slug || ''}" pattern="[a-z0-9\\-]*" data-slug-target placeholder="created from the title"></div>
              <div class="form-text">Lowercase letters, numbers and hyphens. Changing it breaks links people may have saved.</div></details>
          </div></div>
          ${section.fields.map((f) => html`<div class="card mb-3 field-card"><div class="card-body">
            <label class="form-label fw-semibold" for="f_${f.key}">${f.label}${f.required ? html` <span class="text-danger">*</span>` : ''}</label>
            ${f.help ? html`<div class="form-text mt-0 mb-2">${f.help}</div>` : ''}
            ${F.input(f, e.data ? e.data[f.key] : '', opts)}
          </div></div>`)}
        </div>
        <div class="col-lg-3"><div class="card sticky-lg-top" style="top:80px"><div class="card-body d-grid gap-2">
          ${canPub ? html`<button class="btn btn-success" name="action" value="publish"><i class="fas fa-globe me-1"></i>${e.status === 'published' ? 'Save and keep published' : 'Publish'}</button>` : ''}
          <button class="btn btn-outline-secondary" name="action" value="draft"><i class="far fa-floppy-disk me-1"></i>${e.status === 'published' ? 'Save as draft (unpublish)' : 'Save draft'}</button>
          ${!canPub ? html`<p class="small text-muted mb-0">Your changes are saved as a draft for someone with publishing rights to review.</p>` : ''}
          <a href="/admin/content/${section.slug}" class="btn btn-link">Cancel</a>
        </div></div>
        ${!isNew && canPub ? html`<div class="card mt-3 border-danger-subtle"><div class="card-body">
          <button type="submit" form="deleteForm" class="btn btn-sm btn-outline-danger w-100" data-confirm="Delete this item permanently? This cannot be undone."><i class="far fa-trash-can me-1"></i>Delete</button></div></div>` : ''}
        ${!isNew ? html`<div class="small text-muted mt-3">Created ${dt(e.createdAt)}${e.createdBy ? ' by ' + e.createdBy : ''}<br>Last changed ${dt(e.updatedAt)}${e.updatedBy ? ' by ' + e.updatedBy : ''}</div>` : ''}
        </div>
      </div>
    </form>
    ${!isNew && canPub ? html`<form id="deleteForm" method="post" action="/admin/content/${section.slug}/${e._id}/delete">${csrfField(ctx)}</form>` : ''}` });
}

function historyPage(ctx, section, e, revisions) {
  return shell(ctx, { title: 'History', active: 'content:' + section.slug, body: html`
    <nav aria-label="breadcrumb"><ol class="breadcrumb small"><li class="breadcrumb-item"><a href="/admin/content/${section.slug}">${section.name}</a></li><li class="breadcrumb-item"><a href="/admin/content/${section.slug}/${e._id}">${e.title}</a></li><li class="breadcrumb-item active">History</li></ol></nav>
    ${pageHead('Earlier versions', '', 'A copy is kept every time this item is saved. Restoring creates a draft you can review before publishing.')}
    <div class="card"><ul class="list-group list-group-flush">${revisions.length ? revisions.map((r) => html`<li class="list-group-item d-flex align-items-center gap-3">
      <div><strong>${r.title}</strong> ${badge(r.status)}<div class="small text-muted">Saved ${dt(r.at)} by ${r.by}</div></div>
      <form method="post" action="/admin/content/${section.slug}/${e._id}/restore/${r._id}" class="ms-auto">${csrfField(ctx)}<button class="btn btn-sm btn-outline-success" data-confirm="Restore this version as a draft?">Restore</button></form>
    </li>`) : html`<li class="list-group-item text-muted">No earlier versions yet.</li>`}</ul></div>` });
}

// ---------- sections (structure) ----------
function sectionList(ctx, sections, counts) {
  return shell(ctx, { title: 'Sections', active: 'sections', body: html`
    ${pageHead('Sections', html`<a href="/admin/sections/new" class="btn btn-success"><i class="fas fa-plus me-1"></i>New section</a>`, 'Each section is a kind of content (Judges, Directorates, News). Create new ones whenever you need them.')}
    <div class="card"><div class="table-responsive"><table class="table align-middle mb-0">
      <thead class="table-light"><tr><th>Name</th><th>Display style</th><th>Items</th><th>Address</th><th class="text-end"></th></tr></thead>
      <tbody>${sections.map((s) => html`<tr><td class="fw-semibold"><i class="${iconFor(s.layout)} me-2 text-success"></i>${s.name}${s.system ? html` <span class="badge text-bg-light border">built in</span>` : ''}</td>
        <td class="small">${LAYOUTS[s.layout]?.label}</td><td>${counts[s.slug] || 0}</td><td class="small"><code>/${s.layout === 'pages' ? '(page name)' : s.slug}</code></td>
        <td class="text-end text-nowrap"><a href="/admin/sections/${s.slug}" class="btn btn-sm btn-outline-success">Settings and fields</a> <a href="/admin/content/${s.slug}" class="btn btn-sm btn-outline-secondary">Content</a></td></tr>`)}</tbody>
    </table></div></div>` });
}

function fieldRow(f, i, sections) {
  const n = `fields[${i}]`;
  return html`<div class="field-row card mb-2"><div class="card-body py-2">
    <div class="row g-2 align-items-center">
      <div class="col-md-3"><input class="form-control form-control-sm" name="${n}[label]" value="${f.label || ''}" placeholder="Field label" data-field-label></div>
      <div class="col-md-2"><input class="form-control form-control-sm font-monospace" name="${n}[key]" value="${f.key || ''}" placeholder="key" pattern="[a-zA-Z][a-zA-Z0-9]*" data-field-key title="Internal name, letters and numbers only"></div>
      <div class="col-md-3"><select class="form-select form-select-sm" name="${n}[type]" data-field-type>${Object.entries(F.TYPES).map(([k, v]) => html`<option value="${k}"${sel(k, f.type)}>${v}</option>`)}</select></div>
      <div class="col-md-3 small">
        <label class="me-2"><input type="checkbox" class="form-check-input" name="${n}[required]" value="1"${chk(f.required)}> Required</label>
        <label class="me-2" title="Show as a column in document lists"><input type="checkbox" class="form-check-input" name="${n}[showInList]" value="1"${chk(f.showInList)}> In list</label>
        <label title="Offer as a search filter (dropdowns and dates)"><input type="checkbox" class="form-check-input" name="${n}[filter]" value="1"${chk(f.filter)}> Filter</label>
      </div>
      <div class="col-md-1 text-end text-nowrap"><button type="button" class="btn btn-sm btn-light" data-move="up" title="Move up">&uarr;</button><button type="button" class="btn btn-sm btn-light text-danger" data-remove title="Remove field">&times;</button></div>
      <div class="col-md-6" data-show-for="select"><textarea class="form-control form-control-sm" name="${n}[options]" rows="2" placeholder="Choices, one per line">${F.options(f).join('\n')}</textarea></div>
      <div class="col-md-6" data-show-for="reference"><select class="form-select form-select-sm" name="${n}[refSection]"><option value="">Belongs to which section?</option>${sections.map((s) => html`<option value="${s.slug}"${sel(s.slug, f.refSection)}>${s.name}</option>`)}</select></div>
      <div class="col-md-6"><input class="form-control form-control-sm" name="${n}[help]" value="${f.help || ''}" placeholder="Help text for editors (optional)"></div>
    </div></div></div>`;
}

function sectionForm(ctx, s, opts) {
  const isNew = !s._id;
  const sections = ctx.sections.filter((x) => x.slug !== s.slug && x.layout !== 'notices');
  return shell(ctx, { title: isNew ? 'New section' : s.name, active: 'sections', body: html`
    <nav aria-label="breadcrumb"><ol class="breadcrumb small"><li class="breadcrumb-item"><a href="/admin/sections">Sections</a></li><li class="breadcrumb-item active">${isNew ? 'New' : s.name}</li></ol></nav>
    ${pageHead(isNew ? 'New section' : 'Section: ' + s.name)}
    ${opts.error ? html`<div class="alert alert-danger">${opts.error}</div>` : ''}
    <form method="post" action="${isNew ? '/admin/sections/new' : '/admin/sections/' + s.slug}" enctype="multipart/form-data" id="sectionForm">
      ${csrfField(ctx)}
      <div class="row g-4">
        <div class="col-lg-8">
          <div class="card mb-4"><div class="card-header bg-white fw-bold">1. About this section</div><div class="card-body row g-3">
            <div class="col-md-6"><label class="form-label" for="name">Name (plural)</label><input class="form-control" id="name" name="name" value="${s.name || ''}" required placeholder="For example: Registries" data-slug-source></div>
            <div class="col-md-6"><label class="form-label" for="singular">One item is called</label><input class="form-control" id="singular" name="singular" value="${s.singular || ''}" placeholder="For example: Registry"></div>
            <div class="col-md-6"><label class="form-label" for="slug">Web address</label><div class="input-group"><span class="input-group-text">/</span><input class="form-control" id="slug" name="slug" value="${s.slug || ''}" pattern="[a-z0-9\\-]+" data-slug-target${isNew ? '' : raw(' readonly')}></div>${isNew ? '' : html`<div class="form-text">The address cannot be changed after creation.</div>`}</div>
            <div class="col-md-6"><label class="form-label" for="titleLabel">Label for the main title field</label><input class="form-control" id="titleLabel" name="titleLabel" value="${s.titleLabel || ''}" placeholder="Title, Full name, Parties..."></div>
            <div class="col-12"><label class="form-label" for="intro">Introduction (shown at the top of the section page)</label><textarea class="form-control" id="intro" name="intro" rows="2">${s.intro || ''}</textarea></div>
            <div class="col-md-6"><label class="form-label">Banner background image</label>${F.input({ key: 'banner', type: 'image' }, s.banner || '')}</div>
          </div></div>

          <div class="card mb-4"><div class="card-header bg-white fw-bold">2. How it looks</div><div class="card-body row g-3">
            <div class="col-12"><label class="form-label" for="layout">Display style</label>
              <select class="form-select" id="layout" name="layout" data-layout-select>${Object.entries(LAYOUTS).map(([k, l]) => html`<option value="${k}"${sel(k, s.layout)} data-desc="${l.description}">${l.label}</option>`)}</select>
              <div class="form-text" data-layout-desc>${LAYOUTS[s.layout || 'cards'].description}</div>
              ${isNew ? html`<div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="presetFields" name="presetFields" value="1" checked><label class="form-check-label small" for="presetFields">Start with the suggested fields for this style (you can change them below after saving)</label></div>` : ''}</div>
            <div class="col-md-4"><label class="form-label" for="sort">Order of items</label><select class="form-select" id="sort" name="sort">
              <option value="manual"${sel('manual', s.sort)}>Arranged by hand</option><option value="date"${sel('date', s.sort)}>By date, newest first</option><option value="newest"${sel('newest', s.sort)}>Most recently added first</option><option value="title"${sel('title', s.sort)}>Alphabetical</option></select></div>
            <div class="col-md-4"><label class="form-label" for="display">Variation</label><select class="form-select" id="display" name="display">
              <option value="">Standard</option><option value="table"${sel('table', s.display)}>Table (documents)</option><option value="rows"${sel('rows', s.display)}>Rows (documents)</option><option value="portrait"${sel('portrait', s.display)}>Portrait cards (honour roll)</option></select></div>
            <div class="col-md-4"><label class="form-label" for="groupBy">Group items into tabs by</label><select class="form-select" id="groupBy" name="groupBy"><option value="">(no grouping)</option>${(s.fields || []).filter((f) => f.type === 'select').map((f) => html`<option value="${f.key}"${sel(f.key, s.groupBy)}>${f.label}</option>`)}</select></div>
            <div class="col-md-4"><div class="form-check form-switch mt-2"><input type="hidden" name="detail" value="0"><input class="form-check-input" type="checkbox" id="detail" name="detail" value="1"${chk(s.detail !== false)}><label class="form-check-label" for="detail">Each item has its own page</label></div></div>
          </div></div>

          ${isNew ? '' : html`<div class="card mb-4"><div class="card-header bg-white fw-bold d-flex">3. Fields <span class="ms-auto small text-muted fw-normal">Information editors fill in for each item</span></div><div class="card-body">
            <div class="repeater-fields" data-next="${(s.fields || []).length}">
              <div class="field-list">${(s.fields || []).map((f, i) => fieldRow(f, i, sections))}</div>
              <template>${fieldRow({ type: 'text' }, '__i__', sections)}</template>
              <button type="button" class="btn btn-sm btn-outline-success" data-add-field><i class="fas fa-plus me-1"></i>Add a field</button>
            </div>
            <p class="small text-muted mt-3 mb-0">Removing a field hides its information from the site, but anything already typed into it stays in the database until the item is next saved.</p>
          </div></div>`}
        </div>

        <div class="col-lg-4">
          <div class="card mb-4"><div class="card-header bg-white fw-bold">Where it appears</div><div class="card-body">
            <label class="form-label" for="menuParent">In the main menu</label>
            <select class="form-select mb-3" id="menuParent" name="menuParent">
              <option value="none"${sel('none', opts.menuParent)}>Not in the menu</option>
              <option value=""${sel('', opts.menuParent)}>On the top level of the menu</option>
              ${opts.menuGroups.map((m) => html`<option value="${m._id}"${sel(m._id, opts.menuParent)}>Under "${m.label}"</option>`)}
            </select>
            <div class="form-check form-switch mb-3"><input type="hidden" name="onHome" value="0"><input class="form-check-input" type="checkbox" id="onHome" name="onHome" value="1"${chk(opts.onHome)}><label class="form-check-label" for="onHome">Show on the home page</label>
              <div class="form-text">Adds a block at the bottom of the home page. Reorder it in Home page.</div></div>
            <label class="form-label" for="insideOf">Show inside the pages of another section</label>
            <select class="form-select" id="insideOf" name="insideOf"><option value="">(no)</option>${sections.filter((x) => x.detail).map((x) => html`<option value="${x.slug}"${sel(x.slug, opts.insideOf)}>${x.name}</option>`)}</select>
            <div class="form-text">For example, choose Directorates to list these items on the page of the directorate they belong to. A "Belongs to" field is added automatically.</div>
          </div></div>
          <div class="card"><div class="card-body d-grid gap-2">
            <button class="btn btn-success">${isNew ? 'Create section' : 'Save section'}</button>
            <a href="/admin/sections" class="btn btn-link">Cancel</a>
          </div></div>
          ${!isNew && !s.system ? html`<div class="card mt-3 border-danger-subtle"><div class="card-body">
            <button type="submit" form="deleteSection" class="btn btn-sm btn-outline-danger w-100" data-confirm="Delete this section AND all of its items permanently?">Delete section</button></div></div>` : ''}
        </div>
      </div>
    </form>
    ${!isNew && !s.system ? html`<form id="deleteSection" method="post" action="/admin/sections/${s.slug}/delete">${csrfField(ctx)}</form>` : ''}` });
}

// ---------- menu ----------
function menuPage(ctx, items, sections) {
  const top = items.filter((i) => !i.parent);
  const kids = (id) => items.filter((i) => i.parent === id);
  const row = (it, level, idx, siblings) => html`<li class="list-group-item${level ? ' ps-5' : ''}">
    <form method="post" action="/admin/menu/${it._id}" class="row g-2 align-items-center">${csrfField(ctx)}
      <div class="col-md-3"><input class="form-control form-control-sm${level ? '' : ' fw-bold'}" name="label" value="${it.label}" required aria-label="Label"></div>
      <div class="col-md-3"><input class="form-control form-control-sm font-monospace" name="url" value="${it.url}" aria-label="Link" ${it.section ? raw('readonly title="Linked to a section"') : ''}></div>
      <div class="col-md-2"><select class="form-select form-select-sm" name="parent" aria-label="Position">
        <option value="">Top level</option>${top.filter((t) => t._id !== it._id).map((t) => html`<option value="${t._id}"${sel(t._id, it.parent)}>Under ${t.label}</option>`)}</select></div>
      <div class="col-md-2 small"><label><input type="checkbox" class="form-check-input" name="visible" value="1"${chk(it.visible !== false)}> Visible</label>
        ${!level ? html`<br><select class="form-select form-select-sm mt-1" name="autoSection" title="Automatically list the items of a section under this menu entry"><option value="">No automatic list</option>${sections.map((s) => html`<option value="${s.slug}"${sel(s.slug, it.autoSection)}>List all ${s.name}</option>`)}</select>` : ''}</div>
      <div class="col-md-2 text-end text-nowrap">
        <button class="btn btn-sm btn-outline-success" name="do" value="save">Save</button>
        <button class="btn btn-sm btn-light" name="do" value="up"${idx === 0 ? raw(' disabled') : ''} title="Move up">&uarr;</button>
        <button class="btn btn-sm btn-light" name="do" value="down"${idx === siblings - 1 ? raw(' disabled') : ''} title="Move down">&darr;</button>
        <button class="btn btn-sm btn-light text-danger" name="do" value="delete" data-confirm="Remove this menu entry?${kids(it._id).length ? ' Its sub items move to the top level.' : ''}" title="Remove">&times;</button>
      </div>
    </form></li>
    ${kids(it._id).map((k, i, arr) => row(k, 1, i, arr.length))}`;
  return shell(ctx, { title: 'Menu', active: 'menu', body: html`
    ${pageHead('Main menu', '', 'Arrange the links at the top of every page. Entries with sub items become dropdowns.')}
    <div class="card mb-4"><ul class="list-group list-group-flush">${top.map((t, i) => row(t, 0, i, top.length))}</ul></div>
    <div class="card"><div class="card-header bg-white fw-bold">Add a menu entry</div><div class="card-body">
      <form method="post" action="/admin/menu" class="row g-2 align-items-end">${csrfField(ctx)}
        <div class="col-md-3"><label class="form-label small">Label</label><input class="form-control" name="label" required></div>
        <div class="col-md-3"><label class="form-label small">Link to</label><select class="form-select" name="target" data-menu-target><option value="">A web address (type it on the right)</option>
          <optgroup label="Sections">${sections.filter((s) => s.layout !== 'pages').map((s) => html`<option value="/${s.slug}">${s.name}</option>`)}</optgroup>
          <optgroup label="Pages">${(ctx.pages || []).map((p) => html`<option value="/${p.slug}">${p.title}</option>`)}</optgroup></select></div>
        <div class="col-md-2"><label class="form-label small">Web address</label><input class="form-control" name="url" placeholder="/about or https://..."></div>
        <div class="col-md-2"><label class="form-label small">Position</label><select class="form-select" name="parent"><option value="">Top level</option>${top.map((t) => html`<option value="${t._id}">Under ${t.label}</option>`)}</select></div>
        <div class="col-md-2 d-grid"><button class="btn btn-success">Add</button></div>
      </form>
      <p class="small text-muted mt-2 mb-0">Tip: to make a dropdown, add an entry with the web address <code>#</code> and place other entries under it.</p>
    </div></div>` });
}

// ---------- home page ----------
function homeEditor(ctx, blocks, sections) {
  const name = (b) => (b.type === 'section' ? `${BLOCKS.section.label}: ${(sections.find((s) => s.slug === b.data.section) || {}).name || '(section removed)'}` : BLOCKS[b.type] ? BLOCKS[b.type].label : b.type);
  return shell(ctx, { title: 'Home page', active: 'home', body: html`
    ${pageHead('Home page layout', html`<a href="/" target="_blank" rel="noopener" class="btn btn-outline-secondary">View home page</a>`, 'The home page is built from these blocks, top to bottom.')}
    <div class="card mb-4"><ul class="list-group list-group-flush">${blocks.map((b, i) => html`<li class="list-group-item d-flex align-items-center gap-3${b.visible === false ? ' text-muted bg-light' : ''}">
      <span class="badge rounded-pill text-bg-light border">${i + 1}</span>
      <div><div class="fw-semibold">${name(b)}</div><div class="small text-muted">${b.data.heading || b.data.title || ''}${b.visible === false ? ' (hidden)' : ''}</div></div>
      <form method="post" action="/admin/home/${b.id}" class="ms-auto d-flex gap-1">${csrfField(ctx)}
        <a class="btn btn-sm btn-outline-success" href="/admin/home/${b.id}">Edit</a>
        <button class="btn btn-sm btn-light" name="do" value="up"${i === 0 ? raw(' disabled') : ''} title="Move up">&uarr;</button>
        <button class="btn btn-sm btn-light" name="do" value="down"${i === blocks.length - 1 ? raw(' disabled') : ''} title="Move down">&darr;</button>
        <button class="btn btn-sm btn-light" name="do" value="toggle">${b.visible === false ? 'Show' : 'Hide'}</button>
        <button class="btn btn-sm btn-light text-danger" name="do" value="delete" data-confirm="Remove this block from the home page?" title="Remove">&times;</button>
      </form></li>`)}</ul></div>
    <div class="card"><div class="card-header bg-white fw-bold">Add a block</div><div class="card-body">
      <form method="post" action="/admin/home" class="row g-2 align-items-end">${csrfField(ctx)}
        <div class="col-md-5"><label class="form-label small">Block type</label><select class="form-select" name="type">${Object.entries(BLOCKS).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}</select></div>
        <div class="col-md-5"><label class="form-label small">Section (for "Items from a section")</label><select class="form-select" name="section"><option value="">(not needed)</option>${sections.map((s) => html`<option value="${s.slug}">${s.name}</option>`)}</select></div>
        <div class="col-md-2 d-grid"><button class="btn btn-success">Add</button></div>
      </form></div></div>` });
}

function blockForm(ctx, b, sections) {
  const def = BLOCKS[b.type];
  const hasRich = def.fields.some((f) => f.type === 'richtext');
  return shell(ctx, { title: 'Edit block', active: 'home', editor: hasRich, body: html`
    <nav aria-label="breadcrumb"><ol class="breadcrumb small"><li class="breadcrumb-item"><a href="/admin/home">Home page</a></li><li class="breadcrumb-item active">${def.label}</li></ol></nav>
    ${pageHead(def.label)}
    <form method="post" action="/admin/home/${b.id}/edit" enctype="multipart/form-data" class="entry-form">${csrfField(ctx)}
      <div class="row"><div class="col-lg-9">
        ${def.fields.map((f) => html`<div class="card mb-3"><div class="card-body"><label class="form-label fw-semibold" for="f_${f.key}">${f.label}</label>${F.input(f, b.data[f.key], { sections })}</div></div>`)}
        ${b.type === 'contact' ? html`<p class="small text-muted">The address, phone, email, social links and map come from <a href="/admin/settings">Site settings</a>.</p>` : ''}
      </div><div class="col-lg-3"><div class="card"><div class="card-body d-grid gap-2"><button class="btn btn-success">Save block</button><a href="/admin/home" class="btn btn-link">Cancel</a></div></div></div></div>
    </form>` });
}

// ---------- settings ----------
const SETTINGS_FIELDS = [
  ['General', [['siteName', 'Full name of the court', 'text'], ['shortName', 'Name in the top bar', 'text'], ['logo', 'Logo', 'image'], ['pageBanner', 'Default banner photo for inner pages', 'image'], ['metaDescription', 'Description for search engines', 'textarea']]],
  ['Contact details', [['address', 'Address', 'text'], ['phone', 'Phone', 'text'], ['email', 'Email', 'email'], ['mapEmbed', 'Google Maps embed link', 'url', 'In Google Maps choose Share, then Embed a map, and copy only the address inside src="..."']]],
  ['Social media', [['facebook', 'Facebook page', 'url'], ['twitter', 'X (Twitter) page', 'url'], ['youtube', 'YouTube channel', 'url'], ['instagram', 'Instagram page', 'url']]],
  ['Highlighted button in the menu', [['ctaLabel', 'Button label', 'text'], ['ctaUrl', 'Button link', 'url', 'Leave empty to hide the button'], ['ctaIcon', 'Button icon', 'text']]],
  ['Footer', [['footerAbout', 'Short statement', 'textarea'], ['footerCredit', 'Credit line', 'text'], ['footerCreditUrl', 'Credit link', 'text']]],
];
function settingsPage(ctx, s) {
  return shell(ctx, { title: 'Site settings', active: 'settings', body: html`
    ${pageHead('Site settings')}
    <form method="post" action="/admin/settings" enctype="multipart/form-data">${csrfField(ctx)}
      ${SETTINGS_FIELDS.map(([group, list]) => html`<div class="card mb-4"><div class="card-header bg-white fw-bold">${group}</div><div class="card-body row g-3">
        ${list.map(([key, label, type, help]) => html`<div class="col-md-6"><label class="form-label" for="f_${key}">${label}</label>${F.input({ key, label, type }, s[key])}${help ? html`<div class="form-text">${help}</div>` : ''}</div>`)}
      </div></div>`)}
      <button class="btn btn-success">Save settings</button>
    </form>` });
}

// ---------- users ----------
function userList(ctx, users) {
  return shell(ctx, { title: 'Users', active: 'users', body: html`
    ${pageHead('Users', html`<a href="/admin/users/new" class="btn btn-success"><i class="fas fa-user-plus me-1"></i>New user</a>`)}
    <div class="card"><div class="table-responsive"><table class="table align-middle mb-0"><thead class="table-light"><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign in</th><th></th></tr></thead>
      <tbody>${users.map((u) => html`<tr${u.active ? '' : raw(' class="text-muted"')}><td class="fw-semibold">${u.name}${u.active ? '' : ' (disabled)'}</td><td>${u.email}</td>
        <td>${u.role === 'superadmin' ? html`<span class="badge text-bg-dark">Super admin</span>` : html`<span class="badge text-bg-light border">Staff</span>`}</td>
        <td class="small">${dt(u.lastLoginAt) || 'Never'}</td><td class="text-end"><a href="/admin/users/${u._id}" class="btn btn-sm btn-outline-success">Edit</a></td></tr>`)}</tbody></table></div></div>` });
}

function userForm(ctx, u, sections, opts = {}) {
  const isNew = !u._id;
  const me = ctx.user;
  const access = u.access || {};
  return shell(ctx, { title: isNew ? 'New user' : u.name, active: 'users', body: html`
    <nav aria-label="breadcrumb"><ol class="breadcrumb small"><li class="breadcrumb-item"><a href="/admin/users">Users</a></li><li class="breadcrumb-item active">${isNew ? 'New' : u.name}</li></ol></nav>
    ${pageHead(isNew ? 'New user' : 'Edit user')}
    ${opts.error ? html`<div class="alert alert-danger">${opts.error}</div>` : ''}
    <form method="post" action="${isNew ? '/admin/users/new' : '/admin/users/' + u._id}">${csrfField(ctx)}
      <div class="row g-4"><div class="col-lg-8">
        <div class="card mb-4"><div class="card-header bg-white fw-bold">Account</div><div class="card-body row g-3">
          <div class="col-md-6"><label class="form-label" for="name">Full name</label><input class="form-control" id="name" name="name" value="${u.name || ''}" required></div>
          <div class="col-md-6"><label class="form-label" for="email">Email (used to sign in)</label><input class="form-control" id="email" type="email" name="email" value="${u.email || ''}" required></div>
          <div class="col-md-6"><label class="form-label" for="password">${isNew ? 'Temporary password' : 'Set a new password'}</label><input class="form-control" id="password" type="password" name="password" autocomplete="new-password"${isNew ? raw(' required') : ''} minlength="10"><div class="form-text">${isNew ? 'Share it privately. They should change it under My account.' : 'Leave empty to keep the current password.'}</div></div>
          <div class="col-md-6"><label class="form-label" for="role">Role</label><select class="form-select" id="role" name="role" data-role-select${isSuper(me) ? '' : raw(' disabled')}>
            <option value="staff"${sel('staff', u.role)}>Staff (permissions chosen below)</option><option value="superadmin"${sel('superadmin', u.role)}>Super admin (full control)</option></select></div>
          <div class="col-12"><div class="form-check form-switch"><input type="hidden" name="active" value="0"><input class="form-check-input" type="checkbox" id="active" name="active" value="1"${chk(u.active !== false)}><label class="form-check-label" for="active">Account is active (can sign in)</label></div></div>
        </div></div>
        <div class="card mb-4" data-staff-only><div class="card-header bg-white fw-bold">What this person can edit</div><div class="card-body">
          <div class="row g-2 align-items-center mb-3 pb-3 border-bottom"><div class="col-md-6 fw-semibold">All sections (default)</div><div class="col-md-6"><select class="form-select form-select-sm" name="access[*]">${Object.entries(LEVELS).map(([k, v]) => html`<option value="${k}"${sel(k, access['*'] || 'none')}>${v}</option>`)}</select></div></div>
          ${sections.map((s) => html`<div class="row g-2 align-items-center mb-2"><div class="col-md-6">${s.name}</div><div class="col-md-6"><select class="form-select form-select-sm" name="access[${s.slug}]">
            <option value="inherit">Same as default</option>${Object.entries(LEVELS).map(([k, v]) => html`<option value="${k}"${sel(k, access[s.slug])}>${v}</option>`)}</select></div></div>`)}
        </div></div>
        <div class="card mb-4" data-staff-only><div class="card-header bg-white fw-bold">Other permissions</div><div class="card-body">
          ${Object.entries(PERMS).map(([k, v]) => html`<div class="form-check"><input class="form-check-input" type="checkbox" id="perm_${k}" name="perms[${k}]" value="1"${chk(u.perms && u.perms[k])}><label class="form-check-label" for="perm_${k}">${v}</label></div>`)}
        </div></div>
      </div><div class="col-lg-4"><div class="card"><div class="card-body d-grid gap-2">
        <button class="btn btn-success">${isNew ? 'Create user' : 'Save user'}</button><a href="/admin/users" class="btn btn-link">Cancel</a></div></div>
        ${!isNew && String(u._id) !== String(me._id) ? html`<div class="card mt-3"><div class="card-body d-grid gap-2">
          <button type="submit" form="signoutUser" class="btn btn-sm btn-outline-secondary">Sign this user out everywhere</button>
          <button type="submit" form="deleteUser" class="btn btn-sm btn-outline-danger" data-confirm="Delete this user account? Their past changes stay in the activity log.">Delete user</button></div></div>` : ''}
      </div></div>
    </form>
    ${!isNew ? html`<form id="signoutUser" method="post" action="/admin/users/${u._id}/signout">${csrfField(ctx)}</form><form id="deleteUser" method="post" action="/admin/users/${u._id}/delete">${csrfField(ctx)}</form>` : ''}` });
}

function accountPage(ctx, opts = {}) {
  const u = ctx.user;
  return shell(ctx, { title: 'My account', active: 'account', body: html`
    ${pageHead('My account')}
    ${opts.error ? html`<div class="alert alert-danger">${opts.error}</div>` : ''}
    <div class="row g-4"><div class="col-lg-6"><div class="card"><div class="card-header bg-white fw-bold">Change password</div><div class="card-body">
      <form method="post" action="/admin/account">${csrfField(ctx)}
        <div class="mb-3"><label class="form-label" for="current">Current password</label><input class="form-control" type="password" id="current" name="current" autocomplete="current-password" required></div>
        <div class="mb-3"><label class="form-label" for="password">New password</label><input class="form-control" type="password" id="password" name="password" autocomplete="new-password" required minlength="10"><div class="form-text">At least 10 characters, with letters and numbers.</div></div>
        <div class="mb-3"><label class="form-label" for="password2">Repeat new password</label><input class="form-control" type="password" id="password2" name="password2" autocomplete="new-password" required></div>
        <button class="btn btn-success">Change password</button>
      </form></div></div></div>
      <div class="col-lg-6"><div class="card"><div class="card-header bg-white fw-bold">Your access</div><div class="card-body small">
        <p><strong>${u.name}</strong><br>${u.email}</p>
        ${isSuper(u) ? html`<p>You are a super admin and can do everything.</p>` : html`<ul>${(ctx.sections || []).filter((s) => canEdit(u, s.slug)).map((s) => html`<li>${s.name}: ${LEVELS[sectionLevel(u, s.slug)]}</li>`)}</ul>`}
      </div></div></div></div>` });
}

// ---------- messages, activity, backup ----------
function messagesPage(ctx, items, open) {
  return shell(ctx, { title: 'Messages', active: 'messages', body: html`
    ${pageHead('Messages from the contact form')}
    <div class="row g-4"><div class="col-lg-5"><div class="list-group">${items.length ? items.map((m) => html`<a href="/admin/messages/${m._id}" class="list-group-item list-group-item-action${open && open._id === m._id ? ' active' : ''}">
      <div class="d-flex"><strong class="${m.read ? 'fw-normal' : ''}">${m.name}</strong><small class="ms-auto">${dt(m.createdAt)}</small></div><div class="small text-truncate">${m.subject || m.message}</div></a>`) : html`<div class="text-muted">No messages.</div>`}</div></div>
      <div class="col-lg-7">${open ? html`<div class="card"><div class="card-body">
        <h2 class="h5">${open.subject || '(no subject)'}</h2><p class="small text-muted">From ${open.name} &lt;<a href="mailto:${open.email}">${open.email}</a>&gt; on ${dt(open.createdAt)}</p>
        <div class="message-body">${open.message}</div>
        <div class="mt-4 d-flex gap-2"><a class="btn btn-success btn-sm" href="mailto:${open.email}?subject=${encodeURIComponent('Re: ' + (open.subject || 'Your message'))}">Reply by email</a>
        <form method="post" action="/admin/messages/${open._id}/delete">${csrfField(ctx)}<button class="btn btn-outline-danger btn-sm" data-confirm="Delete this message?">Delete</button></form></div>
      </div></div>` : html`<p class="text-muted">Select a message to read it.</p>`}</div></div>` });
}

function activityPage(ctx, items, page, hasMore) {
  return shell(ctx, { title: 'Activity log', active: 'activity', body: html`
    ${pageHead('Activity log', '', 'Every change made in the dashboard is recorded here.')}
    <div class="card"><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead class="table-light"><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Details</th></tr></thead>
      <tbody>${items.map((a) => html`<tr><td class="small text-nowrap">${dt(a.at)}</td><td>${a.userName}</td><td>${a.action}</td><td>${a.target}</td><td class="small text-muted">${a.details}</td></tr>`)}</tbody></table></div></div>
    <div class="mt-3 d-flex gap-2">${page > 1 ? html`<a class="btn btn-sm btn-outline-secondary" href="?page=${page - 1}">Newer</a>` : ''}${hasMore ? html`<a class="btn btn-sm btn-outline-secondary" href="?page=${page + 1}">Older</a>` : ''}</div>` });
}

function backupPage(ctx, info) {
  return shell(ctx, { title: 'Backup', active: 'backup', body: html`
    ${pageHead('Backup')}
    <div class="card mb-4"><div class="card-body">
      <p>Download a complete copy of the website content (sections, items, menu, home page, settings, users without passwords, messages). Keep it somewhere safe, for example once a week.</p>
      <p class="small text-muted">Uploaded photos and documents stay on Cloudinary; the backup contains their addresses. Database: ${info.db}.</p>
      <form method="post" action="/admin/backup">${csrfField(ctx)}<button class="btn btn-success"><i class="fas fa-download me-1"></i>Download backup</button></form>
    </div></div>
    <div class="card"><div class="card-body small">
      <p class="fw-bold">Restoring</p>
      <p class="mb-0">A backup file can be restored by a technical person with <code>npm run restore -- backup-file.json</code> (see the README). This replaces the current content, so it is not offered as a button.</p>
    </div></div>` });
}

function notAllowed(ctx) {
  return shell(ctx, { title: 'Not allowed', body: html`<div class="text-center py-5"><h1 class="h4">You do not have permission to open this page.</h1><p class="text-muted">Ask a super admin if you need access.</p><a href="/admin" class="btn btn-success">Back to dashboard</a></div>` });
}

module.exports = {
  shell, loginPage, setupPage, dashboard, entryList, entryForm, historyPage, sectionList, sectionForm, fieldRow, menuPage, homeEditor, blockForm,
  settingsPage, SETTINGS_FIELDS, userList, userForm, accountPage, messagesPage, activityPage, backupPage, notAllowed,
};
