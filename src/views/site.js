'use strict';
// Public website templates. The markup follows the original static site so the
// look and feel is unchanged, but every piece of content now comes from the database.
const { html, raw, safeUrl, esc } = require('./html');
const { img, fileLabel } = require('../media');
const { display, isEmpty, formatDate, asArray, options } = require('../fields');
const { LAYOUTS } = require('../layouts');
const { stripTags } = require('../sanitize');
const { entryUrl } = require('../content');

const BS_CSS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
const BS_JS = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js';
const FA_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';

const bg = (url, shade = 0.85) => {
  const top = Math.max(0.45, shade - 0.25);
  return `background-image: linear-gradient(180deg, rgba(0,51,0,${top}) 0%, rgba(0,51,0,${shade}) 100%)${url ? `, url('${String(img(url, 1920)).replace(/['()\\]/g, (c) => '\\' + c)}')` : ''};`;
};
const photo = (url, cls, alt, w = 600, h, crop) => (url
  ? html`<img src="${img(url, w, h, crop)}" class="${cls}" alt="${alt}" loading="lazy">`
  : html`<div class="${cls} photo-placeholder" role="img" aria-label="${alt}"><i class="fas fa-user fa-3x"></i></div>`);

// ---------- layout ----------
function isActive(item, path) {
  if (item.url && item.url !== '#' && item.url !== '/' && (path === item.url || path.startsWith(item.url + '/'))) return true;
  if (item.url === '/' && path === '/') return true;
  return (item.children || []).some((c) => isActive(c, path));
}

function navItems(menu, path) {
  return menu.map((it) => {
    const active = isActive(it, path);
    if (it.children && it.children.length) {
      return html`<li class="nav-item dropdown">
        <a class="nav-link dropdown-toggle${active ? ' active' : ''}" href="${safeUrl(it.url && it.url !== '#' ? it.url : '#')}" role="button" data-bs-toggle="dropdown" aria-expanded="false">${it.label}</a>
        <ul class="dropdown-menu">
          ${it.url && it.url !== '#' ? html`<li><a class="dropdown-item" href="${safeUrl(it.url)}">All ${it.label}</a></li>` : ''}
          ${it.children.map((c) => html`<li><a class="dropdown-item${path === c.url ? ' active' : ''}" href="${safeUrl(c.url)}">${c.label}</a></li>`)}
        </ul></li>`;
    }
    return html`<li class="nav-item"><a class="nav-link${active ? ' active' : ''}" href="${safeUrl(it.url)}"${active ? raw(' aria-current="page"') : ''}>${it.label}</a></li>`;
  });
}

function layout(ctx, { title, description, body, image }) {
  const s = ctx.settings;
  const fullTitle = title ? `${title} | ${s.siteName}` : s.siteName;
  const desc = description || s.metaDescription;
  const canonical = ctx.siteUrl ? ctx.siteUrl + ctx.path : '';
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${desc}">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="website">
  ${image ? html`<meta property="og:image" content="${/^https?:/.test(image) ? image : (ctx.siteUrl || '') + image}">` : ''}
  ${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
  <link rel="icon" href="${img(s.logo, 64)}">
  <link rel="apple-touch-icon" href="${img(s.logo, 180)}">
  <link href="${BS_CSS}" rel="stylesheet" crossorigin="anonymous">
  <link href="${FA_CSS}" rel="stylesheet" crossorigin="anonymous" referrerpolicy="no-referrer">
  <link href="/css/site.css?v=${ctx.version}" rel="stylesheet">
</head>
<body>
  <a class="visually-hidden-focusable position-absolute top-0 start-0 bg-white p-2" style="z-index:2000" href="#main">Skip to content</a>
  <nav class="navbar navbar-expand-lg fixed-top" aria-label="Main">
    <div class="container">
      <a class="navbar-brand fw-bold" href="/">
        ${s.logo ? html`<img src="${img(s.logo, 80)}" height="40" width="40" class="me-2 rounded-circle" alt="">` : ''}${s.shortName}
      </a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Open menu">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav ms-auto align-items-lg-center">
          ${navItems(ctx.menu, ctx.path)}
          ${s.ctaUrl ? html`<li class="nav-item ms-lg-3 my-2 my-lg-0"><a class="btn cta-btn" href="${safeUrl(s.ctaUrl)}" target="_blank" rel="noopener noreferrer"><i class="${s.ctaIcon || 'fas fa-external-link-alt'} me-2"></i>${s.ctaLabel}</a></li>` : ''}
        </ul>
        <div class="nav-social d-flex align-items-center ms-lg-3 ps-lg-3 border-start">
          ${s.facebook ? html`<a class="fb" href="${safeUrl(s.facebook)}" target="_blank" rel="noopener" aria-label="Facebook"><i class="fab fa-facebook-f"></i></a>` : ''}
          ${s.twitter ? html`<a class="x" href="${safeUrl(s.twitter)}" target="_blank" rel="noopener" aria-label="X (Twitter)"><i class="fab fa-x-twitter"></i></a>` : ''}
          ${s.youtube ? html`<a class="yt" href="${safeUrl(s.youtube)}" target="_blank" rel="noopener" aria-label="YouTube"><i class="fab fa-youtube"></i></a>` : ''}
          ${s.instagram ? html`<a class="fb" href="${safeUrl(s.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><i class="fab fa-instagram"></i></a>` : ''}
        </div>
      </div>
    </div>
  </nav>
  <main id="main" class="page-body">
${body}
  </main>
  <footer class="main-footer">
    <div class="container">
      <div class="row">
        <div class="col-md-4 mb-4">
          <h5 class="text-uppercase mb-4 fw-bold">${s.shortName}</h5>
          <p>${s.footerAbout}</p>
        </div>
        <div class="col-md-4 mb-4">
          <h5 class="text-uppercase mb-4 fw-bold">Contact Info</h5>
          ${s.address ? html`<p><i class="fas fa-map-marker-alt me-2 text-secondary"></i> ${s.address}</p>` : ''}
          ${s.email ? html`<p><i class="fas fa-envelope me-2 text-secondary"></i> <a class="footer-link" href="mailto:${s.email}">${s.email}</a></p>` : ''}
          ${s.phone ? html`<p><i class="fas fa-phone me-2 text-secondary"></i> <a class="footer-link" href="tel:${s.phone.replace(/\s+/g, '')}">${s.phone}</a></p>` : ''}
        </div>
        <div class="col-md-4 mb-4">
          <h5 class="text-uppercase mb-4 fw-bold">Follow Us</h5>
          <div class="d-flex gap-3 fs-4">
            ${s.facebook ? html`<a href="${safeUrl(s.facebook)}" class="footer-link" target="_blank" rel="noopener" aria-label="Facebook"><i class="fab fa-facebook"></i></a>` : ''}
            ${s.twitter ? html`<a href="${safeUrl(s.twitter)}" class="footer-link" target="_blank" rel="noopener" aria-label="X (Twitter)"><i class="fab fa-x-twitter"></i></a>` : ''}
            ${s.youtube ? html`<a href="${safeUrl(s.youtube)}" class="footer-link" target="_blank" rel="noopener" aria-label="YouTube"><i class="fab fa-youtube"></i></a>` : ''}
            ${s.instagram ? html`<a href="${safeUrl(s.instagram)}" class="footer-link" target="_blank" rel="noopener" aria-label="Instagram"><i class="fab fa-instagram"></i></a>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="footer-bottom mt-4 py-4">
      <div class="container">
        <div class="row align-items-center">
          <div class="col-md-6 text-center text-md-start"><p class="mb-0">&copy; ${new Date().getFullYear()} ${s.siteName}. All Rights Reserved.</p></div>
          ${s.footerCredit ? html`<div class="col-md-6 text-center text-md-end"><p class="mb-0">Designed and Developed by <a href="${safeUrl(s.footerCreditUrl || '#')}" class="fw-bold text-decoration-none">${s.footerCredit}</a></p></div>` : ''}
        </div>
      </div>
    </div>
  </footer>
  <button type="button" id="btn-back-to-top" aria-label="Back to top"><i class="fas fa-arrow-up"></i></button>
  <script src="${BS_JS}" crossorigin="anonymous"></script>
  <script src="/js/site.js?v=${ctx.version}"></script>
</body>
</html>`;
}

function pageHero(title, subtitle, banner, opts = {}) {
  return html`<header class="page-hero text-center${opts.compact ? ' compact' : ''}" style="${bg(banner, 0.88)}">
    <div class="container">
      ${opts.icon ? html`<i class="${opts.icon} fa-3x mb-3" style="color:var(--court-gold-bright)"></i>` : ''}
      ${opts.kicker ? html`<p class="text-uppercase small fw-bold mb-2" style="letter-spacing:1px;color:var(--court-gold-bright)">${opts.kicker}</p>` : ''}
      <h1 class="display-5 fw-bold">${title}</h1>
      ${subtitle ? html`<p class="lead mb-0">${subtitle}</p>` : ''}
    </div>
  </header>`;
}

function crumbs(list) {
  return html`<div class="breadcrumb-bar"><div class="container"><nav aria-label="breadcrumb"><ol class="breadcrumb">
    ${list.map((c, i) => (i === list.length - 1 ? html`<li class="breadcrumb-item active" aria-current="page">${c.label}</li>` : html`<li class="breadcrumb-item"><a href="${c.url}">${c.label}</a></li>`))}
  </ol></nav></div></div>`;
}

function pagination(page, totalPages, makeUrl) {
  if (totalPages <= 1) return '';
  const pages = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pages.push(i);
  return html`<nav class="mt-4" aria-label="Pages"><ul class="pagination justify-content-center">
    <li class="page-item${page <= 1 ? ' disabled' : ''}"><a class="page-link text-success" href="${makeUrl(page - 1)}">Previous</a></li>
    ${pages.map((p) => html`<li class="page-item${p === page ? ' active' : ''}"><a class="page-link${p === page ? ' bg-success border-success' : ' text-success'}" href="${makeUrl(p)}">${p}</a></li>`)}
    <li class="page-item${page >= totalPages ? ' disabled' : ''}"><a class="page-link text-success" href="${makeUrl(page + 1)}">Next</a></li>
  </ul></nav>`;
}

const empty = (text) => html`<div class="text-center text-muted py-5"><i class="far fa-folder-open fa-2x mb-3 d-block"></i>${text}</div>`;

// ---------- item cards (shared by section pages and home blocks) ----------
function profileCards(section, items) {
  return items.map((e) => html`<div class="col-6 col-lg-4 mb-4 d-flex justify-content-center">
    <div class="card profile-card shadow-sm h-100 card-lift w-100" style="max-width: 320px;">
      <a href="${entryUrl(section, e)}">${photo(e.data.photo, 'card-img-top w-100', e.title, 600, 600, 'fill')}</a>
      <div class="card-body text-center d-flex flex-column">
        <h2 class="h6 designation">${e.data.designation || section.singular}</h2>
        <p class="card-text text-dark mb-3">${e.title}</p>
        <a href="${entryUrl(section, e)}" class="btn btn-outline-success btn-sm mt-auto">View Profile</a>
      </div>
    </div></div>`);
}

function honoursList(section, items) {
  if (!items.length) return empty('Nothing has been added yet.');
  const groups = [];
  for (const e of items) {
    const g = e.data.group || '';
    let grp = groups.find((x) => x.name === g);
    if (!grp) groups.push((grp = { name: g, items: [] }));
    grp.items.push(e);
  }
  const portrait = section.display === 'portrait';
  return groups.map((g) => html`<div class="row g-4 mb-5${portrait ? ' row-cols-1 row-cols-md-3 row-cols-lg-5 justify-content-center' : ''}">
    ${g.name ? html`<div class="col-12"><h3 class="h4 fw-bold mb-2 text-dark"><i class="fas fa-history me-2 text-success"></i>${g.name}</h3></div>` : ''}
    ${g.items.map((e) => {
      if (portrait) {
        return html`<div class="col" id="${e.slug}"><div class="card h-100 border-0 shadow-sm p-3 honor-card">
          <div class="honor-img-wrapper mb-3">${e.data.photo ? html`<img src="${img(e.data.photo, 320, 400, 'fill')}" alt="${e.title}" loading="lazy">` : html`<i class="fas fa-user fa-3x text-secondary"></i>`}</div>
          <div class="card-body p-0 text-center">
            <h4 class="h6 fw-bold mb-1">${e.title}</h4>
            ${e.data.period ? html`<p class="text-gold-scc mb-2">${e.data.period}</p>` : ''}
            ${e.data.note ? html`<p class="small text-muted border-top pt-2 mb-0">${e.data.note}</p>` : ''}
          </div></div></div>`;
      }
      if (e.data.featured) {
        return html`<div class="col-md-4" id="${e.slug}"><div class="card h-100 border-0 shadow-sm honour-large overflow-hidden">
          ${photo(e.data.photo, 'card-img-top', e.title, 700, 700, 'fill')}
          <div class="card-body text-center">
            <h4 class="h5 fw-bold mb-1">${e.title}</h4>
            ${e.data.role ? html`<p class="text-success small fw-bold mb-2">${e.data.role}</p>` : ''}
            ${e.data.period ? html`<div class="badge bg-light text-dark border p-2 w-100"><i class="far fa-calendar-alt me-2 text-success"></i>${e.data.period}</div>` : ''}
            ${e.data.note ? html`<p class="small text-muted mt-2 mb-0">${e.data.note}</p>` : ''}
          </div></div></div>`;
      }
      return html`<div class="col-md-6" id="${e.slug}"><div class="d-flex align-items-center bg-white p-3 rounded shadow-sm border-start border-5 border-success h-100">
        ${e.data.photo ? html`<img src="${img(e.data.photo, 160, 160, 'fill')}" class="rounded shadow-sm" style="width:80px;height:80px;object-fit:cover" alt="${e.title}" loading="lazy">` : html`<div class="rounded photo-placeholder" style="width:80px;height:80px"><i class="fas fa-user fa-2x"></i></div>`}
        <div class="ms-4">
          <h4 class="h6 fw-bold mb-0">${e.title}</h4>
          ${e.data.role ? html`<p class="text-muted small mb-1">${e.data.role}</p>` : ''}
          ${e.data.period ? html`<span class="badge bg-success-subtle text-success border border-success-subtle">${e.data.period}</span>` : ''}
          ${e.data.note ? html`<div class="small text-muted mt-1">${e.data.note}</div>` : ''}
        </div></div></div>`;
    })}
  </div>`);
}

function departmentCards(section, items) {
  return items.map((e) => html`<div class="col-md-6 col-lg-4">
    <div class="card h-100 p-4 text-center shadow-sm card-lift">
      <div class="mx-auto directorate-icon"><i class="${e.data.icon || 'fas fa-building'} fa-2x"></i></div>
      <h3 class="h5 fw-bold">${e.title}</h3>
      <p class="small text-muted">${e.data.summary}</p>
      <a href="${entryUrl(section, e)}" class="btn btn-sm btn-outline-primary stretched-link mt-auto">View Department</a>
    </div></div>`);
}

function articleCards(section, items) {
  return items.map((e) => html`<div class="col-md-6 col-lg-4">
    <div class="card h-100 shadow-sm card-lift overflow-hidden">
      ${e.data.image ? html`<img src="${img(e.data.image, 700, 420, 'fill')}" class="card-img-top" style="height:220px;object-fit:cover" alt="" loading="lazy">` : html`<div class="photo-placeholder" style="height:160px"><i class="far fa-newspaper fa-3x"></i></div>`}
      <div class="card-body d-flex flex-column">
        <div class="mb-2">${e.data.category ? html`<span class="badge badge-category me-2">${e.data.category}</span>` : ''}${e.data.date ? html`<small class="text-muted">${formatDate(e.data.date)}</small>` : ''}</div>
        <h3 class="h5 card-title">${e.title}</h3>
        <p class="card-text text-muted">${e.data.summary || stripTags(e.data.body).slice(0, 160)}</p>
        <a href="${entryUrl(section, e)}" class="text-success fw-bold text-decoration-none mt-auto stretched-link">Read More &rarr;</a>
      </div></div></div>`);
}

function genericCards(section, items) {
  const imgField = section.fields.find((f) => f.type === 'image');
  const textField = section.fields.find((f) => f.key === 'summary') || section.fields.find((f) => f.type === 'textarea');
  return items.map((e) => html`<div class="col-md-6 col-lg-4">
    <div class="card h-100 shadow-sm card-lift overflow-hidden">
      ${imgField && e.data[imgField.key] ? html`<img src="${img(e.data[imgField.key], 700, 420, 'fill')}" class="card-img-top" style="height:220px;object-fit:cover" alt="" loading="lazy">` : ''}
      <div class="card-body d-flex flex-column">
        <h3 class="h5 card-title">${e.title}</h3>
        ${textField && e.data[textField.key] ? html`<p class="card-text text-muted">${String(e.data[textField.key]).slice(0, 220)}</p>` : ''}
        ${section.detail ? html`<a href="${entryUrl(section, e)}" class="text-success fw-bold text-decoration-none mt-auto stretched-link">Read More &rarr;</a>` : ''}
      </div></div></div>`);
}

function albumCards(section, items) {
  return items.map((e) => {
    const pics = asArray(e.data.images);
    return html`<div class="col-md-6 col-lg-4">
      <a class="gallery-item album-card" style="height:280px" href="${entryUrl(section, e)}">
        ${pics[0] ? html`<img src="${img(pics[0].url, 700, 560, 'fill')}" alt="" loading="lazy">` : html`<div class="photo-placeholder h-100"><i class="far fa-images fa-3x"></i></div>`}
        <span class="badge bg-dark bg-opacity-75 count"><i class="far fa-images me-1"></i>${pics.length}</span>
        <span class="gallery-overlay" style="opacity:1">${e.title}${e.data.date ? html`<br><small class="fw-normal">${formatDate(e.data.date)}</small>` : ''}</span>
      </a></div>`;
  });
}

function noticeList(items) {
  return html`<div class="list-group shadow-sm">${items.map((e) => html`<div class="list-group-item p-3" id="${e.slug}">
    <span class="badge ${/urgent/i.test(e.data.label) ? 'badge-urgent' : /adjourn/i.test(e.data.label) ? 'badge-gold' : 'badge-green'} me-2">${e.data.label || 'NOTICE'}</span>
    ${e.data.message || e.title}
    ${e.data.link ? html` <a href="${safeUrl(e.data.link)}" class="ms-2">More details</a>` : ''}
    <div class="small text-muted mt-1">Posted ${formatDate(e.publishedAt || e.createdAt, 'short')}${e.data.expires ? html`, valid until ${formatDate(e.data.expires, 'short')}` : ''}</div>
  </div>`)}</div>`;
}

// View (inside the website) and Download buttons for a document
function docButtons(entry, field, url, size = '', withView = true) {
  if (!url) return '';
  const isPdf = withView && fileLabel(url) === 'PDF';
  const base = `/doc/${encodeURIComponent(entry._id)}/${encodeURIComponent(field)}`;
  return html`<span class="doc-actions d-inline-flex gap-2 flex-wrap justify-content-end">
    ${isPdf ? html`<a href="/view/${encodeURIComponent(entry._id)}/${encodeURIComponent(field)}" class="btn btn-download ${size} px-3"><i class="far fa-eye me-2" aria-hidden="true"></i>View</a>` : ''}
    <a href="${base}?download=1" class="btn btn-download-alt ${size} px-3" download><i class="fas fa-download me-2" aria-hidden="true"></i>Download${fileLabel(url) === 'PDF' ? '' : ` ${fileLabel(url)}`}</a>
  </span>`;
}

function docRows(section, items) {
  const listFields = section.fields.filter((f) => f.showInList && f.type !== 'file');
  return items.map((e) => {
    const file = e.data.file;
    const meta = [e.data.note, ...listFields.map((f) => (isEmpty(e.data[f.key]) ? '' : f.type === 'date' ? `${f.label}: ${formatDate(e.data[f.key], 'short')}` : String(e.data[f.key])))].filter(Boolean);
    return html`<div class="doc-row" id="${e.slug}">
      <div><h3 class="h6 mb-0 fw-bold">${e.title}</h3>${meta.length ? html`<small class="text-muted">${meta.join(' | ')}</small>` : ''}</div>
      ${file ? docButtons(e, 'file', file) : html`<span class="badge bg-light text-muted border">Not yet available</span>`}
    </div>`;
  });
}

function docTable(section, items) {
  const cols = section.fields.filter((f) => f.showInList && f.type !== 'file');
  return html`<div class="table-responsive bg-white rounded shadow-sm"><table class="table table-hover align-middle mb-0 table-court">
    <thead><tr><th scope="col">${section.titleLabel || 'Title'}</th>${cols.map((c) => html`<th scope="col">${c.label}</th>`)}<th scope="col" class="text-end">Document</th></tr></thead>
    <tbody>${items.map((e) => {
      const isNew = e.data.date && (Date.now() - new Date(e.data.date).getTime()) / 86400000 < 30;
      return html`<tr id="${e.slug}">
        <td><span class="fw-bold" style="color:var(--court-green)">${e.title}</span>${isNew ? html` <span class="badge bg-success animate-pulse ms-1">NEW</span>` : ''}</td>
        ${cols.map((c) => html`<td>${c.type === 'date' ? formatDate(e.data[c.key], 'short') : c.type === 'select' ? html`<span class="badge rounded-pill ${/criminal/i.test(e.data[c.key]) ? 'bg-danger-subtle text-danger' : 'bg-primary-subtle text-primary'}">${e.data[c.key]}</span>` : e.data[c.key]}</td>`)}
        <td class="text-end">${e.data.file ? docButtons(e, 'file', e.data.file, 'btn-sm') : html`<span class="text-muted small">Not available</span>`}</td>
      </tr>`;
    })}</tbody></table></div>`;
}

function cardsFor(section, items) {
  switch (section.layout) {
    case 'profiles': return profileCards(section, items);
    case 'departments': return departmentCards(section, items);
    case 'articles': return articleCards(section, items);
    case 'gallery': return albumCards(section, items);
    default: return genericCards(section, items);
  }
}

// ---------- home page blocks ----------
function blockHero(b, ctx) {
  const d = b.data;
  return html`<header id="home" class="hero-bg text-center text-white" style="${bg(d.background, 0.78)}">
    <div class="container">
      ${d.kicker ? html`<h2 class="h3 fw-normal">${d.kicker}</h2>` : ''}
      <h1 class="court-title">${d.title || ctx.settings.siteName}</h1>
      ${d.motto ? html`<p class="lead mb-4">${d.motto}</p>` : ''}
      <div class="d-flex flex-wrap justify-content-center gap-3 mt-4">
        ${asArray(d.buttons).map((l) => html`<a href="${safeUrl(l.url)}" class="btn btn-outline-light btn-lg fw-bold shadow-sm">${l.icon ? html`<i class="${l.icon} me-2"></i>` : ''}${l.label}</a>`)}
      </div>
    </div>
  </header>`;
}

function blockNotices(b, ctx, data) {
  if (!data.items.length) return '';
  const item = (e) => html`<div class="ticker-item"><span class="badge ${/urgent/i.test(e.data.label) ? 'badge-urgent' : /adjourn/i.test(e.data.label) ? 'badge-gold' : 'badge-green'} me-2">${e.data.label || 'NOTICE'}</span>${e.data.link ? html`<a href="${safeUrl(e.data.link)}">${e.data.message || e.title}</a>` : e.data.message || e.title}</div>`;
  return html`<div class="ticker-wrapper shadow-sm" role="region" aria-label="Notices"><div class="ticker-content">${data.items.map(item)}</div></div>`;
}

function blockMessage(b) {
  const d = b.data;
  return html`<section class="py-5"><div class="container"><div class="row cj-wrapper shadow-sm g-0">
    <div class="col-lg-5">${photo(d.photo, 'cj-image w-100', d.name || 'Photo', 900)}</div>
    <div class="col-lg-7 p-4 p-lg-5">
      <h2 class="fw-bold mb-4">${d.heading}</h2>
      ${d.quote ? html`<p class="fst-italic text-muted mb-4 cj-quote text-justify">"${d.quote}"</p>` : ''}
      <div class="text-justify rich-content">${raw(d.body || '')}</div>
      <div class="mt-4"><h3 class="h5 fw-bold mb-0">${d.name}</h3><p class="text-muted">${d.title}</p></div>
    </div></div></div></section>`;
}

function blockFeature(b) {
  const d = b.data;
  return html`<section id="${b.anchor || 'feature-' + b.id.slice(0, 6)}" class="container mt-5 py-5"><div class="row align-items-center g-4">
    <div class="${d.image ? 'col-md-7' : 'col-12'}">
      <h2 class="section-title">${d.heading}</h2>
      <div class="fs-5 text-secondary text-justify rich-content">${raw(d.text || '')}</div>
      ${d.buttonLabel && d.buttonUrl ? html`<a href="${safeUrl(d.buttonUrl)}" class="btn btn-outline-dark mt-3">${d.buttonLabel}</a>` : ''}
    </div>
    ${d.image ? html`<div class="col-md-5 text-center"><img src="${img(d.image, 700, 700, 'fill')}" class="img-fluid rounded shadow" style="height:350px;width:350px;object-fit:cover" alt="" loading="lazy"></div>` : ''}
  </div></section>`;
}

function blockPromo(b) {
  const d = b.data;
  return html`<section class="py-5" style="background-color:#f0f7f0;"><div class="container">
    <div class="row align-items-stretch shadow-sm rounded-4 overflow-hidden bg-white g-0" style="border-right:8px solid var(--court-gold);">
      ${d.image ? html`<div class="col-lg-4 d-none d-lg-block" style="background:url('${img(d.image, 900)}') center/cover;min-height:300px"></div>` : ''}
      <div class="${d.image ? 'col-lg-8' : 'col-12'} p-4 p-lg-5">
        <h2 class="fw-bold" style="color:var(--court-green);">${d.heading}</h2>
        <div class="lead text-muted rich-content">${raw(d.lead || '')}</div>
        ${asArray(d.bullets).length ? html`<ul class="list-unstyled mb-4">${asArray(d.bullets).map((x) => html`<li><i class="fas fa-check-circle text-success me-2"></i>${x}</li>`)}</ul>` : ''}
        ${d.buttonLabel && d.buttonUrl ? html`<a href="${safeUrl(d.buttonUrl)}" class="btn btn-success btn-lg px-4 shadow">${d.buttonLabel} <i class="fas fa-arrow-right ms-2"></i></a>` : ''}
      </div></div></div></section>`;
}

function centeredHeading(d, fallback) {
  return html`<div class="section-heading-center">
    ${d.kicker ? html`<span class="section-kicker">${d.kicker}</span>` : ''}
    <h2 class="section-title">${d.heading || fallback}</h2>
    ${d.intro ? html`<p class="section-intro">${d.intro}</p>` : ''}</div>`;
}

function blockSection(b, ctx, data) {
  const d = b.data;
  const section = data.section;
  if (!section) return '';
  const items = data.items;
  const more = d.buttonLabel ? html`<div class="text-center mt-4"><a href="/${section.slug}" class="btn btn-outline-success btn-lg px-4 rounded-pill">${d.buttonLabel} <i class="fas fa-arrow-right ms-2"></i></a></div>` : '';
  const id = section.slug;
  switch (section.layout) {
    case 'profiles':
      return html`<section id="${id}" class="container py-5">
        ${centeredHeading(d, section.name)}
        ${items.length ? html`<div class="row justify-content-center">${profileCards(section, items)}</div>` : empty('Nothing has been added yet.')}
        ${more}
      </section>`;
    case 'honours':
      return html`<section id="${id}" class="py-5 bg-light"><div class="container">
        ${centeredHeading(d, section.name)}
        ${honoursList(section, items)}${more}</div></section>`;
    case 'departments':
      return html`<section id="${id}" class="bg-light py-5"><div class="container">
        ${centeredHeading(d, section.name)}
        <div class="row g-4">${departmentCards(section, items)}</div>${more}</div></section>`;
    case 'gallery': {
      const pics = [];
      items.forEach((a) => asArray(a.data.images).forEach((p) => pics.push({ ...p, album: a })));
      const top = pics.slice(0, 3);
      const tile = (p, h) => html`<a class="gallery-item" style="height:${h}px" href="${entryUrl(section, p.album)}">
        <img src="${img(p.url, 900, h * 2, 'fill')}" alt="${p.caption || p.album.title}" loading="lazy"><span class="gallery-overlay">${p.caption || p.album.title}</span></a>`;
      return html`<section id="${id}" class="py-5 bg-white"><div class="container">
        <div class="row align-items-end mb-5 g-3">
          <div class="col-lg-8">${d.kicker ? html`<span class="section-kicker">${d.kicker}</span>` : ''}<h2 class="section-title mb-3">${d.heading || section.name}</h2>${d.intro ? html`<p class="section-intro mb-0">${d.intro}</p>` : ''}</div>
          <div class="col-lg-4 text-lg-end"><a href="/${section.slug}" class="btn btn-outline-success btn-lg px-4 rounded-pill">${d.buttonLabel || 'View Full Gallery'} <i class="fas fa-arrow-right ms-2"></i></a></div>
        </div>
        ${top.length ? html`<div class="row g-3">
          <div class="col-md-6">${tile(top[0], 415)}</div>
          <div class="col-md-6"><div class="row g-3">${top.slice(1).map((p) => html`<div class="col-12">${tile(p, 200)}</div>`)}</div></div>
        </div>` : empty('Photos will appear here once albums are added in the dashboard.')}
      </div></section>`;
    }
    case 'documents':
      return html`<section id="${id}" class="py-5 bg-light"><div class="container">
        <h2 class="section-title">${d.heading || section.name}</h2>${d.intro ? html`<p class="text-muted">${d.intro}</p>` : ''}
        ${items.length ? docRows(section, items) : empty('No documents yet.')}
        ${html`<div class="text-center mt-4"><a href="/${section.slug}" class="btn btn-outline-success">${d.buttonLabel || 'View all'}</a></div>`}
      </div></section>`;
    case 'notices':
      return html`<section id="${id}" class="py-5"><div class="container"><h2 class="section-title">${d.heading || section.name}</h2>${items.length ? noticeList(items) : empty('There are no current notices.')}${more}</div></section>`;
    default:
      return html`<section id="${id}" class="bg-white py-5"><div class="container">
        ${centeredHeading(d, section.name)}
        <div class="row g-4">${cardsFor(section, items)}</div>${items.length ? '' : empty('Nothing has been added yet.')}${more}</div></section>`;
  }
}

function blockContact(b, ctx) {
  const d = b.data;
  const s = ctx.settings;
  const flash = ctx.query && ctx.query.sent ? html`<div class="alert alert-success">Thank you. Your message has been received.</div>` : ctx.query && ctx.query.error ? html`<div class="alert alert-danger">${ctx.query.error === 'rate' ? 'Too many messages were sent from your connection. Please try again later.' : 'Please fill in your name, a valid email address and your message.'}</div>` : '';
  return html`<section id="contact" class="section-padding bg-light"><div class="container">
    ${centeredHeading({ heading: d.heading, intro: d.intro }, 'Contact Us')}
    <div class="row g-4">
      <div class="${d.showForm ? 'col-lg-4' : 'col-12'}"><div class="contact-card h-100">
        <h3 class="h4 color-primary mb-4">Contact Information</h3>
        ${s.address ? html`<div class="info-item mb-4"><i class="fas fa-map-marker-alt"></i><div><p class="fw-bold mb-0">Address</p><p>${s.address}</p></div></div>` : ''}
        ${s.phone ? html`<div class="info-item mb-4"><i class="fas fa-phone-alt"></i><div><p class="fw-bold mb-0">Phone</p><p><a href="tel:${s.phone.replace(/\s+/g, '')}" class="text-reset">${s.phone}</a></p></div></div>` : ''}
        ${s.email ? html`<div class="info-item mb-4"><i class="fas fa-envelope"></i><div><p class="fw-bold mb-0">Email</p><p><a href="mailto:${s.email}" class="text-reset">${s.email}</a></p></div></div>` : ''}
        <div class="social-links-contact mt-4">
          ${s.facebook ? html`<a href="${safeUrl(s.facebook)}" target="_blank" rel="noopener" aria-label="Facebook"><i class="fab fa-facebook-f"></i></a>` : ''}
          ${s.twitter ? html`<a href="${safeUrl(s.twitter)}" target="_blank" rel="noopener" aria-label="X (Twitter)"><i class="fab fa-x-twitter"></i></a>` : ''}
          ${s.youtube ? html`<a href="${safeUrl(s.youtube)}" target="_blank" rel="noopener" aria-label="YouTube"><i class="fab fa-youtube"></i></a>` : ''}
          ${s.instagram ? html`<a href="${safeUrl(s.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><i class="fab fa-instagram"></i></a>` : ''}
        </div></div></div>
      ${d.showForm ? html`<div class="col-lg-8"><div class="contact-card">
        <h3 class="h4 color-primary mb-4">Send us a Message</h3>${flash}
        <form action="/contact" method="post" class="custom-form">
          <input type="hidden" name="_form" value="${ctx.formToken}">
          <div class="hp-field" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <div class="row g-3">
            <div class="col-md-6"><label class="visually-hidden" for="c_name">Your name</label><input id="c_name" type="text" name="name" class="form-control" placeholder="Your Name" required maxlength="120"></div>
            <div class="col-md-6"><label class="visually-hidden" for="c_email">Your email</label><input id="c_email" type="email" name="email" class="form-control" placeholder="Your Email" required maxlength="200"></div>
            <div class="col-12"><label class="visually-hidden" for="c_subject">Subject</label><input id="c_subject" type="text" name="subject" class="form-control" placeholder="Subject" maxlength="200"></div>
            <div class="col-12"><label class="visually-hidden" for="c_msg">Your message</label><textarea id="c_msg" name="message" class="form-control" rows="5" placeholder="Your Message" required maxlength="5000"></textarea></div>
            <div class="col-12"><button type="submit" class="btn-submit">Send Message</button></div>
          </div>
        </form></div></div>` : ''}
      ${d.showMap && s.mapEmbed ? html`<div class="col-12 mt-4"><div class="map-container"><iframe src="${safeUrl(s.mapEmbed)}" title="Map" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div></div>` : ''}
    </div></div></section>`;
}

function blockRichtext(b) {
  return html`<section class="py-5"><div class="container">${b.data.heading ? html`<h2 class="section-title">${b.data.heading}</h2>` : ''}<div class="rich-content">${raw(b.data.body || '')}</div></div></section>`;
}

function homePage(ctx, blocks) {
  const parts = blocks.map(({ block, data }) => {
    switch (block.type) {
      case 'hero': return blockHero(block, ctx);
      case 'notices': return blockNotices(block, ctx, data);
      case 'message': return blockMessage(block);
      case 'feature': return blockFeature(block);
      case 'promo': return blockPromo(block);
      case 'section': return blockSection(block, ctx, data);
      case 'contact': return blockContact(block, ctx);
      case 'richtext': return blockRichtext(block);
      default: return '';
    }
  });
  return layout(ctx, { title: '', body: html`${parts}` });
}

// ---------- section pages ----------
function sectionPage(ctx, section, data) {
  const { items, total, page, perPage } = data;
  const banner = section.banner || ctx.settings.pageBanner;
  let content;
  switch (section.layout) {
    case 'profiles':
      content = html`<div class="container py-5"><div class="row justify-content-center">${profileCards(section, items)}</div>${items.length ? '' : empty('Nothing has been added yet.')}</div>`;
      break;
    case 'honours':
      content = html`<div class="bg-light py-5"><div class="container">${honoursList(section, items)}</div></div>`;
      break;
    case 'notices':
      content = html`<div class="container py-5">${items.length ? noticeList(items) : empty('There are no current notices.')}</div>`;
      break;
    case 'documents':
      content = documentsBody(ctx, section, data);
      break;
    default:
      content = html`<div class="container py-5"><div class="row g-4">${cardsFor(section, items)}</div>${items.length ? '' : empty('Nothing has been published here yet.')}
        ${pagination(page, Math.ceil(total / perPage), (p) => `/${section.slug}?page=${p}`)}</div>`;
  }
  const body = html`${pageHero(section.name, section.intro, banner)}
    ${crumbs([{ label: 'Home', url: '/' }, { label: section.name }])}
    <div class="bg-soft">${content}</div>`;
  return layout(ctx, { title: section.name, description: section.intro, body });
}

function documentsBody(ctx, section, data) {
  const { items, total, page, perPage, q, filters, year } = data;
  const filterFields = section.fields.filter((f) => f.filter && (f.type === 'select' || f.type === 'date'));
  const form = html`<form class="filter-section mb-4" method="get" action="/${section.slug}" role="search">
    <div class="row g-3 align-items-end">
      <div class="col-md-${filterFields.length ? 5 : 10}"><label class="form-label small fw-bold text-muted" for="q">SEARCH</label>
        <input id="q" type="search" name="q" value="${q}" class="form-control" placeholder="Search by title${section.fields.some((f) => f.key === 'suitNo') ? ' or suit number' : ''}..."></div>
      ${filterFields.map((f) => (f.type === 'date'
        ? html`<div class="col-md-2"><label class="form-label small fw-bold text-muted" for="y_${f.key}">YEAR</label><select id="y_${f.key}" name="year" class="form-select"><option value="">All years</option>${data.years.map((y) => html`<option${String(y) === String(year) ? raw(' selected') : ''}>${y}</option>`)}</select></div>`
        : html`<div class="col-md-3"><label class="form-label small fw-bold text-muted" for="f_${f.key}">${f.label.toUpperCase()}</label><select id="f_${f.key}" name="${f.key}" class="form-select"><option value="">All</option>${options(f).map((o) => html`<option${filters[f.key] === o ? raw(' selected') : ''}>${o}</option>`)}</select></div>`))}
      <div class="col-md-2 d-grid"><button class="btn btn-court" type="submit"><i class="fas fa-search me-1"></i>Search</button></div>
    </div></form>`;
  let list;
  const groupField = section.groupBy && section.fields.find((f) => f.key === section.groupBy);
  if (!items.length) list = empty(q || Object.values(filters).some(Boolean) || year ? 'No documents match your search.' : 'No documents have been published yet.');
  else if (section.display === 'table') list = docTable(section, items);
  else if (groupField && !q) {
    const groups = [...new Set([...options(groupField), ...items.map((e) => e.data[groupField.key] || 'Other')])].filter((g) => items.some((e) => (e.data[groupField.key] || 'Other') === g));
    list = html`<ul class="nav nav-tabs doc-tabs mb-4 justify-content-center" role="tablist">
      ${groups.map((g, i) => html`<li class="nav-item" role="presentation"><button class="nav-link${i ? '' : ' active'}" data-bs-toggle="tab" data-bs-target="#grp-${i}" type="button" role="tab">${g}</button></li>`)}
    </ul><div class="tab-content">${groups.map((g, i) => html`<div class="tab-pane fade${i ? '' : ' show active'}" id="grp-${i}" role="tabpanel">${docRows(section, items.filter((e) => (e.data[groupField.key] || 'Other') === g))}</div>`)}</div>`;
  } else list = docRows(section, items);
  const url = (p) => `/${section.slug}?${new URLSearchParams({ ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(year ? { year } : {}), page: p })}`;
  return html`<div class="container pb-5 pt-1">${form}
    <p class="small text-muted">${total} ${total === 1 ? 'document' : 'documents'}${data.updated ? html`. Last updated ${formatDate(data.updated)}` : ''}.</p>
    ${list}${pagination(page, Math.ceil(total / perPage), url)}</div>`;
}

// ---------- detail pages ----------
function extraFields(section, entry, ctx) {
  const used = new Set(LAYOUTS[section.layout] ? LAYOUTS[section.layout].uses : []);
  const rows = section.fields.filter((f) => !used.has(f.key) && f.type !== 'reference' && !isEmpty(entry.data[f.key]));
  if (!rows.length) return '';
  const short = rows.filter((f) => !['richtext', 'textarea', 'images', 'cards', 'list', 'image'].includes(f.type));
  const long = rows.filter((f) => !short.includes(f));
  return html`${short.length ? html`<dl class="row mb-4">${short.map((f) => html`<dt class="col-sm-4">${f.label}</dt><dd class="col-sm-8">${display(f, entry.data[f.key], { ...ctx, entryId: entry._id, docButtons })}</dd>`)}</dl>` : ''}
    ${long.map((f) => html`<div class="mb-4"><h3 class="h5 fw-bold" style="color:var(--court-green)">${f.label}</h3><div class="rich-content">${display(f, entry.data[f.key], { ...ctx, entryId: entry._id, docButtons })}</div></div>`)}`;
}

function relatedBlocks(ctx) {
  return (ctx.related || []).map((r) => html`<section class="py-5 bg-white border-top"><div class="container">
    <h2 class="section-title">${r.section.name}</h2>
    ${r.section.layout === 'documents' ? docRows(r.section, r.items) : r.section.layout === 'honours' ? honoursList(r.section, r.items) : html`<div class="row g-4">${cardsFor(r.section, r.items)}</div>`}
  </div></section>`);
}

function parentLink(ctx) {
  return (ctx.parents || []).map((p) => html`<p class="mb-0"><span class="text-muted">${p.label}:</span> <a href="${p.url}">${p.title}</a></p>`);
}

function profileDetail(ctx, section, e) {
  const d = e.data;
  const used = new Set(LAYOUTS.profiles.uses);
  const info = section.fields.filter((f) => !used.has(f.key) && ['text', 'date', 'select', 'email', 'url', 'number'].includes(f.type) && !isEmpty(d[f.key]));
  const longExtra = section.fields.filter((f) => !used.has(f.key) && !info.includes(f) && f.type !== 'reference' && !isEmpty(d[f.key]));
  return html`<header class="profile-header text-center" style="${bg(section.banner || ctx.settings.pageBanner, 0.9)}">
      <div class="container mt-4"><h1 class="display-5 fw-bold">${e.title}</h1>${d.subtitle ? html`<p class="fs-4">${d.subtitle}</p>` : ''}</div>
    </header>
    <div class="bg-soft"><div class="container pb-5">
      <div class="row">
        <div class="col-lg-4 judge-portrait-container text-center text-lg-start">
          ${photo(d.photo, 'judge-portrait mb-4', e.title, 600, 760, 'fill')}
          ${info.length || (ctx.parents || []).length ? html`<div class="sidebar-card shadow-sm mb-4">
            <h2 class="h5 fw-bold mb-3"><i class="fas fa-briefcase me-2 text-success"></i>Quick Information</h2>
            ${info.map((f) => html`<span class="info-label">${f.label}</span><p>${display(f, d[f.key], { ...ctx, entryId: e._id, docButtons })}</p>`)}${parentLink(ctx)}
          </div>` : ''}
          <a href="/${section.slug}" class="btn btn-outline-success mb-4"><i class="fas fa-arrow-left me-1"></i> Back to ${section.name}</a>
        </div>
        <div class="col-lg-8 pt-4">
          ${d.bio ? html`<div class="bio-section shadow-sm"><h2 class="bio-title">Professional Profile</h2><div class="rich-content text-justify">${raw(d.bio)}</div></div>` : ''}
          ${asArray(d.education).length ? html`<div class="bio-section shadow-sm"><h2 class="bio-title">Educational Background</h2><ul class="list-group list-group-flush">
            ${asArray(d.education).map((x) => html`<li class="list-group-item bg-transparent border-0 ps-0"><i class="${x.icon || 'fas fa-graduation-cap'} me-3 text-success"></i>${x.title ? html`<strong>${x.title}:</strong> ` : ''}${x.text}</li>`)}</ul></div>` : ''}
          ${asArray(d.career).length ? html`<div class="bio-section shadow-sm"><h2 class="bio-title">Career Milestones</h2><div class="ms-3 mt-3">
            ${asArray(d.career).map((x, i) => html`<div class="mb-4 border-start ${i ? 'border-secondary' : 'border-success'} border-3 ps-3"><h3 class="h6 fw-bold">${x.title}</h3><p class="small text-muted mb-0">${x.text}</p></div>`)}</div></div>` : ''}
          ${longExtra.map((f) => html`<div class="bio-section shadow-sm"><h2 class="bio-title">${f.label}</h2><div class="rich-content">${display(f, d[f.key], { ...ctx, entryId: e._id, docButtons })}</div></div>`)}
          ${d.more ? html`<div class="bio-section shadow-sm rich-content">${raw(d.more)}</div>` : ''}
        </div>
      </div></div></div>${relatedBlocks(ctx)}`;
}

function departmentDetail(ctx, section, e) {
  const d = e.data;
  return html`<header class="page-hero dept-hero text-center" style="${bg(d.banner || section.banner || ctx.settings.pageBanner, 0.85)}">
      <div class="container">
        ${d.icon ? html`<i class="${d.icon} fa-3x mb-4" style="color:var(--court-gold)" aria-hidden="true"></i>` : ''}
        <h1 class="display-5 fw-bold">${d.heading || e.title}</h1>
        ${d.tagline ? html`<p class="lead mb-0">${d.tagline}</p>` : ''}
      </div></header>
    ${crumbs([{ label: 'Home', url: '/' }, { label: section.name, url: '/' + section.slug }, { label: e.title }])}
    <section class="py-5"><div class="container">
      <div class="row g-5">
        <div class="${d.headName || d.headPhoto || d.email || d.office ? 'col-lg-7' : 'col-12'}">
          <h2 class="section-title mb-4">Overview</h2>
          <div class="rich-content">${raw(d.overview || '')}</div>
          ${extraFields(section, e, ctx)}${parentLink(ctx)}
        </div>
        ${d.headName || d.headPhoto || d.email || d.office ? html`<div class="col-lg-5"><div class="card shadow border-0 overflow-hidden">
          <div class="text-center bg-light py-4">${d.headPhoto ? html`<img src="${img(d.headPhoto, 400, 400, 'fill')}" alt="${d.headName || 'Head of department'}" class="rounded-circle border border-4 border-white shadow-sm dept-head-photo">` : html`<div class="rounded-circle border border-4 border-white shadow-sm dept-head-photo photo-placeholder mx-auto"><i class="fas fa-user fa-3x"></i></div>`}</div>
          <div class="card-body text-center">
            ${d.headName ? html`<h3 class="h4 fw-bold mb-1" style="color:#004d00;">${d.headName}</h3>` : ''}
            ${d.headTitle ? html`<p class="text-muted mb-3">${d.headTitle}</p>` : ''}
            ${d.headQuote ? html`<hr><p class="card-text px-3 fst-italic text-muted">"${d.headQuote}"</p>` : ''}
            ${d.email || d.office ? html`<div class="bg-light p-3 rounded text-start mt-4">
              ${d.email ? html`<p class="small mb-1"><strong><i class="fas fa-envelope me-2 text-success"></i>Email:</strong> <a href="mailto:${d.email}">${d.email}</a></p>` : ''}
              ${d.office ? html`<p class="small mb-0"><strong><i class="fas fa-map-marker-alt me-2 text-success"></i>Office:</strong> ${d.office}</p>` : ''}
            </div>` : ''}
          </div></div></div>` : ''}
      </div>
      ${asArray(d.responsibilities).length ? html`<div class="mt-5"><h2 class="h3 text-center mb-5 fw-bold">${d.responsibilitiesTitle || 'Core Responsibilities'}</h2>
        <div class="row g-4">${asArray(d.responsibilities).map((r) => html`<div class="col-md-4"><div class="card h-100 p-4 text-center card-lift">
          ${r.icon ? html`<i class="${r.icon} fa-2x mb-3 text-success"></i>` : ''}<h3 class="h6 fw-bold">${r.title}</h3><p class="small mb-0">${r.text}</p></div></div>`)}</div></div>` : ''}
      ${d.more ? html`<div class="mt-5 rich-content">${raw(d.more)}</div>` : ''}
    </div></section>${relatedBlocks(ctx)}`;
}

function articleDetail(ctx, section, e) {
  const d = e.data;
  return html`${pageHero(e.title, d.category ? `${d.category}${d.date ? ' | ' + formatDate(d.date) : ''}` : formatDate(d.date), section.banner || ctx.settings.pageBanner, { compact: true })}
    ${crumbs([{ label: 'Home', url: '/' }, { label: section.name, url: '/' + section.slug }, { label: e.title }])}
    <article class="container py-5" style="max-width: 900px">
      ${d.image ? html`<img src="${img(d.image, 1400)}" class="img-fluid rounded shadow-sm mb-4 w-100" alt="">` : ''}
      ${d.summary ? html`<p class="lead">${d.summary}</p>` : ''}
      <div class="rich-content fs-5">${raw(d.body || '')}</div>
      ${d.attachment ? html`<div class="mt-4 p-3 bg-light rounded d-flex flex-wrap align-items-center gap-3"><span class="fw-semibold"><i class="fas fa-paperclip me-2 text-muted" aria-hidden="true"></i>Attachment</span>${docButtons(e, 'attachment', d.attachment)}</div>` : ''}
      ${extraFields(section, e, ctx)}${parentLink(ctx)}
      <a href="/${section.slug}" class="btn btn-outline-success mt-4"><i class="fas fa-arrow-left me-1"></i> Back to ${section.name}</a>
    </article>${relatedBlocks(ctx)}`;
}

function galleryDetail(ctx, section, e) {
  const pics = asArray(e.data.images);
  return html`${pageHero(e.title, e.data.date ? formatDate(e.data.date) : '', section.banner || ctx.settings.pageBanner, { compact: true })}
    ${crumbs([{ label: 'Home', url: '/' }, { label: section.name, url: '/' + section.slug }, { label: e.title }])}
    <div class="container py-5">
      ${e.data.description ? html`<p class="lead text-muted">${e.data.description}</p>` : ''}
      ${pics.length ? html`<div class="row g-4" data-lightbox-group>
        ${pics.map((p, i) => html`<div class="col-lg-4 col-md-6"><a class="gallery-item" style="height:280px" href="${img(p.url, 2000)}" data-lightbox-index="${i}" data-caption="${p.caption || ''}">
          <img src="${img(p.url, 700, 560, 'fill')}" alt="${p.caption || e.title + ' photo ' + (i + 1)}" loading="lazy">${p.caption ? html`<span class="gallery-overlay">${p.caption}</span>` : ''}</a></div>`)}
      </div>` : empty('This album has no photos yet.')}
      ${extraFields(section, e, ctx)}
      <a href="/${section.slug}" class="btn btn-outline-success mt-4"><i class="fas fa-arrow-left me-1"></i> All albums</a>
    </div>
    <div class="modal fade lightbox" id="lightbox" tabindex="-1" aria-label="Photo viewer" aria-hidden="true"><div class="modal-dialog modal-fullscreen"><div class="modal-content">
      <div class="modal-header border-0"><span class="text-white" data-lb-caption></span><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button></div>
      <div class="modal-body d-flex align-items-center justify-content-center position-relative">
        <button type="button" class="nav-arrow prev-arrow" data-lb="prev" aria-label="Previous photo"><i class="fas fa-chevron-left"></i></button>
        <img src="" alt="" data-lb-img>
        <button type="button" class="nav-arrow next-arrow" data-lb="next" aria-label="Next photo"><i class="fas fa-chevron-right"></i></button>
      </div></div></div></div>`;
}

function pageDetail(ctx, section, e) {
  const d = e.data;
  return html`${pageHero(e.title, d.subtitle, d.banner || ctx.settings.pageBanner)}
    <div class="rich-content">${raw(d.body || '')}</div>
    ${extraFields(section, e, ctx) ? html`<div class="container py-4">${extraFields(section, e, ctx)}</div>` : ''}${relatedBlocks(ctx)}`;
}

function genericDetail(ctx, section, e) {
  const d = e.data;
  const imgField = section.fields.find((f) => f.type === 'image');
  return html`${pageHero(e.title, d.summary && d.summary.length < 160 ? d.summary : '', section.banner || ctx.settings.pageBanner, { compact: true })}
    ${crumbs([{ label: 'Home', url: '/' }, { label: section.name, url: '/' + section.slug }, { label: e.title }])}
    <div class="container py-5" style="max-width: 1000px">
      ${imgField && d[imgField.key] ? html`<img src="${img(d[imgField.key], 1400)}" class="img-fluid rounded shadow-sm mb-4" alt="">` : ''}
      ${d.summary && d.summary.length >= 160 ? html`<p class="lead">${d.summary}</p>` : ''}
      ${d.body ? html`<div class="rich-content mb-4">${raw(d.body)}</div>` : ''}
      ${extraFields(section, e, ctx)}${parentLink(ctx)}
      <a href="/${section.slug}" class="btn btn-outline-success mt-2"><i class="fas fa-arrow-left me-1"></i> Back to ${section.name}</a>
    </div>${relatedBlocks(ctx)}`;
}

function entryPage(ctx, section, e) {
  let body;
  switch (section.layout) {
    case 'profiles': body = profileDetail(ctx, section, e); break;
    case 'departments': body = departmentDetail(ctx, section, e); break;
    case 'articles': body = articleDetail(ctx, section, e); break;
    case 'gallery': body = galleryDetail(ctx, section, e); break;
    case 'pages': body = pageDetail(ctx, section, e); break;
    default: body = genericDetail(ctx, section, e);
  }
  const d = e.data || {};
  const desc = stripTags(d.summary || d.tagline || d.subtitle || d.bio || d.overview || d.body || '').slice(0, 200);
  const image = d.photo || d.image || d.headPhoto || (asArray(d.images)[0] || {}).url;
  if (ctx.preview) body = html`<div class="alert alert-warning text-center mb-0 rounded-0">Preview of a draft. This page is not visible to the public until it is published.</div>${body}`;
  return layout(ctx, { title: e.title, description: desc, body, image });
}

// Document viewer: shows a PDF inside the website
function documentViewer(ctx, { section, entry, field, url, backUrl }) {
  const isPdf = fileLabel(url) === 'PDF';
  const src = `/doc/${encodeURIComponent(entry._id)}/${encodeURIComponent(field)}`;
  const body = html`<header class="page-hero compact text-center" style="${bg(section.banner || ctx.settings.pageBanner, 0.88)}">
      <div class="container"><p class="text-uppercase small fw-bold mb-2" style="letter-spacing:1px;color:var(--court-gold-bright)">${section.name}</p><h1 class="h2 fw-bold mb-0">${entry.title}</h1></div>
    </header>
    ${crumbs([{ label: 'Home', url: '/' }, { label: section.name, url: '/' + section.slug }, { label: entry.title }])}
    <div class="bg-soft py-4"><div class="container">
      <div class="viewer-toolbar d-flex flex-wrap align-items-center gap-2 mb-3">
        <a href="${backUrl}" class="btn btn-outline-success btn-sm"><i class="fas fa-arrow-left me-1" aria-hidden="true"></i>Back</a>
        ${isPdf ? html`<div class="d-flex align-items-center gap-1 ms-md-3" data-pdf-controls hidden>
          <button type="button" class="btn btn-light btn-sm border" data-pdf="prev" aria-label="Previous page"><i class="fas fa-chevron-up" aria-hidden="true"></i></button>
          <span class="small px-2" data-pdf="pages" aria-live="polite"></span>
          <button type="button" class="btn btn-light btn-sm border" data-pdf="next" aria-label="Next page"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>
          <button type="button" class="btn btn-light btn-sm border ms-2" data-pdf="zoomout" aria-label="Zoom out"><i class="fas fa-magnifying-glass-minus" aria-hidden="true"></i></button>
          <button type="button" class="btn btn-light btn-sm border" data-pdf="zoomin" aria-label="Zoom in"><i class="fas fa-magnifying-glass-plus" aria-hidden="true"></i></button>
        </div>` : ''}
        <span class="ms-auto">${docButtons(entry, field, url, 'btn-sm', false)}</span>
      </div>
      ${isPdf ? html`<div class="pdf-viewer" data-pdf-src="${src}" tabindex="0" aria-label="Document: ${entry.title}">
          <div class="pdf-status text-center text-muted py-5" data-pdf="status"><div class="spinner-border text-success mb-3" role="status"></div><div>Opening the document...</div></div>
        </div>
        <noscript><p class="text-center py-4"><a href="${src}">Open the document</a></p></noscript>`
        : html`<div class="text-center py-5 bg-white rounded shadow-sm"><i class="far fa-file-lines fa-3x text-muted mb-3" aria-hidden="true"></i><p class="lead">This document cannot be shown on the page. Please download it to read it.</p></div>`}
    </div></div>
    ${isPdf ? html`<script type="module" src="/js/pdfview.js?v=${ctx.version}"></script>` : ''}`;
  return layout(ctx, { title: entry.title, description: `${section.name}: ${entry.title}`, body });
}

function errorPage(ctx, status, message) {
  const body = html`${pageHero(status === 404 ? 'Page not found' : 'Something went wrong', '', ctx.settings.pageBanner, { compact: true })}
    <div class="container py-5 text-center"><p class="lead">${message || (status === 404 ? 'The page you are looking for may have been moved or no longer exists.' : 'Please try again in a moment.')}</p>
    <a href="/" class="btn btn-court mt-3">Go to the home page</a></div>`;
  return layout(ctx, { title: status === 404 ? 'Page not found' : 'Error', body });
}

module.exports = { layout, homePage, sectionPage, entryPage, errorPage, documentViewer, esc };
