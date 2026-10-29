import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill in your Supabase values.');
  process.exit(1);
}

// Supabase Postgres via its pooler (IPv4). Locally the session pooler (port 5432) is fine; on Vercel use the
// transaction pooler (port 6543), and keep few connections per serverless instance.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: process.env.VERCEL ? 2 : 6,
  idleTimeoutMillis: 20_000,
  keepAlive: true,
});
// Supabase's pooler drops idle connections. pg reports that on the pool; without a listener Node would
// crash the whole server. The broken client is discarded and the next query opens a fresh one.
pool.on('error', (err) => console.warn('Database connection dropped, will reconnect:', err.code || err.message));

export const nowIso = () => new Date().toISOString();

// Queries issued inside tx() automatically run on the transaction's client.
const txClient = new AsyncLocalStorage();
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

export async function query(sql, params = []) {
  const client = txClient.getStore() || pool;
  const result = await client.query(toPg(sql), params.map((v) => (v === undefined ? null : v)));
  return result.rows;
}
export const one = async (sql, params) => (await query(sql, params))[0] || null;
export const insert = async (sql, params) => Number((await one(`${sql} RETURNING id`, params)).id);

export async function insertMany(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const params = [];
    const values = chunk.map((r) => {
      params.push(...r);
      return `(${r.map(() => '?').join(',')})`;
    });
    await query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}`, params);
  }
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS institutions (
      id SERIAL PRIMARY KEY,
      aicte_code TEXT UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      city TEXT,
      state TEXT,
      region TEXT,
      established INTEGER
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('COLLEGE','OFFICER','ADMIN')),
      institution_id INTEGER REFERENCES institutions(id),
      designation TEXT,
      region TEXT,
      categories TEXT,
      max_load INTEGER DEFAULT 8,
      active INTEGER DEFAULT 1,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      app_no TEXT UNIQUE NOT NULL,
      institution_id INTEGER NOT NULL REFERENCES institutions(id),
      category TEXT NOT NULL,
      program TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      duration_years INTEGER NOT NULL DEFAULT 4,
      proposed_intake INTEGER NOT NULL,
      faculty_count INTEGER NOT NULL,
      land_area DOUBLE PRECISION NOT NULL,
      built_up_area DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      assigned_officer_id INTEGER REFERENCES profiles(id),
      submitted_at TEXT NOT NULL,
      due_date TEXT NOT NULL,
      decided_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER,
      uploaded_at TEXT NOT NULL,
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      remark TEXT,
      reviewed_by INTEGER REFERENCES profiles(id),
      reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS status_history (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      user_id INTEGER REFERENCES profiles(id),
      remark TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES profiles(id),
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      application_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      application_id INTEGER,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended INTEGER NOT NULL DEFAULT 0;
    -- Drafts have not been submitted yet, so they have no submission date or deadline.
    ALTER TABLE applications ALTER COLUMN submitted_at DROP NOT NULL;
    ALTER TABLE applications ALTER COLUMN due_date DROP NOT NULL;
    -- An officer may approve despite unmet checks, but must record why.
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS override_note TEXT;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS override_checks TEXT;
    -- Admin-editable rules (norms, deadlines, required documents, assignment roles) as one JSON document.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL
    );
    ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
    -- Norms and required documents for one academic year (versioned rules).
    CREATE TABLE IF NOT EXISTS rule_versions (
      academic_year TEXT PRIMARY KEY,
      norms JSONB NOT NULL,
      required_docs JSONB NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL
    );
    ALTER TABLE rule_versions ENABLE ROW LEVEL SECURITY;
    -- Result of the automated document check (text read from the PDF compared with the application).
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS auto_check JSONB;
    -- Site inspections by the expert committee, with geo-tagged photos checked against the campus location.
    ALTER TABLE institutions ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE institutions ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
    CREATE TABLE IF NOT EXISTS inspections (
      id SERIAL PRIMARY KEY,
      application_id INTEGER UNIQUE NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('SCHEDULED','COMPLETED')),
      scheduled_for TEXT NOT NULL,
      committee TEXT,
      findings TEXT,
      recommendation TEXT CHECK (recommendation IN ('SATISFACTORY','DEFICIENT')),
      scheduled_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      completed_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inspection_photos (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      stored_name TEXT NOT NULL,
      caption TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      accuracy_m DOUBLE PRECISION,
      location_source TEXT,
      taken_at TEXT,
      distance_m DOUBLE PRECISION,
      uploaded_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      uploaded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_insp ON inspection_photos(inspection_id);
    ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;
    -- Conversation between the institution and AICTE staff on one application.
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_app ON comments(application_id, created_at);
    ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
    CREATE INDEX IF NOT EXISTS idx_docs_app ON documents(application_id);
    CREATE INDEX IF NOT EXISTS idx_hist_app ON status_history(application_id);
    CREATE INDEX IF NOT EXISTS idx_audit_app ON audit_log(application_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

    -- The browser holds the public anon key, so lock every table. The Express server connects as
    -- the database owner and is unaffected; the browser may only read its own notifications (Realtime).
    ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION public.current_profile_id() RETURNS integer
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT id FROM public.profiles WHERE auth_id = auth.uid() $$;
    DROP POLICY IF EXISTS own_notifications ON notifications;
    CREATE POLICY own_notifications ON notifications FOR SELECT TO authenticated
      USING (user_id = public.current_profile_id());

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
         AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
      END IF;
    END $$;
  `);
}

// Sample institutions get their city's coordinates as the campus location, once.
export async function backfillCampusLocations() {
  const { CITY_COORDS } = await import('./rules.js');
  const rows = Object.entries(CITY_COORDS);
  const params = rows.flatMap(([city, [lat, lng]]) => [city, lat, lng]);
  const values = rows.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}::float8, $${i * 3 + 3}::float8)`).join(', ');
  await pool.query(
    `UPDATE institutions i SET lat = v.lat, lng = v.lng FROM (VALUES ${values}) AS v(city, lat, lng)
     WHERE i.lat IS NULL AND i.city = v.city`,
    params
  );
}

export async function dropAll() {
  await pool.query(`
    DROP TABLE IF EXISTS inspection_photos, inspections, rule_versions, comments, settings, notifications, audit_log, status_history, documents, applications, profiles, institutions CASCADE;
  `);
}
