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

// ---------- Indique e ganhe ----------
// Regra: quem indicar X amigos que COMPRAREM ganha o acesso vitalício de graça.
export const regrasIndicacao = () => ({
  metaVitalicio: Number(process.env.AMIGOS_PRA_VITALICIO || 2)
});

// Confere se quem indicou já bateu a meta e, se sim, libera o vitalício dele.
export async function premiaIndicador(db, indicadorId) {
  const { count } = await db.from('indicacoes').select('indicado_id', { count: 'exact', head: true }).eq('indicador_id', indicadorId).eq('pagou', true);
  if ((count || 0) < regrasIndicacao().metaVitalicio) return;
  const { data: perfil } = await db.from('perfis').select('email').eq('user_id', indicadorId).maybeSingle();
  if (!perfil?.email || await temAcesso(perfil.email)) return;
  await db.from('acessos').upsert({ email: perfil.email, status: 'ativo', plano: 'vitalicio', expira_em: null, atualizado_em: new Date().toISOString(), origem: { gateway: 'indicacao', amigos: count } }, { onConflict: 'email' });
}

// ---------- IA ----------
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

// Valida a foto (data URL). Devolve { mime, b64 } ou null.
export function lerImagem(img) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(img || ''));
  if (!m || m[2].length > 5_500_000) return null;
  return { mime: m[1], b64: m[2] };
}

// Manda a foto pra IA. Devolve { status, dado } (status 200 = ok).
export async function avaliarFoto({ mime, b64 }) {
  let texto = '';
  if (process.env.GEMINI_API_KEY) {
    // Gemini: os modelos novos "pensam" demais por padrão; pedimos raciocínio baixo pra responder rápido.
    const modelos = process.env.AI_MODEL ? [process.env.AI_MODEL] : ['gemini-3.8-flash', 'gemini-flash-latest'];
    const inicio = Date.now();
    let r = null;
    const chama = (modelo, pensar) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(Math.max(5000, 52000 - (Date.now() - inicio))),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3, ...(pensar ? { thinkingConfig: { thinkingLevel: pensar } } : {}) }
      })
    });
    for (const modelo of modelos) {
      const t0 = Date.now();
      try {
        r = await chama(modelo, 'low');
        if (r.status === 400) { console.error('IA', modelo, 'sem thinkingLevel', await r.text()); r = await chama(modelo, null); }
      } catch (e) { console.error('IA modelo', modelo, 'demorou demais', Date.now() - t0, 'ms'); r = null; break; }
      console.log('IA modelo', modelo, r.status, Date.now() - t0, 'ms');
      if (r.ok || r.status !== 404) break;
      console.error('IA modelo', modelo, r.status, await r.text());
    }
    if (!r) return { status: 504 };
    if (!r.ok) { console.error('IA', r.status, await r.text()); return { status: r.status === 429 ? 429 : 502 }; }
    const out = await r.json();
    texto = (out.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  } else {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-5-5',
        max_tokens: 900,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text', text: PROMPT }
        ] }]
      })
    });
    if (!r.ok) { console.error('IA', r.status, await r.text()); return { status: 502 }; }
    const out = await r.json();
    texto = (out.content || []).map(c => c.text || '').join('');
  }
  let dado;
  try { dado = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)); }
  catch { return { status: 502 }; }
  if (!dado.objeto) return { status: 422 };
  return { status: 200, dado };
}

export function json(res, status, corpo) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}
