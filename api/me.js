import { usuarioDoPedido, temAcesso, usoTotal, gratisDe, json } from './_lib.js';

export default async function handler(req, res) {
  const user = await usuarioDoPedido(req);
  if (!user) return json(res, 401, { erro: 'login' });
  const pago = await temAcesso(user.email);
  const gratis = pago ? 0 : await gratisDe(user.id);
  const usadas = await usoTotal(user.id);
  return json(res, 200, { email: user.email, pago, restantesGratis: pago ? null : Math.max(0, gratis - usadas) });
}
