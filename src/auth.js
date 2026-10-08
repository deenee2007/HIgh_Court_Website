'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { col } = require('./db');
const config = require('./config');
const { token, sha256 } = require('./security');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw).normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) {
    // still spend time so attackers cannot tell unknown accounts apart
    await scrypt('x', 'salt', 64, SCRYPT);
    return false;
  }
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(pw).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, expected);
}

function passwordProblem(pw, user = {}) {
  const s = String(pw || '');
  if (s.length < 10) return 'The password must be at least 10 characters long.';
  if (s.length > 200) return 'The password is too long.';
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) return 'Use a mix of letters and numbers.';
  const lower = s.toLowerCase();
  if (user.email && lower === String(user.email).toLowerCase()) return 'The password must not be your email address.';
  if (/^(password|admin|gombe|highcourt|court|welcome|qwerty|abc)[0-9!@#]*$/.test(lower) || /^(\d)\1+$|^(0123456789|1234567890)/.test(lower)) return 'This password is too easy to guess. Choose something less common.';
  return '';
}

// ---------- sessions ----------
const COOKIE = config.isProd ? '__Host-gsc_sid' : 'gsc_sid';
const IDLE_MS = 60 * 60 * 1000; // sign out after 1 hour without activity

async function createSession(res, user, req) {
  const t = token(32);
  const now = new Date();
  await col('sessions').insertOne({
    _id: sha256(t), userId: user._id, csrf: token(24), createdAt: now, lastSeen: now,
    expiresAt: new Date(now.getTime() + config.sessionHours * 3600 * 1000),
    ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200),
  });
  res.cookie(COOKIE, t, { httpOnly: true, sameSite: 'Lax', path: '/', secure: config.isProd });
}

async function loadSession(req) {
  const t = req.cookies[COOKIE];
  if (!t || t.length > 100) return null;
  const s = await col('sessions').findOne({ _id: sha256(t) });
  if (!s) return null;
  const now = Date.now();
  if (new Date(s.expiresAt).getTime() < now || new Date(s.lastSeen).getTime() + IDLE_MS < now) {
    await col('sessions').deleteOne({ _id: s._id });
    return null;
  }
  const user = await col('users').findOne({ _id: s.userId });
  if (!user || !user.active) return null;
  if (now - new Date(s.lastSeen).getTime() > 60 * 1000) await col('sessions').updateOne({ _id: s._id }, { $set: { lastSeen: new Date() } });
  req.session = s;
  req.user = user;
  return user;
}

async function destroySession(req, res) {
  if (req.session) await col('sessions').deleteOne({ _id: req.session._id });
  res.clearCookie(COOKIE, { path: '/', secure: config.isProd });
}

async function destroyUserSessions(userId, exceptId) {
  const filter = exceptId ? { userId, _id: { $ne: exceptId } } : { userId };
  await col('sessions').deleteMany(filter);
}

// ---------- permissions ----------
const PERMS = {
  users: 'Manage user accounts',
  structure: 'Manage sections, menu and home page layout',
  settings: 'Edit site settings (contact details, social links)',
  messages: 'Read messages sent through the contact form',
  audit: 'View the activity log',
};
const LEVELS = { none: 'No access', edit: 'Can edit (drafts only)', publish: 'Can edit and publish' };

const isSuper = (u) => Boolean(u && u.role === 'superadmin');
const can = (u, perm) => isSuper(u) || Boolean(u && u.perms && u.perms[perm]);

function sectionLevel(u, slug) {
  if (isSuper(u)) return 'publish';
  const a = (u && u.access) || {};
  const lv = a[slug] && a[slug] !== 'inherit' ? a[slug] : a['*'] || 'none';
  return LEVELS[lv] ? lv : 'none';
}
const canEdit = (u, slug) => sectionLevel(u, slug) !== 'none';
const canPublish = (u, slug) => sectionLevel(u, slug) === 'publish';

module.exports = {
  hashPassword, verifyPassword, passwordProblem, createSession, loadSession, destroySession, destroyUserSessions,
  PERMS, LEVELS, isSuper, can, sectionLevel, canEdit, canPublish,
};
