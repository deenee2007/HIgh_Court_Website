'use strict';
// First run setup: creates the sections, menu, home page and imports the content
// of the original static website (seed/content.json).
const fs = require('fs');
const path = require('path');
const { col } = require('./db');
const { LAYOUTS, f } = require('./layouts');
const { sanitizeHtml } = require('./sanitize');
const { newId, invalidate } = require('./content');

const clone = (x) => JSON.parse(JSON.stringify(x));
const layoutFields = (layout) => clone(LAYOUTS[layout].fields);

function sectionDefs() {
  return [
    { slug: 'judges', name: 'Honourable Judges', singular: 'Judge', layout: 'profiles', titleLabel: 'Full name', fields: layoutFields('profiles'), perPage: 30,
      intro: 'The Honourable Chief Judge and Judges of the High Court of Justice, Gombe State.' },
    { slug: 'roll-of-honour', name: 'Past Chief Judges', singular: 'Past Chief Judge', layout: 'honours', fields: layoutFields('honours'),
      intro: 'Distinguished jurists who have shaped the Gombe State Judiciary since its inception.' },
    { slug: 'past-chief-registrars', name: 'Past Chief Registrars', singular: 'Past Chief Registrar', layout: 'honours', display: 'portrait', fields: layoutFields('honours') },
    { slug: 'directorates', name: 'Directorates', singular: 'Directorate', layout: 'departments', fields: layoutFields('departments'),
      intro: 'The administrative pillars supporting the judicial process.' },
    { slug: 'news', name: 'News', singular: 'News story', layout: 'articles', fields: layoutFields('articles'), intro: 'Latest news, events and announcements from the Gombe State Judiciary.' },
    { slug: 'judgments', name: 'Judgments Archive', singular: 'Judgment', layout: 'documents', titleLabel: 'Parties', display: 'table', sort: 'date',
      intro: 'Certified Law Reports and Judicial Precedents',
      fields: [
        f('suitNo', 'Suit number', 'text', { showInList: true }),
        f('judge', 'Presiding judge', 'text', { showInList: true }),
        f('date', 'Date delivered', 'date', { showInList: true, filter: true }),
        f('category', 'Type', 'select', { options: ['Civil', 'Criminal', 'Land', 'Probate', 'Family', 'Election'], showInList: true, filter: true }),
        f('file', 'Full text (PDF)', 'file'),
      ] },
    { slug: 'rules', name: 'Court Rules & Directions', singular: 'Document', layout: 'documents', display: 'rows', groupBy: 'category',
      intro: 'Legal Framework and Procedural Guidelines',
      fields: [
        f('category', 'Category', 'select', { options: ['Procedure Rules', 'Practice Directions', 'Legal Notices'] }),
        f('note', 'Note shown under the title', 'text', { help: 'For example: Effective January 2024' }),
        f('date', 'Date', 'date'),
        f('file', 'Document', 'file'),
      ] },
    { slug: 'cause-lists', name: 'Weekly Cause Lists', singular: 'Cause list', layout: 'documents', display: 'rows', groupBy: 'court', titleLabel: 'Court',
      intro: 'Weekly cause lists for the High Court, Magistrate Courts and Appeal sessions.',
      fields: [
        f('court', 'Court group', 'select', { options: ['High Court Division', 'Chief Magistrate and District Courts (Metropolis)', 'Appeal Sessions'] }),
        f('judge', 'Presiding judge or magistrate', 'text', { showInList: true }),
        f('date', 'Week beginning', 'date', { showInList: true }),
        f('file', 'Cause list (PDF)', 'file'),
      ] },
    { slug: 'notices', name: 'Notices', singular: 'Notice', layout: 'notices', titleLabel: 'Short title (for the admin list)', fields: layoutFields('notices'),
      intro: 'Notices of non sitting, adjournments and other announcements.' },
    { slug: 'gallery', name: 'Gallery', singular: 'Album', layout: 'gallery', fields: layoutFields('gallery'),
      intro: 'Exploring the visual history and cultural milestones of the Gombe State Judiciary.' },
    { slug: 'pages', name: 'Pages', singular: 'Page', layout: 'pages', fields: layoutFields('pages') },
  ].map((s, i) => ({ ...s, order: i + 1, system: true }));
}

function quizFix(body) {
  // The Small Claims eligibility quiz used inline scripts; turn it into data attributes handled by site.js
  return body
    .replace(/onclick="quizResult\(true\)"/g, 'data-quiz-answer="yes"')
    .replace(/onclick="quizResult\(false\)"/g, 'data-quiz-answer="no"')
    .replace(/<div id="resultArea"[^>]*><\/div>/, '<div class="mt-4" data-quiz-result="yes" hidden><div class="alert alert-success shadow-sm"><i class="fas fa-check-circle me-2"></i> <strong>Excellent!</strong> You qualify for the Small Claims procedure. Please download <strong>Form SCA 1</strong> below to begin.</div></div><div class="mt-4" data-quiz-result="no" hidden><div class="alert alert-warning shadow-sm"><i class="fas fa-exclamation-triangle me-2"></i> Claims exceeding ₦3M or non monetary disputes must be filed through the <strong>General Civil Registry</strong> of the High Court.</div></div>');
}

async function seed({ force = false, log = console.log } = {}) {
  const existing = await col('sections').countDocuments({});
  if (existing && !force) return false;
  if (force) for (const c of ['sections', 'entries', 'menu', 'home', 'settings', 'revisions']) await col(c).deleteMany({});

  const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'content.json'), 'utf8'));
  const now = new Date();
  const sections = sectionDefs();
  for (const s of sections) await col('sections').insertOne({ _id: newId(), ...s, createdAt: now, updatedAt: now });

  // ----- entries -----
  let n = 0;
  async function add(section, item, i, newestFirst = false) {
    const data = clone(item.data || {});
    for (const k of ['bio', 'overview', 'more', 'body']) if (typeof data[k] === 'string') data[k] = sanitizeHtml(data[k]);
    await col('entries').insertOne({
      _id: newId(), section, slug: item.slug || require('./fields').slugify(item.title) || 'item-' + i,
      title: item.title, status: item.status || 'published', order: item.order ?? i, data,
      legacyPaths: item.legacy || [], createdAt: new Date(now.getTime() + (newestFirst ? -i : i) * 1000), updatedAt: now, publishedAt: now, createdBy: 'import', updatedBy: 'import',
    });
    n++;
  }
  const slugs = new Set();
  const uniq = (sec, item) => { let s = item.slug || require('./fields').slugify(item.title); let k = 2; while (slugs.has(sec + '/' + s)) s = `${item.slug || require('./fields').slugify(item.title)}-${k++}`; slugs.add(sec + '/' + s); return { ...item, slug: s }; };
  for (const [i, it] of content.judges.entries()) await add('judges', uniq('judges', it), i);
  for (const [i, it] of content.pastChiefJudges.entries()) await add('roll-of-honour', uniq('roll-of-honour', { ...it, data: { ...it.data, featured: /substantive/i.test(it.data.group) } }), i);
  for (const [i, it] of content.pastChiefRegistrars.entries()) await add('past-chief-registrars', uniq('past-chief-registrars', it), i);
  for (const [i, it] of content.directorates.entries()) await add('directorates', uniq('directorates', it), i);
  for (const [i, it] of content.news.entries()) await add('news', uniq('news', { ...it, data: { ...it.data, date: now.toISOString().slice(0, 10) } }), i, true);
  for (const [i, it] of content.judgments.entries()) await add('judgments', uniq('judgments', it), i);
  for (const [i, it] of content.rules.entries()) await add('rules', uniq('rules', it), i);
  for (const [i, it] of content.causeLists.entries()) await add('cause-lists', uniq('cause-lists', it), i);
  for (const [i, it] of content.notices.entries()) await add('notices', uniq('notices', it), i, true);
  for (const [i, it] of content.pages.entries()) {
    const body = it.slug === 'small-claims' ? quizFix(it.data.body) : it.data.body;
    await add('pages', uniq('pages', { ...it, data: { ...it.data, body } }), i);
  }

  // ----- menu -----
  const menu = [];
  const item = (label, url, parent = null, extra = {}) => { const m = { _id: newId(), label, url, parent, order: menu.filter((x) => x.parent === parent).length + 1, visible: true, ...extra }; menu.push(m); return m._id; };
  item('Home', '/');
  const court = item('The Court', '#');
  item('About Us', '/about', court);
  item('Honourable Judges', '/judges', court, { section: 'judges' });
  item('Past Chief Judges', '/roll-of-honour', court, { section: 'roll-of-honour' });
  item('Past Chief Registrars', '/past-chief-registrars', court, { section: 'past-chief-registrars' });
  item('Gallery', '/gallery', court, { section: 'gallery' });
  item('Directorates', '/directorates', null, { section: 'directorates', autoSection: 'directorates' });
  const res = item('Resources', '#');
  item('Weekly Cause List', '/cause-lists', res, { section: 'cause-lists' });
  item('Judgments Archive', '/judgments', res, { section: 'judgments' });
  item('Court Rules', '/rules', res, { section: 'rules' });
  item('Small Claims Court', '/small-claims', res);
  item('e-Filing', '/e-filing', res);
  item('News', '/news', null, { section: 'news' });
  item('Contact', '/#contact');
  await col('menu').insertMany(menu);

  // ----- settings -----
  const s = content.settings;
  await col('settings').updateOne({ _id: 'site' }, { $set: {
    footerAbout: s.footerAbout, address: s.contact.address, phone: s.contact.phone, email: s.contact.email,
    facebook: s.socials.facebook, twitter: s.socials.twitter, youtube: s.socials.youtube,
    ctaUrl: s.eAffidavit, mapEmbed: s.map,
  } }, { upsert: true });

  // ----- home page -----
  const b = (type, data, extra = {}) => ({ id: newId(), type, visible: true, data, ...extra });
  const blocks = [
    b('hero', { kicker: s.hero.kicker, title: s.hero.title, motto: s.hero.motto, background: '/assets/img/logos/complex.jpg', buttons: [
      { label: 'Weekly Cause List', url: '/cause-lists', icon: 'fas fa-list-ol' },
      { label: 'Small Claims Court', url: '/small-claims', icon: 'fas fa-balance-scale-left' },
      { label: 'Explore Directorates', url: '/#directorates', icon: 'fas fa-compass' },
      { label: 'e-Filing (Soon)', url: '/e-filing', icon: 'fas fa-laptop' },
    ] }),
    b('notices', { section: 'notices' }),
    b('message', { photo: s.cj.img, heading: 'Message from the Honourable Chief Judge', quote: s.cj.quote, body: s.cj.paras.map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('\n'), name: s.cj.name, title: s.cj.title }),
    b('feature', { heading: s.about.title, text: `<p>${s.about.text}</p>`, image: s.about.img, buttonLabel: 'Read more', buttonUrl: '/about' }, { anchor: 'about' }),
    b('promo', { heading: s.scc.title, lead: sanitizeHtml(s.scc.lead), bullets: s.scc.bullets, image: '/assets/img/logos/scc.jpg', buttonLabel: 'Learn How to File', buttonUrl: '/small-claims' }),
    b('section', { section: 'judges', heading: 'The Honourable Judges', limit: 0 }),
    b('section', { section: 'roll-of-honour', kicker: 'Heritage', heading: 'Roll of Honour', intro: s.intros.honours, limit: 0 }),
    b('section', { section: 'past-chief-registrars', heading: 'Past Chief Registrars', limit: 0 }),
    b('section', { section: 'gallery', kicker: 'Visual Journey', heading: 'Judicial Gallery', intro: s.intros.gallery, limit: 3, buttonLabel: 'View Full Gallery' }),
    b('section', { section: 'directorates', heading: 'Our Directorates', intro: s.intros.directorates, limit: 0 }),
    b('section', { section: 'news', heading: 'Latest Judiciary News', limit: 3, buttonLabel: 'All news' }),
    b('contact', { heading: 'Contact Us', intro: 'Get in touch with the Gombe State High Court', showForm: true, showMap: true }),
  ];
  await col('home').updateOne({ _id: 'home' }, { $set: { blocks } }, { upsert: true });
  invalidate();
  log(`Imported ${n} items into ${sections.length} sections.`);
  return true;
}

module.exports = { seed, sectionDefs };
