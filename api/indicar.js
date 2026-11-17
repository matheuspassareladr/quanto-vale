import { admin, usuarioDoPedido, regrasIndicacao, temAcesso, premiaIndicador, json } from './_lib.js';

// GET  → meu código + quantos amigos usaram/compraram
// POST { ref } → registra que esta conta nova chegou pelo link de alguém (vale até 3 dias depois de criar a conta)
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const novoCodigo = () => Array.from({ length: 6 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join('');

async function meuPerfil(db, user) {
  const { data } = await db.from('perfis').select('codigo').eq('user_id', user.id).maybeSingle();
  if (data) return data.codigo;
  for (let i = 0; i < 5; i++) {
    const codigo = novoCodigo();
    const { error } = await db.from('perfis').insert({ user_id: user.id, email: (user.email || '').toLowerCase(), codigo });
    if (!error) return codigo;
    if (error.code !== '23505') throw error; // 23505 = código repetido, tenta outro
    const { data: d2 } = await db.from('perfis').select('codigo').eq('user_id', user.id).maybeSingle();
    if (d2) return d2.codigo;
  }
  throw new Error('codigo');
}

export default async function handler(req, res) {
  const user = await usuarioDoPedido(req);
  if (!user) return json(res, 401, { erro: 'login' });
  const db = admin();

  if (req.method === 'POST') {
    const ref = String(req.body?.ref || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(ref)) return json(res, 200, { ok: false, motivo: 'codigo' });
    const { data: dono } = await db.from('perfis').select('user_id').eq('codigo', ref).maybeSingle();
    if (!dono || dono.user_id === user.id) return json(res, 200, { ok: false, motivo: 'codigo' });
    // Só vale pra conta criada nos últimos 3 dias
    if (Date.now() - new Date(user.created_at).getTime() > 3 * 24 * 3600 * 1000) return json(res, 200, { ok: false, motivo: 'conta_antiga' });
    // Normalmente a pessoa compra ANTES de criar a conta: se já pagou, já conta pra quem indicou.
    const jaPagou = await temAcesso(user.email);
    const { error } = await db.from('indicacoes').insert({ indicado_id: user.id, indicado_email: (user.email || '').toLowerCase(), indicador_id: dono.user_id, usou: true, pagou: jaPagou });
    if (error) return json(res, 200, { ok: false, motivo: error.code === '23505' ? 'ja_indicado' : 'erro' });
    if (jaPagou) { try { await premiaIndicador(db, dono.user_id); } catch (e) { console.error('premia', e); } }
    return json(res, 200, { ok: true });
  }

  try {
    const codigo = await meuPerfil(db, user);
    const { data } = await db.from('indicacoes').select('usou, pagou').eq('indicador_id', user.id);
    const lista = data || [];
    return json(res, 200, {
      codigo,
      cadastraram: lista.length,
      usaram: lista.filter(x => x.usou).length,
      compraram: lista.filter(x => x.pagou).length,
      ...regrasIndicacao()
    });
  } catch (e) {
    console.error('indicar', e);
    return json(res, 500, { erro: 'indicacao' });
  }
}
