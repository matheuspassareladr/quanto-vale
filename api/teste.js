import { createHash } from 'node:crypto';
import { admin, lerImagem, avaliarFoto, json } from './_lib.js';

// Teste grátis da página de vendas: sem conta, com limite por pessoa (IP) e por dia.
// Os testes ficam registrados em webhooks_log (corpo.origem = 'teste') — dá pra ver quantos testes rolaram.
const POR_IP = () => Number(process.env.TESTES_POR_IP || 2);      // testes por IP por dia
const GLOBAL = () => Number(process.env.TESTES_POR_DIA || 400);   // teto de testes do site inteiro por dia

function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'sem-ip';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'metodo' });
  const img = lerImagem(req.body?.imagem);
  if (!img) return json(res, 400, { erro: 'imagem' });

  const db = admin();
  const ip = createHash('sha256').update('qv:' + ipDe(req) + ':' + (process.env.SUPABASE_URL || '')).digest('hex').slice(0, 24);
  const desde = new Date(); desde.setUTCHours(3, 0, 0, 0); // meia-noite de Brasília
  if (desde > new Date()) desde.setUTCDate(desde.getUTCDate() - 1);

  const base = () => db.from('webhooks_log').select('id', { count: 'exact', head: true }).eq('corpo->>origem', 'teste').eq('corpo->>ok', 'true').gte('recebido_em', desde.toISOString());
  const [{ count: doIp }, { count: total }] = await Promise.all([base().eq('corpo->>ip', ip), base()]);
  if ((doIp || 0) >= POR_IP() || (total || 0) >= GLOBAL()) return json(res, 429, { erro: 'limite' });

  const { status, dado } = await avaliarFoto(img);
  if (status !== 200) return json(res, status, { erro: status === 422 ? 'nao_reconheci' : 'ia' });
  // Só conta o teste que deu certo (foto ruim ou erro não gasta o teste da pessoa)
  await db.from('webhooks_log').insert({ corpo: { origem: 'teste', ip, ok: true, objeto: dado.objeto } });

  // No teste mostra os 3 preços completos; o anúncio vai só como "amostra" (o completo é no app).
  const desc = String(dado.descricao || '');
  return json(res, 200, {
    objeto: dado.objeto, estado: dado.estado, rapido: dado.rapido, justo: dado.justo, maximo: dado.maximo,
    confianca: dado.confianca, motivo: dado.motivo, titulo: dado.titulo,
    amostra: desc.split(/\s+/).slice(0, 9).join(' ')
  });
}
