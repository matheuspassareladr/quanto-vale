// Entrega ao site só o que é público (a chave "anon" do Supabase é pública por natureza).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    checkoutUrl: process.env.KORVEX_CHECKOUT_URL || 'https://checkout.korvex.com.br/checkout/cmtbnn5ki00jj01pqy5464wkv?offer=LKDN3PJ',
    gratis: Number(process.env.AVALIACOES_GRATIS || 1),
    preco: process.env.PRECO_TEXTO || 'R$ 14,90 por 30 dias'
  });
}
