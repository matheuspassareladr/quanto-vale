import { createClient } from '@supabase/supabase-js';

export const admin = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export async function usuarioDoPedido(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function temAcesso(email) {
  if (!email) return false;
  const { data } = await admin().from('acessos').select('status, expira_em').ilike('email', email).maybeSingle();
  if (!data || data.status !== 'ativo') return false;
  if (data.expira_em && new Date(data.expira_em) < new Date()) return false;
  return true;
}

export async function usoTotal(userId) {
  const { data } = await admin().from('uso').select('n').eq('user_id', userId);
  return (data || []).reduce((s, r) => s + (r.n || 0), 0);
}

export function json(res, status, corpo) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}
