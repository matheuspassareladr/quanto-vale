import { admin, json } from './_lib.js';

// Aviso de pagamento da Korvex. URL: https://SEU-SITE/api/korvex?token=KORVEX_WEBHOOK_TOKEN
const pega = (o, caminhos) => { for (const c of caminhos) { const v = c.split('.').reduce((a, k) => (a == null ? a : a[k]), o); if (v) return v; } return null; };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 200, { ok: true });
  const tokenOk = process.env.KORVEX_WEBHOOK_TOKEN && (req.query.token === process.env.KORVEX_WEBHOOK_TOKEN);
  const corpo = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return { bruto: req.body }; } })() : (req.body || {});
  const db = admin();
  await db.from('webhooks_log').insert({ corpo: { tokenOk, ...corpo } });
  if (!tokenOk) return json(res, 401, { erro: 'token' });

  const email = String(pega(corpo, ['customer.email', 'data.customer.email', 'buyer.email', 'data.buyer.email', 'client.email', 'data.client.email', 'email', 'data.email', 'order.customer.email', 'data.order.customer.email']) || '').trim().toLowerCase();
  const evento = String(pega(corpo, ['event', 'type', 'data.event', 'status', 'data.status', 'order.status', 'data.order.status', 'payment.status', 'data.payment.status']) || '').toLowerCase();
  if (!email) return json(res, 200, { ok: true, aviso: 'sem email' });

  const pago = /(approved|aprovad|paid|pago|complete|success|active|ativ|renew|renova)/.test(evento);
  const cancelou = /(refund|reembols|chargeback|estorn|cancel|expired|expir|refused|recusad|failed|falh|overdue|atras|inactive)/.test(evento);
  if (!pago && !cancelou) return json(res, 200, { ok: true, aviso: 'evento ignorado', evento });

  const dias = Number(process.env.DIAS_POR_PAGAMENTO || 35);
  const registro = pago
    ? { email, status: 'ativo', plano: 'mensal', expira_em: new Date(Date.now() + dias * 864e5).toISOString(), atualizado_em: new Date().toISOString(), origem: { evento } }
    : { email, status: 'inativo', atualizado_em: new Date().toISOString(), origem: { evento } };
  const { error } = await db.from('acessos').upsert(registro, { onConflict: 'email' });
  if (error) { console.error(error); return json(res, 500, { erro: 'db' }); }
  return json(res, 200, { ok: true, email, status: registro.status });
}
