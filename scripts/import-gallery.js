'use strict';
// Uploads a folder of photos to Cloudinary and creates gallery albums.
// Run it on a computer that has the photos, with the same MONGODB_URI and
// CLOUDINARY_URL values as the Render website:
//
//   npm run import-gallery -- "C:\path\to\gallery" --album "Judicial Gallery" --per-album 60
//
// Each sub folder becomes its own album (named after the folder). Photos directly
// inside the folder go into albums named with --album, split into parts of
// --per-album photos. Running it again skips photos that were already uploaded.
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const db = require('../src/db');
const { saveUpload } = require('../src/media');
const { newId, invalidate } = require('../src/content');
const { slugify } = require('../src/fields');

const IMG = /\.(jpe?g|png|webp|gif)$/i;
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : def;
}
const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

async function albumFor(title, sectionSlug) {
  let e = await db.col('entries').findOne({ section: sectionSlug, title });
  if (e) return e;
  let slug = slugify(title) || 'album';
  for (let i = 2; await db.col('entries').findOne({ section: sectionSlug, slug }); i++) slug = `${slugify(title)}-${i}`;
  e = { _id: newId(), section: sectionSlug, slug, title, status: 'published', order: 0, data: { date: new Date().toISOString().slice(0, 10), description: '', images: [] }, legacyPaths: [], createdAt: new Date(), updatedAt: new Date(), publishedAt: new Date(), createdBy: 'gallery import', updatedBy: 'gallery import' };
  await db.col('entries').insertOne(e);
  return e;
}

(async () => {
  const folder = process.argv[2];
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Usage: npm run import-gallery -- "path/to/photos" [--album "Title"] [--per-album 60] [--section gallery]');
  if (!config.cloudinary) throw new Error('Set CLOUDINARY_URL first, otherwise the photos would not be stored online.');
  if (!config.mongoUri) throw new Error('Set MONGODB_URI first (the same value as on Render).');
  const sectionSlug = arg('section', 'gallery');
  const baseTitle = arg('album', 'Judicial Gallery');
  const perAlbum = Math.max(1, parseInt(arg('per-album', '60'), 10));
  await db.connect();
  const section = await db.col('sections').findOne({ slug: sectionSlug });
  if (!section) throw new Error(`There is no section with the address /${sectionSlug}.`);

  const jobs = [];
  const rootFiles = fs.readdirSync(folder).filter((f) => IMG.test(f)).sort(naturalSort);
  const parts = Math.ceil(rootFiles.length / perAlbum);
  for (let p = 0; p < parts; p++) jobs.push({ title: parts > 1 ? `${baseTitle} (part ${p + 1})` : baseTitle, dir: folder, files: rootFiles.slice(p * perAlbum, (p + 1) * perAlbum) });
  for (const sub of fs.readdirSync(folder).filter((f) => fs.statSync(path.join(folder, f)).isDirectory()).sort(naturalSort)) {
    const files = fs.readdirSync(path.join(folder, sub)).filter((f) => IMG.test(f)).sort(naturalSort);
    if (files.length) jobs.push({ title: sub, dir: path.join(folder, sub), files });
  }
  let done = 0;
  let skipped = 0;
  const failed = [];
  const total = jobs.reduce((n, j) => n + j.files.length, 0);
  console.log(`Found ${total} photos in ${jobs.length} album(s).`);
  for (const job of jobs) {
    const album = await albumFor(job.title, sectionSlug);
    const images = (album.data && album.data.images) || [];
    const have = new Set(images.map((i) => i.source).filter(Boolean));
    for (const name of job.files) {
      const key = path.relative(folder, path.join(job.dir, name));
      if (have.has(key)) { skipped++; continue; }
      try {
        const buf = fs.readFileSync(path.join(job.dir, name));
        const file = new File([buf], name, { type: MIME[path.extname(name).toLowerCase()] || 'application/octet-stream' });
        const url = await saveUpload(file, 'image');
        images.push({ url, caption: '', source: key });
        await db.col('entries').updateOne({ _id: album._id }, { $set: { 'data.images': images, updatedAt: new Date() } });
        done++;
        process.stdout.write(`\r${done + skipped}/${total} ${name.slice(0, 40).padEnd(40)}`);
      } catch (e) {
        failed.push(`${key}: ${e.message}`);
      }
    }
  }
  invalidate();
  console.log(`\nUploaded ${done}, already there ${skipped}, failed ${failed.length}.`);
  if (failed.length) console.log('Could not upload:\n  ' + failed.join('\n  '));
  console.log('Add captions and reorder photos in the dashboard under Gallery.');
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
