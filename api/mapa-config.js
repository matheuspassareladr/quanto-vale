// Configuração pública da página do Mapa da Aprovação (link do checkout e vídeo).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    checkout: process.env.MAPA_CHECKOUT || 'https://go.perfectpay.com.br/PPU38CQI023',
    video: process.env.MAPA_VIDEO || '/mapa/video.mp4',
    // Pixel da Meta "Pixel Ofertas Digitais" (serve para todas as ofertas). utmify: ligar quando assinar.
    pixel: process.env.META_PIXEL || '2618314465300789',
    utmify: process.env.UTMIFY === '1',
    utmifyPixel: process.env.UTMIFY_PIXEL || ''
  });
}
