import { usuarioDoPedido, temAcesso, json } from './_lib.js';

export default async function handler(req, res) {
  const user = await usuarioDoPedido(req);
  if (!user) return json(res, 401, { erro: 'login' });
  return json(res, 200, { email: user.email, pago: await temAcesso(user.email) });
}
