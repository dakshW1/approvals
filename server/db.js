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
});

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

export async function dropAll() {
  await pool.query(`
    DROP TABLE IF EXISTS notifications, audit_log, status_history, documents, applications, profiles, institutions CASCADE;
  `);
}
