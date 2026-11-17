import { admin, temAcesso, regrasIndicacao, json } from './_lib.js';

// Aviso de venda da Perfect Pay (Ferramentas > Webhook - Vendas, formato PerfectPay).
// Validação: o campo "token" do corpo tem que ser igual ao PERFECTPAY_TOKEN (Public token da Perfect).
// sale_status_enum: 2 = aprovado (libera vitalício) · 7 = devolvido · 9 = chargeback (corta).
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 200, { ok: true });
  const corpo = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const esperado = process.env.PERFECTPAY_TOKEN;
  const tokenOk = !!esperado && corpo.token === esperado;
  const produtoOk = !process.env.PERFECTPAY_PRODUTO || corpo.product?.code === process.env.PERFECTPAY_PRODUTO;
  const db = admin();
  const { token, customer, ...resto } = corpo;
  await db.from('webhooks_log').insert({ corpo: { origem: 'perfectpay', tokenOk, produtoOk, email: customer?.email || null, status: corpo.sale_status_enum, code: corpo.code, produto: corpo.product?.code } });
  if (!tokenOk) return json(res, 401, { erro: 'token' });
  if (!produtoOk) return json(res, 200, { ok: true, aviso: 'outro produto' });

  const email = String(customer?.email || '').trim().toLowerCase();
  const status = Number(corpo.sale_status_enum);
  if (!email) return json(res, 200, { ok: true, aviso: 'sem email' });

  let registro = null;
  if (status === 2) registro = { email, status: 'ativo', plano: 'vitalicio', expira_em: null, atualizado_em: new Date().toISOString(), origem: { gateway: 'perfectpay', venda: corpo.code, status } };
  else if (status === 7 || status === 9) registro = { email, status: 'inativo', atualizado_em: new Date().toISOString(), origem: { gateway: 'perfectpay', venda: corpo.code, status } };
  if (!registro) return json(res, 200, { ok: true, aviso: 'status ignorado', status });

  const { error } = await db.from('acessos').upsert(registro, { onConflict: 'email' });
  if (error) { console.error(error); return json(res, 500, { erro: 'db' }); }
  try { await premiaIndicacao(db, email, status === 2); } catch (e) { console.error('indicacao', e); }
  return json(res, 200, { ok: true, email, status: registro.status });
}

// Amigo indicado comprou: marca e, se quem indicou bateu a meta, libera o vitalício dele de graça.
async function premiaIndicacao(db, email, aprovado) {
  const { data: ind } = await db.from('indicacoes').update({ pagou: aprovado }).eq('indicado_email', email).select('indicador_id').maybeSingle();
  if (!ind || !aprovado) return;
  const { count } = await db.from('indicacoes').select('indicado_id', { count: 'exact', head: true }).eq('indicador_id', ind.indicador_id).eq('pagou', true);
  if ((count || 0) < regrasIndicacao().metaVitalicio) return;
  const { data: perfil } = await db.from('perfis').select('email').eq('user_id', ind.indicador_id).maybeSingle();
  if (!perfil?.email || await temAcesso(perfil.email)) return;
  await db.from('acessos').upsert({ email: perfil.email, status: 'ativo', plano: 'vitalicio', expira_em: null, atualizado_em: new Date().toISOString(), origem: { gateway: 'indicacao', amigos: count } }, { onConflict: 'email' });
}
