import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db.js';
import { ensureBucket } from './supabase.js';
import { seedIfEmpty } from './seed.js';
import { router } from './routes.js';
import { runAlerts } from './alerts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await migrate();
await ensureBucket();
await seedIfEmpty();

const app = express();
app.use(express.json());
app.use('/api', router);
app.use('/api', (err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server.' : err.message });
});

// Serve the built frontend in production (`npm run build && npm start`).
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Alert engine: scan deadlines, missing documents and certificate expiry.
const scan = () => runAlerts().catch((err) => console.error('Alert scan failed:', err.message));
scan();
setInterval(scan, 5 * 60 * 1000);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => console.log(`AICTE portal running on http://localhost:${PORT}`));
