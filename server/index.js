// Local / long-running server. On Vercel, api/index.js exports the same app as a serverless function.
import app, { init, scanAlerts } from './app.js';

await init();
scanAlerts();
setInterval(scanAlerts, 5 * 60 * 1000);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => console.log(`AICTE portal running on http://localhost:${PORT}`));
