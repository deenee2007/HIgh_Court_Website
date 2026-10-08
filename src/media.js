'use strict';
// File uploads: stored on Cloudinary in production, or in public/uploads locally.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { HttpError } = require('./http');

const IMAGE_TYPES = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  gif: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  webp: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};
const DOC_TYPES = {
  pdf: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  docx: (b) => b[0] === 0x50 && b[1] === 0x4b, xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b, pptx: (b) => b[0] === 0x50 && b[1] === 0x4b,
  doc: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0, xls: (b) => b[0] === 0xd0 && b[1] === 0xcf, ppt: (b) => b[0] === 0xd0 && b[1] === 0xcf,
};

function cleanName(name) {
  const base = path.basename(String(name || 'file')).toLowerCase();
  const ext = path.extname(base).replace(/[^a-z0-9.]/g, '');
  const stem = base.slice(0, base.length - path.extname(base).length).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return { stem, ext: ext === '.jpeg' ? '.jpg' : ext };
}

async function detect(file, kind) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const { ext } = cleanName(file.name);
  const e = ext.slice(1);
  if (kind === 'image') {
    const found = Object.keys(IMAGE_TYPES).find((k) => IMAGE_TYPES[k](head));
    if (!found) throw new HttpError(400, `"${file.name}" is not a supported image. Use JPG, PNG, WEBP or GIF.`);
    return found;
  }
  if (IMAGE_TYPES.jpg(head) || IMAGE_TYPES.png(head) || IMAGE_TYPES.webp(head)) return Object.keys(IMAGE_TYPES).find((k) => IMAGE_TYPES[k](head));
  if (DOC_TYPES[e] && DOC_TYPES[e](head)) return e;
  throw new HttpError(400, `"${file.name}" is not an allowed document. Use PDF, Word, Excel or PowerPoint files.`);
}

function sign(params, secret) {
  const str = Object.keys(params).filter((k) => params[k] !== '' && params[k] != null).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(str + secret).digest('hex');
}

async function uploadToCloudinary(file, kind, ext, stem) {
  const c = config.cloudinary;
  const resource = kind === 'image' || ['jpg', 'png', 'webp', 'gif'].includes(ext) ? 'image' : 'raw';
  const params = {
    folder: `${config.cloudinaryFolder}/${kind === 'image' ? 'images' : 'files'}`,
    timestamp: Math.floor(Date.now() / 1000),
    use_filename: 'true',
    unique_filename: 'true',
  };
  if (resource === 'image') params.transformation = 'c_limit,w_2400,h_2400';
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append('api_key', c.apiKey);
  form.append('signature', sign(params, c.apiSecret));
  form.append('file', file, `${stem}.${ext}`);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloudName)}/${resource}/upload`, { method: 'POST', body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.secure_url) {
    console.error('Cloudinary upload failed', r.status, data && data.error);
    throw new HttpError(502, 'The file could not be uploaded to storage. ' + ((data.error && data.error.message) || ''));
  }
  return data.secure_url;
}

async function saveLocal(file, ext, stem) {
  const d = new Date();
  const dir = path.join(config.publicDir, 'uploads', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const name = `${stem}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return '/' + path.relative(config.publicDir, path.join(dir, name)).split(path.sep).join('/');
}

async function saveUpload(file, kind = 'file') {
  if (!file || !file.size) return '';
  const limitMb = kind === 'image' ? config.maxImageMb : config.maxFileMb;
  if (file.size > limitMb * 1024 * 1024) throw new HttpError(413, `"${file.name}" is larger than ${limitMb} MB. Please reduce its size and try again.`);
  const ext = await detect(file, kind);
  const { stem } = cleanName(file.name);
  if (config.cloudinary) return uploadToCloudinary(file, kind, ext, stem);
  return saveLocal(file, ext, stem);
}

// Returns an image address resized for display (Cloudinary only; local files are returned unchanged)
function img(url, w, h, crop = 'limit') {
  if (!url) return '';
  if (!/res\.cloudinary\.com\/.+\/image\/upload\//.test(url)) return url;
  const t = ['f_auto', 'q_auto', `c_${crop}`];
  if (w) t.push(`w_${w}`);
  if (h) t.push(`h_${h}`);
  if (crop === 'fill') t.push('g_auto');
  return url.replace('/image/upload/', `/image/upload/${t.join(',')}/`);
}

function fileLabel(url) {
  const base = decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || '');
  const ext = path.extname(base).slice(1).toUpperCase();
  return ext || 'FILE';
}

module.exports = { saveUpload, img, fileLabel, sign };
