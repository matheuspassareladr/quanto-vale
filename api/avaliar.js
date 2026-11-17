import { admin, usuarioDoPedido, temAcesso, lerImagem, avaliarFoto, json } from './_lib.js';

// Avaliação dentro do app: só pra quem já tem o acesso liberado.
// (O teste grátis agora fica na página de vendas: /api/teste)
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'metodo' });
  const user = await usuarioDoPedido(req);
  if (!user) return json(res, 401, { erro: 'login' });
  if (!(await temAcesso(user.email))) return json(res, 402, { erro: 'pagar' });

  const db = admin();
  const { data: hoje } = await db.from('uso').select('n').eq('user_id', user.id).eq('dia', new Date().toISOString().slice(0, 10)).maybeSingle();
  if ((hoje?.n || 0) >= Number(process.env.LIMITE_DIARIO || 60)) return json(res, 429, { erro: 'limite' });

  const img = lerImagem(req.body?.imagem);
  if (!img) return json(res, 400, { erro: 'imagem' });

  const { status, dado } = await avaliarFoto(img);
  if (status !== 200) return json(res, status, { erro: status === 422 ? 'nao_reconheci' : 'ia' });

  await db.rpc('somar_uso', { p_user: user.id });
  return json(res, 200, { ...dado, pago: true });
}
