import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env (see .env.example).');
  process.exit(1);
}

// Server-only client with the service role (secret) key. Never expose this key to the browser.
export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const BUCKET = 'documents';

export async function ensureBucket() {
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 4 * 1024 * 1024 });
  if (error && !/exist/i.test(error.message)) throw error;
}

export async function putFile(key, buffer, contentType) {
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(key, buffer, { contentType, upsert: true });
  if (error) throw error;
}

export async function removeFile(key) {
  await supabaseAdmin.storage.from(BUCKET).remove([key]);
}

export async function signedUrl(key) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, 120);
  if (error) throw error;
  return data.signedUrl;
}

export async function emptyBucket() {
  for (const prefix of ['seed']) {
    for (;;) {
      const { data } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (!data?.length) break;
      await supabaseAdmin.storage.from(BUCKET).remove(data.map((f) => `${prefix}/${f.name}`));
      if (data.length < 1000) break;
    }
  }
}
