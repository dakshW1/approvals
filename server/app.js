import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, backfillCampusLocations } from './db.js';
import { ensureBucket } from './supabase.js';
import { seedIfEmpty } from './seed.js';
import { router } from './routes.js';
import { runAlerts } from './alerts.js';
import { ensureFreshRules } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// One-time setup per server instance (a long-running process locally, a cold start on Vercel).
let ready;
export const init = () => (ready ||= (async () => {
  await migrate();
  await backfillCampusLocations();
  await ensureBucket();
  await seedIfEmpty();
})().catch((err) => {
  ready = null;
  throw err;
}));

// Time-based alerts (overdue, expiring certificates) are rescanned at most every 5 minutes, piggybacking on
// normal traffic, so they stay current on serverless hosts without a background timer.
let lastScan = 0;
export function scanAlerts() {
  lastScan = Date.now();
  return runAlerts().catch((err) => console.error('Alert scan failed:', err.message));
}

const app = express();
app.use(express.json());
app.use('/api', (req, res, next) => init().then(() => ensureFreshRules()).then(() => next(), next));
app.use('/api', (req, res, next) => {
  if (Date.now() - lastScan > 5 * 60 * 1000) scanAlerts();
  next();
});

// Vercel Cron calls this daily as a backstop; protected by CRON_SECRET when set.
app.get('/api/cron/alerts', async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });
  await scanAlerts();
  res.json({ ok: true });
});

app.use('/api', router);
app.use('/api', (err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status === 500) console.error(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be smaller than the upload limit (4 MB).' : err.message;
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server.' : message });
});

// Locally, Express also serves the built frontend. On Vercel the CDN serves dist/ instead.
const dist = path.join(__dirname, '..', 'dist');
if (!process.env.VERCEL && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

export default app;
