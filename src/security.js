'use strict';
const crypto = require('crypto');
const config = require('./config');

const CDN = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com';

function securityHeaders(req, res) {
  const isAdmin = req.path.startsWith('/admin');
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${CDN}`,
    `style-src 'self' 'unsafe-inline' ${CDN} https://fonts.googleapis.com`,
    `font-src 'self' data: ${CDN} https://fonts.gstatic.com`,
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "media-src 'self' https://res.cloudinary.com",
    "frame-src https://www.google.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
    `connect-src 'self' ${isAdmin ? CDN : ''}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];
  if (config.isProd) csp.push('upgrade-insecure-requests');
  res.setHeader('Content-Security-Policy', csp.join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (isAdmin) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
}

// Simple fixed window rate limiter kept in memory (one Render instance).
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  if (buckets.size > 50000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return { ok: b.count <= max, retryAfter: Math.ceil((b.reset - now) / 1000) };
}

const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

module.exports = { securityHeaders, rateLimit, token, sha256, safeEqual };
