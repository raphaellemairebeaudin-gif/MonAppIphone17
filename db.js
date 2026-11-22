import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

await new Promise((resolve, reject) => {
  if (window.supabase) return resolve();
  const s = document.createElement('script');
  s.src = 'https://jsdelivr.net';
  s.onload = resolve;
  s.onerror = () => reject(new Error('Impossible de charger le SDK Supabase.'));
  document.head.appendChild(s);
});

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let rows = [];
let userId = null;
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());
const cacheKey = () => 'cache:' + userId;
const saveCache = () => { try { localStorage.setItem(cacheKey(), JSON.stringify(rows)); } catch (e) { /* plein ou bloqué */ } };

export async function getSession() {
  try {
    const { data } = await sb.auth.getSession();
    return data.session;
  } catch (e) { return null; }
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await sb.auth.signOut();
  rows = [];
  userId = null;
  emit();
}

export function useUser(uid) {
  userId = uid;
  try { rows = JSON.parse(localStorage.getItem(cacheKey()) || '[]'); } catch (e) { rows = []; }
  emit();
}

export async function refresh() {
  try {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('entries').select('*')
        .order('created_at', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    rows = all;
    saveCache();
    emit();
    return true;
  } catch (e) { return false; }
}

export const all = (kind) => rows.filter((r) => r.kind === kind);
export const get = (id) => rows.find((r) => r.id === id);

export async function add(kind, data) {
  const { data: row, error } = await sb.from('entries').insert({ kind, data }).select().single();
  if (error) throw error;
  rows = [...rows, row];
  saveCache(); emit();
  return row;
}

export async function update(id, data) {
  const { data: row, error } = await sb.from('entries')
    .update({ data, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  rows = rows.map((r) => (r.id === id ? row : r));
  saveCache(); emit();
  return row;
}

export async function remove(id) {
  const { error } = await sb.from('entries').delete().eq('id', id);
  if (error) throw error;
  rows = rows.filter((r) => r.id !== id);
  saveCache(); emit();
}

export function getProfile() {
  const row = rows.find((r) => r.kind === 'profile');
  return { row, data: row ? row.data : {} };
}

export async function saveProfile(patch) {
  const { row, data } = getProfile();
  const next = { ...data, ...patch };
  return row ? update(row.id, next) : add('profile', next);
}

export const exportAll = () => ({
  exporté_le: new Date().toISOString(),
  entrées: rows.map(({ kind, data, created_at, updated_at }) => ({ kind, data, created_at, updated_at })),
});
