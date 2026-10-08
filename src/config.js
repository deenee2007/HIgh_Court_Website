'use strict';
// All configuration comes from environment variables (set them in the Render dashboard).
const path = require('path');

const env = process.env;

function parseCloudinary() {
  // Accepts CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
  // or the three separate variables.
  if (env.CLOUDINARY_URL) {
    const m = env.CLOUDINARY_URL.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
  }
  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    return { cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET };
  }
  return null;
}

const isProd = env.NODE_ENV === 'production';

module.exports = {
  root: path.join(__dirname, '..'),
  publicDir: path.join(__dirname, '..', 'public'),
  port: Number(env.PORT || 3000),
  isProd,
  mongoUri: env.MONGODB_URI || '',
  dbName: env.MONGODB_DB || 'gombe_high_court',
  // Only for local development without MongoDB: keeps data in this JSON file.
  dataFile: env.DATA_FILE || '',
  cloudinary: parseCloudinary(),
  cloudinaryFolder: env.CLOUDINARY_FOLDER || 'gombe-high-court',
  // Render (and most hosts) sit behind a proxy that sets X-Forwarded-For.
  trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === '1' : Boolean(env.RENDER),
  siteUrl: (env.SITE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
  setupToken: env.SETUP_TOKEN || '',
  uploadLimitMb: Number(env.UPLOAD_LIMIT_MB || 100),
  maxImageMb: Number(env.MAX_IMAGE_MB || 10),
  maxFileMb: Number(env.MAX_FILE_MB || 10),
  sessionHours: Number(env.SESSION_HOURS || 8),
};
