// Demo site inspections with generated "site photos". All records are fictional sample data.
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { pool, query, one, insert, nowIso } from './db.js';
import { putFile } from './supabase.js';
import { distanceMetres } from './rules.js';

const DAY = 86400000;

// A small PNG of a stylised campus building, so seeded inspection photos are real images.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

export function sitePhoto(variant = 0, w = 640, h = 400) {
  const palettes = [
    { sky: [196, 220, 238], ground: [150, 160, 120], wall: [214, 200, 178], trim: [120, 90, 70] },
    { sky: [230, 214, 190], ground: [160, 140, 110], wall: [200, 205, 210], trim: [70, 90, 110] },
    { sky: [205, 215, 225], ground: [130, 140, 130], wall: [225, 215, 195], trim: [140, 110, 80] },
  ];
  const p = palettes[variant % palettes.length];
  const rows = [];
  const horizon = Math.round(h * 0.68);
  const bx0 = Math.round(w * (0.18 + 0.06 * variant));
  const bx1 = Math.round(w * (0.78 - 0.04 * variant));
  const by0 = Math.round(h * (0.3 + 0.04 * variant));
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      let c;
      if (y < horizon) {
        const t = y / horizon;
        c = p.sky.map((v) => Math.round(v * (1 - 0.18 * t)));
      } else {
        const t = (y - horizon) / (h - horizon);
        c = p.ground.map((v) => Math.round(v * (1 - 0.25 * t)));
      }
      if (x >= bx0 && x < bx1 && y >= by0 && y < horizon) {
        c = p.wall;
        const wx = (x - bx0) % 46;
        const wy = (y - by0) % 38;
        if (y > by0 + 12 && wx > 12 && wx < 34 && wy > 10 && wy < 28) c = [70, 85, 100];
        if (y < by0 + 8) c = p.trim;
      }
      row[1 + x * 3] = c[0];
      row[2 + x * 3] = c[1];
      row[3 + x * 3] = c[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const at = (daysFromNow) => new Date(Date.now() + daysFromNow * DAY).toISOString();

export async function seedInspections() {
  const { n } = await one('SELECT COUNT(*)::int AS n FROM inspections');
  if (n > 0) return false;
  const pick = (sql) => one(`SELECT a.id, a.assigned_officer_id, i.lat, i.lng FROM applications a JOIN institutions i ON i.id = a.institution_id WHERE ${sql}`);
  const vitp = await pick("i.name LIKE 'Vindhya%' AND a.category = 'NEW_INSTITUTION'");
  const svit = await pick("i.name LIKE 'Shri Venkatesh%' AND a.category = 'INCREASE_INTAKE' AND a.status = 'UNDER_REVIEW'");

  if (vitp) {
    const id = await insert(
      `INSERT INTO inspections (application_id, status, scheduled_for, committee, findings, recommendation, scheduled_by, completed_by, completed_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [vitp.id, 'COMPLETED', at(-4), 'Prof. R. K. Mishra (Chair), Dr. S. Nair (AICTE nominee), Er. P. Joshi (State PWD)',
        'Academic block and two laboratories are complete. The land parcel measured on site is 1.8 acres against the 2.5 acres required; the adjacent plot shown as "proposed" is not yet registered. One photo of the hostel block was taken away from the campus and has been disregarded.',
        'DEFICIENT', vitp.assigned_officer_id, vitp.assigned_officer_id, at(-3), at(-6)]
    );
    const shots = [
      ['Academic block, front elevation', vitp.lat + 0.0011, vitp.lng + 0.0007, 'exif', 0],
      ['Computer laboratory wing', vitp.lat - 0.0009, vitp.lng + 0.0012, 'device', 1],
      ['Proposed hostel block (submitted by institution)', vitp.lat + 0.095, vitp.lng + 0.071, 'exif', 2],
    ];
    for (const [caption, lat, lng, source, v] of shots) {
      const key = `inspections/${id}/seed-${v}.png`;
      await putFile(key, sitePhoto(v), 'image/png');
      await query(
        `INSERT INTO inspection_photos (inspection_id, stored_name, caption, lat, lng, accuracy_m, location_source, taken_at, distance_m, uploaded_by, uploaded_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, key, caption, lat, lng, 8, source, at(-4), distanceMetres(lat, lng, vitp.lat, vitp.lng), vitp.assigned_officer_id, at(-4)]
      );
    }
    await query(`INSERT INTO audit_log (user_id, action, entity, entity_id, application_id, details, created_at) VALUES
      (?, 'INSPECTION_SCHEDULED', 'application', ?, ?, 'Site visit scheduled. Committee: Prof. R. K. Mishra (Chair), Dr. S. Nair, Er. P. Joshi', ?),
      (?, 'INSPECTION_COMPLETED', 'application', ?, ?, 'Recommendation: deficient. Land parcel 1.8 acres against 2.5 required.', ?)`,
    [vitp.assigned_officer_id, vitp.id, vitp.id, at(-6), vitp.assigned_officer_id, vitp.id, vitp.id, at(-3)]);
  }
  if (svit) {
    await insert(
      'INSERT INTO inspections (application_id, status, scheduled_for, committee, scheduled_by, created_at) VALUES (?,?,?,?,?,?)',
      [svit.id, 'SCHEDULED', at(3), 'Dr. M. Kulkarni (Chair), Prof. A. Deshpande, Er. V. Patil (PWD)', svit.assigned_officer_id, at(-2)]
    );
    await query(
      "INSERT INTO audit_log (user_id, action, entity, entity_id, application_id, details, created_at) VALUES (?, 'INSPECTION_SCHEDULED', 'application', ?, ?, 'Site visit scheduled in 3 days. Committee: Dr. M. Kulkarni (Chair), Prof. A. Deshpande, Er. V. Patil', ?)",
      [svit.assigned_officer_id, svit.id, svit.id, at(-2)]
    );
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { migrate, backfillCampusLocations } = await import('./db.js');
  await migrate();
  await backfillCampusLocations();
  console.log((await seedInspections()) ? 'Demo inspections added.' : 'Inspections already exist; nothing changed.');
  await pool.end();
}
