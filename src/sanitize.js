'use strict';
// Cleans rich text written in the admin editor before it is stored, so that
// a compromised or careless account cannot plant scripts on the public site.

const DROP_WITH_CONTENT = new Set(['script', 'style', 'svg', 'math', 'template', 'noscript', 'textarea', 'select', 'title', 'head', 'xmp', 'plaintext']);
const DROP_TAG = new Set(['object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'frame', 'frameset', 'applet', 'html', 'body', 'option', 'param']);
const VOID = new Set(['br', 'hr', 'img', 'wbr', 'col', 'source', 'track', 'area']);
const ALLOWED_IFRAME_HOSTS = [/^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//i, /^https:\/\/www\.google\.com\/maps\/embed/i, /^https:\/\/player\.vimeo\.com\/video\//i];

const GLOBAL_ATTRS = new Set(['class', 'id', 'style', 'title', 'align', 'role', 'lang', 'dir', 'tabindex', 'hidden']);
const TAG_ATTRS = {
  a: ['href', 'target', 'rel', 'download'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  iframe: ['src', 'width', 'height', 'allowfullscreen', 'frameborder', 'loading', 'allow'],
  td: ['colspan', 'rowspan', 'valign'], th: ['colspan', 'rowspan', 'scope', 'valign'],
  ol: ['start', 'type'], li: ['value'], col: ['span'], colgroup: ['span'], table: ['border', 'cellpadding', 'cellspacing', 'width'],
  button: ['type'], video: ['src', 'controls', 'poster', 'width', 'height'], source: ['src', 'type'], audio: ['src', 'controls'],
};

function cleanUrl(v, tag, name) {
  const s = v.trim().replace(/[\u0000-\u001F\u007F\s]+/g, (m) => (m === ' ' ? ' ' : ''));
  if (/^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/|\?)/i.test(s)) return s;
  if (tag === 'img' && name === 'src' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // javascript:, vbscript:, data: and friends
  return s;
}

function cleanStyle(v) {
  if (/expression\s*\(|javascript:|vbscript:|behaviou?r\s*:|-moz-binding|@import/i.test(v)) return null;
  return v.replace(/url\(\s*(['"]?)(?!https?:|\/)[^)]*\)/gi, '');
}

const escAttr = (s) => s.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cleanAttrs(tag, attrStr) {
  const out = [];
  const re = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  const allowed = new Set(TAG_ATTRS[tag] || []);
  while ((m = re.exec(attrStr))) {
    const name = m[1].toLowerCase();
    let val = m[2] ?? m[3] ?? m[4];
    if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'xmlns') continue;
    const ok = GLOBAL_ATTRS.has(name) || allowed.has(name) || /^data-[a-z0-9-]+$/.test(name) || /^aria-[a-z-]+$/.test(name);
    if (!ok) continue;
    if (val === undefined) { out.push(name); continue; }
    val = val.replace(/&#(x?)([0-9a-f]+);?/gi, (mm, x, n) => { const c = parseInt(n, x ? 16 : 10); return c < 32 ? '' : mm; });
    if (name === 'href' || name === 'src' || name === 'poster') {
      val = cleanUrl(val, tag, name);
      if (val == null) continue;
      if (tag === 'iframe' && name === 'src' && !ALLOWED_IFRAME_HOSTS.some((r) => r.test(val))) return null;
    }
    if (name === 'style') { val = cleanStyle(val); if (val == null) continue; }
    if (name === 'target' && val !== '_blank') continue;
    if (tag === 'button' && name === 'type') val = 'button';
    out.push(`${name}="${escAttr(val)}"`);
  }
  if (tag === 'a' && out.some((a) => a === 'target="_blank"') && !out.some((a) => a.startsWith('rel='))) out.push('rel="noopener noreferrer"');
  if (tag === 'iframe' && !out.some((a) => a.startsWith('src='))) return null;
  return out;
}

function sanitizeHtml(input) {
  const src = String(input || '');
  const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<|[^<]+/gi;
  let out = '';
  let m;
  while ((m = re.exec(src))) {
    const token = m[0];
    if (token.startsWith('<!')) continue;
    if (token === '<') { out += '&lt;'; continue; }
    if (!m[1]) { out += token.replace(/>/g, '&gt;'); continue; }
    const tag = m[1].toLowerCase();
    const closing = token.startsWith('</');
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing) {
        const end = new RegExp(`</${tag}\\s*>`, 'i');
        const rest = src.slice(re.lastIndex);
        const e = end.exec(rest);
        re.lastIndex += e ? e.index + e[0].length : rest.length;
      }
      continue;
    }
    if (DROP_TAG.has(tag)) continue;
    if (closing) { if (!VOID.has(tag)) out += `</${tag}>`; continue; }
    const attrs = cleanAttrs(tag, m[2] || '');
    if (attrs == null) {
      if (tag === 'iframe') { const e = /<\/iframe\s*>/i.exec(src.slice(re.lastIndex)); if (e) re.lastIndex += e.index + e[0].length; }
      continue;
    }
    out += `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${VOID.has(tag) ? '' : ''}>`;
  }
  return out;
}

// Plain text helper: strips all tags (used for summaries and meta descriptions)
function stripTags(s) {
  return String(s || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

module.exports = { sanitizeHtml, stripTags };
