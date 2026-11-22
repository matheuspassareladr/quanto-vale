// Configuração pública da página do Mapa da Aprovação (link do checkout e vídeo).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.json({
    checkout: process.env.MAPA_CHECKOUT || 'https://go.perfectpay.com.br/PPU38CQI023',
    video: process.env.MAPA_VIDEO || ''
  });
}
