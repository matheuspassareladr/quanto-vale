// Mapa da Aprovação Transpetro — conteúdo do app e Professor IA.
// GET  /api/mapa?k=CHAVE            → devolve questões, mapa, plano e flashcards
// POST /api/mapa {k, pergunta, ctx}  → Professor IA responde
import { createHash } from 'node:crypto';
import { QUESTOES, MAPA, PLANO, FLASH } from './_mapa_dados.js';
import { json } from './_lib.js';

// Só o hash fica no código (o repositório é público). A chave vai no link de entrega.
const HASHES = ['f1d76b7998c70e4f3903078685605657cd185d917254d8572156ce0b1d88f5c0'];
const chaveOk = k => typeof k === 'string' && HASHES.includes(createHash('sha256').update(k.trim().toUpperCase()).digest('hex'));

// Limite simples por instância (evita abuso do Professor IA).
const usos = new Map();
function podeUsar(ip) {
  const dia = new Date().toISOString().slice(0, 10);
  const chave = ip + dia;
  const n = (usos.get(chave) || 0) + 1;
  usos.set(chave, n);
  if (usos.size > 5000) usos.clear();
  return n <= Number(process.env.MAPA_IA_POR_DIA || 60);
}

const SISTEMA = `Você é o "Professor IA" do Mapa da Aprovação, um material de estudo independente (sem vínculo com a Transpetro ou com a Cesgranrio) para a prova de Profissional Transpetro de Nível Médio – Ênfase Administração e Controle (prova em 06/12/2026, banca Cesgranrio, 60 questões: 10 Português, 10 Matemática, 40 Conhecimentos Específicos em processos administrativos e legislação, finanças e contabilidade, logística e suprimentos — incluindo Lei 13.303/2016 e Lei 14.133/2021 — e informática com LGPD).
Regras:
- Responda em português do Brasil, simples e direto, como um bom professor de cursinho. No máximo uns 180 palavras, a menos que peçam mais.
- Explique o raciocínio passo a passo e termine com uma dica curta de prova ("Dica de prova: ...").
- Se pedirem exercícios, crie questões no estilo Cesgranrio (5 alternativas A a E) e só mostre o gabarito comentado no fim.
- Se não tiver certeza de um detalhe de lei ou número, diga isso claramente. Nunca invente artigo de lei.
- Não prometa aprovação. Se perguntarem sobre local de prova, horário ou regras oficiais, oriente consultar o edital e o site da Cesgranrio.
- Fale apenas de estudo para a prova; recuse outros assuntos com gentileza.`;

async function perguntarIA(pergunta, ctx) {
  const texto = (ctx ? `Contexto (questão que o aluno está estudando):\n${String(ctx).slice(0, 2500)}\n\n` : '') + `Pergunta do aluno: ${String(pergunta).slice(0, 1500)}`;
  if (process.env.GEMINI_API_KEY) {
    const modelos = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
    const inicio = Date.now();
    for (const modelo of modelos) {
      const corpo = pensar => JSON.stringify({
        systemInstruction: { parts: [{ text: SISTEMA }] },
        contents: [{ role: 'user', parts: [{ text: texto }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1000, ...(pensar ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) }
      });
      const chama = pensar => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(Math.max(4000, Math.min(24000, 52000 - (Date.now() - inicio)))),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: corpo(pensar)
      });
      let r;
      try {
        r = await chama(true);
        if (r.status === 400) r = await chama(false);
      } catch (e) { console.error('mapa IA timeout', modelo, Date.now() - inicio); if (Date.now() - inicio > 46000) return null; continue; }
      if (r.ok) {
        const out = await r.json();
        return (out.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim() || null;
      }
      console.error('mapa IA', modelo, r.status, (await r.text().catch(() => '')).slice(0, 300));
      if (![404, 429, 500, 503].includes(r.status)) return null;
    }
    return null;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 900, system: SISTEMA, messages: [{ role: 'user', content: texto }] })
    });
    if (!r.ok) return null;
    const out = await r.json();
    return (out.content || []).map(c => c.text || '').join('').trim();
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!chaveOk(req.query.k)) return json(res, 401, { erro: 'Código de acesso inválido.' });
    return json(res, 200, { questoes: QUESTOES, mapa: MAPA, plano: PLANO, flash: FLASH });
  }
  if (req.method === 'POST') {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!chaveOk(b.k)) return json(res, 401, { erro: 'Código de acesso inválido.' });
    if (!b.pergunta || String(b.pergunta).trim().length < 2) return json(res, 400, { erro: 'Escreva sua dúvida.' });
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
    if (!podeUsar(ip)) return json(res, 429, { erro: 'Você atingiu o limite de perguntas de hoje. Amanhã libera de novo!' });
    const resposta = await perguntarIA(b.pergunta, b.ctx);
    if (!resposta) return json(res, 503, { erro: 'O Professor IA está ocupado agora. Tente de novo em instantes.' });
    return json(res, 200, { resposta });
  }
  res.setHeader('Allow', 'GET, POST');
  return json(res, 405, { erro: 'Método não permitido' });
}
