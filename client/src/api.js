import { supabase } from './supabase.js';

let token = null;
export const setToken = (t) => {
  token = t;
};

async function currentToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  token = data.session?.access_token ?? null;
  return token;
}

export async function api(path, { method = 'GET', body, form, auth = true } = {}) {
  const headers = {};
  if (auth) {
    const t = await currentToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && auth) window.dispatchEvent(new Event('auth:logout'));
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// For links opened directly by the browser (documents, CSV reports).
export const fileUrl = (path) => `/api${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`;
