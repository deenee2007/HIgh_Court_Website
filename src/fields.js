'use strict';
// Field types available when building a section. Each type knows how to draw
// its input in the admin, read the submitted form, and show itself publicly.
const { html, raw, esc, sel, chk, safeUrl } = require('./views/html');
const { sanitizeHtml } = require('./sanitize');
const { saveUpload, img, fileLabel } = require('./media');

const TYPES = {
  text: 'Short text',
  textarea: 'Paragraph (plain text)',
  richtext: 'Formatted text (editor)',
  number: 'Number',
  date: 'Date',
  email: 'Email address',
  url: 'Web link',
  select: 'Dropdown choice',
  toggle: 'Yes / No',
  image: 'Photo or image',
  images: 'Photo album (many images)',
  file: 'Document (PDF, Word, Excel)',
  list: 'List of lines',
  cards: 'Repeating items (icon, title, text)',
  links: 'Buttons or links (label and address)',
  reference: 'Belongs to an item in another section',
};

const str = (v) => (v == null ? '' : Array.isArray(v) ? String(v[v.length - 1]) : String(v)).trim();
const options = (f) => (Array.isArray(f.options) ? f.options : String(f.options || '').split('\n')).map((s) => String(s).trim()).filter(Boolean);
const asArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]) : []);

function formatDate(v, style = 'long') {
  if (!v) return '';
  const d = new Date(String(v).length === 10 ? v + 'T12:00:00' : v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('en-GB', style === 'short' ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------- admin inputs ----------
function input(f, value, ctx = {}) {
  const name = `data[${f.key}]`;
  const id = `f_${f.key}`;
  const req = f.required ? raw(' required') : '';
  const v = value == null ? '' : value;
  switch (f.type) {
    case 'textarea':
      return html`<textarea class="form-control" id="${id}" name="${name}" rows="4"${req}>${v}</textarea>`;
    case 'richtext':
      return html`<textarea class="form-control richtext" id="${id}" name="${name}" rows="12">${v}</textarea>`;
    case 'number':
      return html`<input type="number" step="any" class="form-control" id="${id}" name="${name}" value="${v}"${req}>`;
    case 'date':
      return html`<input type="date" class="form-control" id="${id}" name="${name}" value="${v}"${req}>`;
    case 'email':
      return html`<input type="email" class="form-control" id="${id}" name="${name}" value="${v}"${req}>`;
    case 'url':
      return html`<input type="text" inputmode="url" class="form-control" id="${id}" name="${name}" value="${v}" placeholder="https://"${req}>`;
    case 'select':
      return html`<select class="form-select" id="${id}" name="${name}"${req}><option value="">(choose)</option>${options(f).map((o) => html`<option${sel(o, v)}>${o}</option>`)}</select>`;
    case 'toggle':
      return html`<div class="form-check form-switch"><input type="hidden" name="${name}" value=""><input class="form-check-input" type="checkbox" id="${id}" name="${name}" value="1"${chk(v)}><label class="form-check-label" for="${id}">Yes</label></div>`;
    case 'image':
      return html`<div class="upload-box">
        ${v ? html`<div class="mb-2 d-flex align-items-center gap-3"><img src="${img(v, 240)}" class="thumb" alt=""><label class="form-check-label small"><input type="checkbox" class="form-check-input me-1" name="remove[${f.key}]" value="1"> Remove this image</label></div>` : ''}
        <input type="hidden" name="${name}" value="${v}">
        <input type="file" class="form-control" id="${id}" name="upload[${f.key}]" accept="image/jpeg,image/png,image/webp,image/gif">
        <div class="form-text">${v ? 'Choose a new file to replace the current image.' : 'JPG, PNG or WEBP.'}</div></div>`;
    case 'file':
      return html`<div class="upload-box">
        ${v ? html`<div class="mb-2"><a href="${safeUrl(v)}" target="_blank" rel="noopener">${fileLabel(v)} document: ${decodeURIComponent(String(v).split('/').pop())}</a>
          <label class="form-check-label small ms-3"><input type="checkbox" class="form-check-input me-1" name="remove[${f.key}]" value="1"> Remove</label></div>` : ''}
        <input type="hidden" name="${name}" value="${v}">
        <input type="file" class="form-control" id="${id}" name="upload[${f.key}]" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx">
      </div>`;
    case 'images': {
      const list = asArray(v);
      return html`<div class="images-field">
        <div class="row g-2 mb-2">${list.map((p, i) => html`<div class="col-6 col-md-3"><div class="border rounded p-1 bg-white">
          <img src="${img(p.url, 300, 200, 'fill')}" class="w-100 rounded" style="height:110px;object-fit:cover" alt="">
          <input type="hidden" name="${name}[${i}][url]" value="${p.url}">
          <input type="text" class="form-control form-control-sm mt-1" name="${name}[${i}][caption]" value="${p.caption || ''}" placeholder="Caption">
          <label class="small"><input type="checkbox" class="form-check-input me-1" name="${name}[${i}][remove]" value="1"> Remove</label>
        </div></div>`)}</div>
        <input type="file" class="form-control" name="upload[${f.key}][]" multiple accept="image/jpeg,image/png,image/webp,image/gif">
        <div class="form-text">You can select many photos at once. Large photos are resized automatically.</div></div>`;
    }
    case 'list':
      return html`<textarea class="form-control" id="${id}" name="${name}" rows="5" placeholder="One item per line">${asArray(v).join('\n')}</textarea><div class="form-text">One item per line.</div>`;
    case 'cards':
    case 'links': {
      const list = asArray(v);
      const cols = f.type === 'links' ? [['label', 'Label'], ['url', 'Link address'], ['icon', 'Icon (optional)']] : [['icon', 'Icon (optional)'], ['title', 'Title'], ['text', 'Text']];
      const row = (item, i) => html`<div class="repeat-row row g-2 align-items-start mb-2">
        ${cols.map(([k, l]) => html`<div class="${k === 'text' ? 'col-md-5' : k === 'icon' ? 'col-md-2' : 'col-md-4'}">${k === 'text'
          ? html`<textarea class="form-control form-control-sm" rows="2" name="${name}[${i}][${k}]" placeholder="${l}">${(item && item[k]) || ''}</textarea>`
          : html`<input class="form-control form-control-sm" name="${name}[${i}][${k}]" value="${(item && item[k]) || ''}" placeholder="${l}">`}</div>`)}
        <div class="col-md-1 d-flex gap-1"><button type="button" class="btn btn-sm btn-light" data-move="up" title="Move up">&uarr;</button><button type="button" class="btn btn-sm btn-light text-danger" data-remove title="Remove">&times;</button></div>
      </div>`;
      return html`<div class="repeater" data-name="${name}">
        <div class="repeat-list">${list.map(row)}</div>
        <template>${row({}, '__i__')}</template>
        <button type="button" class="btn btn-sm btn-outline-success" data-add>+ Add item</button>
        ${f.type === 'cards' ? html`<div class="form-text">Icons are Font Awesome names such as <code>fas fa-gavel</code> (browse at fontawesome.com).</div>` : ''}
      </div>`;
    }
    case 'section': {
      const list = (ctx.sections || []).filter((s) => !f.layout || s.layout === f.layout);
      return html`<select class="form-select" id="${id}" name="${name}"><option value="">(choose a section)</option>${list.map((s) => html`<option value="${s.slug}"${sel(s.slug, v)}>${s.name}</option>`)}</select>`;
    }
    case 'reference': {
      const items = (ctx.refOptions && ctx.refOptions[f.key]) || [];
      return html`<select class="form-select" id="${id}" name="${name}"${req}><option value="">(none)</option>${items.map((o) => html`<option value="${o._id}"${sel(o._id, v)}>${o.title}</option>`)}</select>`;
    }
    default:
      return html`<input type="text" class="form-control" id="${id}" name="${name}" value="${v}"${req}>`;
  }
}

// ---------- reading the submitted form ----------
async function parse(f, body, files, previous) {
  const data = (body.data || {});
  const raw0 = data[f.key];
  const removing = body.remove && body.remove[f.key];
  const upload = files.upload && files.upload[f.key];
  switch (f.type) {
    case 'richtext': return sanitizeHtml(str(raw0));
    case 'number': { const s = str(raw0); return s === '' ? '' : Number(s); }
    case 'toggle': return asArray(raw0).concat(raw0).includes('1');
    case 'date': { const s = str(raw0); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
    case 'email': return str(raw0).slice(0, 200);
    case 'url': { const s = str(raw0); return s ? safeUrl(/^www\./i.test(s) ? 'https://' + s : s) : ''; }
    case 'select': { const s = str(raw0); return options(f).includes(s) ? s : ''; }
    case 'image':
    case 'file': {
      if (upload && !Array.isArray(upload)) return saveUpload(upload, f.type === 'image' ? 'image' : 'file');
      if (removing) return '';
      return str(raw0) || (previous ?? '');
    }
    case 'images': {
      const kept = asArray(raw0).filter((p) => p && p.url && !p.remove).map((p) => ({ url: str(p.url), caption: str(p.caption).slice(0, 300) }));
      const ups = Array.isArray(upload) ? upload : upload ? [upload] : [];
      for (const u of ups) kept.push({ url: await saveUpload(u, 'image'), caption: '' });
      return kept;
    }
    case 'list': return str(raw0).split('\n').map((s) => s.trim()).filter(Boolean);
    case 'cards': return asArray(raw0).map((c) => ({ icon: str(c.icon).replace(/[^a-z0-9 -]/gi, ''), title: str(c.title), text: str(c.text) })).filter((c) => c.title || c.text);
    case 'links': return asArray(raw0).map((c) => ({ label: str(c.label), url: safeUrl(str(c.url)), icon: str(c.icon).replace(/[^a-z0-9 -]/gi, '') })).filter((c) => c.label && c.url);
    case 'reference':
    case 'section': return str(raw0).replace(/[^a-z0-9-]/gi, '');
    default: return str(raw0).slice(0, 2000);
  }
}

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && !v.length);
}

// ---------- public display ----------
function display(f, v, ctx = {}) {
  if (isEmpty(v)) return '';
  switch (f.type) {
    case 'richtext': return raw(v);
    case 'textarea': return html`${String(v).split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}`;
    case 'date': return formatDate(v);
    case 'email': return html`<a href="mailto:${v}">${v}</a>`;
    case 'url': return html`<a href="${safeUrl(v)}" target="_blank" rel="noopener">${v}</a>`;
    case 'toggle': return v ? 'Yes' : 'No';
    case 'image': return html`<img src="${img(v, 900)}" class="img-fluid rounded shadow-sm" alt="${f.label}">`;
    case 'images': return html`<div class="row g-2">${asArray(v).map((p) => html`<div class="col-6 col-md-4"><img src="${img(p.url, 600, 400, 'fill')}" class="img-fluid rounded" alt="${p.caption || ''}"></div>`)}</div>`;
    case 'file': return html`<a class="btn btn-download-alt btn-sm" href="${safeUrl(v)}" target="_blank" rel="noopener"><i class="fas fa-file-download me-1"></i>Download ${fileLabel(v)}</a>`;
    case 'list': return html`<ul class="mb-0">${asArray(v).map((x) => html`<li>${x}</li>`)}</ul>`;
    case 'cards': return html`<div class="row g-3">${asArray(v).map((c) => html`<div class="col-md-4"><div class="p-3 bg-light rounded h-100">${c.icon ? html`<i class="${c.icon} text-success me-2"></i>` : ''}<strong>${c.title}</strong><div class="small text-muted mt-1">${c.text}</div></div></div>`)}</div>`;
    case 'links': return html`${asArray(v).map((l) => html`<a class="btn btn-outline-success btn-sm me-2 mb-2" href="${safeUrl(l.url)}">${l.icon ? html`<i class="${l.icon} me-1"></i>` : ''}${l.label}</a>`)}`;
    case 'reference': return ctx.refs && ctx.refs[v] ? html`<a href="${ctx.refs[v].url}">${ctx.refs[v].title}</a>` : '';
    default: return String(v);
  }
}

function slugify(s, max = 80) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}

module.exports = { TYPES, input, parse, display, isEmpty, options, asArray, formatDate, slugify, esc };
