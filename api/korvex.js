import { admin, json } from './_lib.js';

// Aviso de pagamento da Korvex (Integrações > Webhooks).
// A Korvex manda { event, token, client: { email }, transaction, ... }.
// O "token" que a Korvex gera fica na variável KORVEX_WEBHOOK_TOKEN da Vercel.
const pega = (o, caminhos) => { for (const c of caminhos) { const v = c.split('.').reduce((a, k) => (a == null ? a : a[k]), o); if (v) return v; } return null; };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 200, { ok: true });
  const corpo = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return { bruto: req.body }; } })() : (req.body || {});
  const esperado = process.env.KORVEX_WEBHOOK_TOKEN;
  const recebido = corpo.token || req.query.token || req.headers['x-webhook-token'];
  const tokenOk = !!esperado && recebido === esperado;
  const db = admin();
  const { token, ...semToken } = corpo;
  await db.from('webhooks_log').insert({ corpo: { tokenOk, ...semToken } });
  if (!tokenOk) return json(res, 401, { erro: 'token' });

  const email = String(pega(corpo, ['client.email', 'customer.email', 'data.client.email', 'data.customer.email', 'buyer.email', 'email']) || '').trim().toLowerCase();
  const evento = String(pega(corpo, ['event', 'type', 'data.event']) || '').toUpperCase();
  if (!email) return json(res, 200, { ok: true, aviso: 'sem email' });

  const pago = evento === 'TRANSACTION_PAID' || /SUBSCRIPTION.*(PAID|RENEW|ACTIVE)/.test(evento);
  const perdeu = /REFUNDED|CHARGED_BACK|CHARGEBACK/.test(evento) || /SUBSCRIPTION.*(CANCEL|EXPIRED|OVERDUE)/.test(evento);
  if (!pago && !perdeu) return json(res, 200, { ok: true, aviso: 'evento ignorado', evento });

  const agora = Date.now();
  let registro;
  if (pago) {
    const { data: atual } = await db.from('acessos').select('expira_em, status').eq('email', email).maybeSingle();
    const base = atual?.status === 'ativo' && atual.expira_em ? Math.max(agora, new Date(atual.expira_em).getTime()) : agora;
    const dias = Number(process.env.DIAS_POR_PAGAMENTO || 30);
    registro = { email, status: 'ativo', plano: '30 dias', expira_em: new Date(base + dias * 864e5).toISOString(), atualizado_em: new Date().toISOString(), origem: { evento } };
  } else {
    registro = { email, status: 'inativo', atualizado_em: new Date().toISOString(), origem: { evento } };
  }
  const { error } = await db.from('acessos').upsert(registro, { onConflict: 'email' });
  if (error) { console.error(error); return json(res, 500, { erro: 'db' }); }
  return json(res, 200, { ok: true, email, status: registro.status });
}
