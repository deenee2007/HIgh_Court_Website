'use strict';
// Gombe State High Court website: entry point
const http = require('http');
const config = require('./src/config');
const db = require('./src/db');
const { App, HttpError } = require('./src/http');
const { securityHeaders } = require('./src/security');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');
const { seed } = require('./src/seed');

async function main() {
  await db.connect();
  console.log(`Database: ${db.kind()}`);
  if (await seed({ log: (m) => console.log('First run: ' + m) })) console.log('First run: website content imported.');

  const app = new App();
  app.use(async (req, res) => securityHeaders(req, res));
  app.static(['/css/', '/js/', '/assets/', '/uploads/', '/fonts/', '/vendor/'], config.publicDir);
  app.use(async (req, res) => { if (await publicRoutes.legacyRedirect(req, res)) return; });
  adminRoutes.register(app);
  publicRoutes.register(app);

  app.notFound = (req, res) => publicRoutes.sendError(req, res, 404);
  app.onError = (err, req, res) => {
    const status = err instanceof HttpError ? err.status : err && err.status === 413 ? 413 : 500;
    if (status >= 500) console.error(new Date().toISOString(), req.method, req.path, err);
    if (res.headersSent) return res.end();
    if (req.path.startsWith('/admin') && status !== 404) {
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const msg = status >= 500 ? 'Something went wrong on the server. Please go back and try again. If it keeps happening, tell the ICT team the time it occurred.' : err.message;
      return res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Problem</title><link href="/css/admin.css" rel="stylesheet"></head><body class="login-body"><div class="login-card" style="background:#fff;padding:2rem;border-radius:12px"><h1 style="font-size:1.3rem">There was a problem</h1><p>${String(msg).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))}</p><p>Use your browser\'s back button, or <a href="/admin">open the dashboard</a>.</p></div></body></html>`);
    }
    return publicRoutes.sendError(req, res, status === 404 ? 404 : status, status === 413 || status === 400 ? err.message : '');
  };

  const server = http.createServer((req, res) => app.handle(req, res));
  server.headersTimeout = 65000;
  server.requestTimeout = 10 * 60 * 1000; // large uploads on slow connections
  server.keepAliveTimeout = 61000;
  server.listen(config.port, () => console.log(`Website running on port ${config.port}`));

  const shutdown = async () => { server.close(); await db.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('The website could not start:', err.message);
  process.exit(1);
});
