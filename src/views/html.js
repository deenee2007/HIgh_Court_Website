'use strict';
// Tiny HTML templating: every value placed in html`...` is escaped automatically
// unless it was produced by html`` itself or wrapped with raw().

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const raw = (s) => new Raw(s == null ? '' : String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ESC[c]);

function render(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

// Helpers for attributes
const attr = (cond, name, value = '') => (cond ? raw(` ${name}${value !== '' ? `="${esc(value)}"` : ''}`) : '');
const sel = (a, b) => (String(a) === String(b) ? raw(' selected') : '');
const chk = (c) => (c ? raw(' checked') : '');

// Safe URL for href/src values coming from content
function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '#';
  return s;
}

module.exports = { html, raw, esc, render, attr, sel, chk, safeUrl, Raw };
