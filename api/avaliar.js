import { admin, usuarioDoPedido, temAcesso, usoTotal, json } from './_lib.js';


const PROMPT = `Você é um avaliador experiente de produtos USADOS no Brasil (OLX, Mercado Livre usados, Facebook Marketplace, Enjoei).
Olhe a foto, identifique o objeto (marca, modelo e versão se der) e o estado aparente.
Estime o preço de revenda de USADO no Brasil hoje, em reais, em 3 faixas:
- rapido: preço pra vender em poucos dias
- justo: preço mais comum nos anúncios
- maximo: o mais alto realista, pra quem tem paciência
Depois escreva um anúncio curto e vendedor em português do Brasil, sem inventar acessórios ou defeitos que não aparecem na foto; use [COMPLETE] onde faltar informação (ex.: cidade).
Se a foto não mostrar um objeto avaliável, use "objeto": null.
Responda SOMENTE com JSON válido, sem texto fora dele, neste formato:
{"objeto":"nome curto","estado":"ex.: Usado · estado bom · riscos leves","rapido":0,"justo":0,"maximo":0,"confianca":"alta|media|baixa","motivo":"1 frase curta do porquê do preço","titulo":"título do anúncio","descricao":"descrição do anúncio, 3 a 5 linhas"}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'metodo' });
  const user = await usuarioDoPedido(req);
  if (!user) return json(res, 401, { erro: 'login' });

  const pago = await temAcesso(user.email);
  if (!pago) {
    const gratis = Number(process.env.AVALIACOES_GRATIS || 1);
    if ((await usoTotal(user.id)) >= gratis) return json(res, 402, { erro: 'pagar' });
  }

  const db = admin();
  const { data: hoje } = await db.from('uso').select('n').eq('user_id', user.id).eq('dia', new Date().toISOString().slice(0, 10)).maybeSingle();
  if ((hoje?.n || 0) >= Number(process.env.LIMITE_DIARIO || 60)) return json(res, 429, { erro: 'limite' });

  let img = (req.body && req.body.imagem) || '';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(img);
  if (!m || m[2].length > 5_500_000) return json(res, 400, { erro: 'imagem' });

  let texto = '';
  if (process.env.GEMINI_API_KEY) {
    // Google Gemini (tem plano grátis)
    const modelo = process.env.AI_MODEL || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
      })
    });
    if (!r.ok) { console.error('IA', r.status, await r.text()); return json(res, r.status === 429 ? 429 : 502, { erro: 'ia' }); }
    const out = await r.json();
    texto = (out.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  } else {
    // Anthropic (Claude)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-5-5',
        max_tokens: 900,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: PROMPT }
        ] }]
      })
    });
    if (!r.ok) { console.error('IA', r.status, await r.text()); return json(res, 502, { erro: 'ia' }); }
    const out = await r.json();
    texto = (out.content || []).map(c => c.text || '').join('');
  }
  let dado;
  try { dado = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)); }
  catch { return json(res, 502, { erro: 'formato' }); }
  if (!dado.objeto) return json(res, 422, { erro: 'nao_reconheci' });

  await db.rpc('somar_uso', { p_user: user.id });
  return json(res, 200, { ...dado, pago });
}
