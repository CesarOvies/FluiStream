/**
 * FluiStream — Media Metadata & In-App Trailer Resolver
 * Obtém sinopse, capa/thumb e trailer (para reprodução embutida no app) a partir de
 * Xtream Codes, AdoroCinema (Desktop/Proxy), iTunes, TVMaze e Wikipedia.
 */

import { fetchRemoteText } from './network.js';

const metadataCache = new Map();

const KNOWN_CHANNEL_LOGOS = [
  [/\bsbt\s*news\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sbt-news-br.png'],
  [/\bsbt\s*\+|\+\s*sbt\b|\bsbt\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sbt-br.png'],
  [/\bdisney\s*\+/i, 'https://logodownload.org/wp-content/uploads/2020/11/disney-plus-logo-1.png'],
  [/\bapple\s*tv\b/i, 'https://i.imgur.com/5cjSPVE.png'],
  [/\beleven\s*sports\b/i, 'https://i.imgur.com/AOu4FXH.png'],
  [/\b(?:cine\s*)?sky\b/i, 'https://www.sky.com.br/documents/1407842/29152427/99x70_LOGO_SKY_FASHION_TV_PRETO.png'],
  [/\bsabor\s*(?:&|e)\s*arte\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sabor-and-arte-br.png'],
  [/\bcan[cç][aã]o\s*nova\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/cancao-nova-tv-br.png'],
  [/\brit\s*tv\b|\brit\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/rit-br.png'],
  [/\brs\s*21\b|\brede\s*s[eé]culo\s*21\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/rede-21-br.png'],
  [/\bboas\s*novas\b/i, 'https://i.imgur.com/ZqhizdP.png'],
  [/\bgide[oõ]es\b/i, 'https://i.imgur.com/dDomKND.png'],
  [/\bmaranata\b|\bman[aá]\b/i, 'https://i.imgur.com/7iSmccE.png'],
  [/\bfurac[aã]o\s*tv\b|\bathletico\b/i, 'https://i0.wp.com/upload.wikimedia.org/wikipedia/commons/thumb/4/43/Athletico_Paranaense_%28Logo_2019%29.svg/960px-Athletico_Paranaense_%28Logo_2019%29.svg.png'],
  [/\bbloomberg\b/i, 'https://i.imgur.com/A5ui53C.png'],
  [/\bboa\s*vontade\b/i, 'https://i.imgur.com/Ms5tSgu.png'],
  [/\brede\s*brasil\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/rbtv-br.png'],
  [/\bcnt\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/rede-cnt-br.png'],
  [/\bufc\b/i, 'https://i0.wp.com/static.wikia.nocookie.net/logopedia/images/6/62/UFC_FIGHTPASS_LOGO-645x370.png'],
  [/\bdazn\b/i, 'https://i0.wp.com/www.sportspro.com/wp-content/uploads/2023/04/DAZN-1-3.png'],
  [/\bespn\s*2\b/i, 'https://1.bp.blogspot.com/-uto56pmxCcQ/XXFWkBk_6OI/AAAAAAABZlU/JYiZAU-1wJgWkDqAw8U2dZVtS17LahKEwCLcBGAs/s640/ESPN%2B2.png'],
  [/\bespn\s*3\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/espn3.png'],
  [/\bespn\s*4\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/espn-4-br.png'],
  [/\bespn\s*5\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/espn-5-br.png'],
  [/\bespn\s*6\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/espn6.png'],
  [/\bespn\b/i, 'https://a.espncdn.com/watchespn/images/web/network_logos/channel_logo_brazil_2x.png'],
  [/\bhbo\s*2\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-2-br.png'],
  [/\bhbo\s*(?:\+\s*)?plus\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-plus-br.png'],
  [/\bhbo\s*family\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-family-br.png'],
  [/\bhbo\s*mundi\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-mundi-br.png'],
  [/\bhbo\s*pop\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-pop-br.png'],
  [/\bhbo\s*signature\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-signature-br.png'],
  [/\bhbo\s*xtreme\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-xtreme-br.png'],
  [/\bhbo\s*max\b/i, 'https://i0.wp.com/32q0d.xyz/images/max.png'],
  [/\bhbo\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/hbo-br.png'],
  [/\badult\s*swi[mn]\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/adultswim.png'],
  [/\bcartoon\s*network\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/cartoon-network-br.png'],
  [/\bcartoonito\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/cartoonito-br.png'],
  [/\bdiscovery\s*kids\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/discovery-kids-br.png'],
  [/\bgloobinho\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/gloobinho-br.png'],
  [/\bgloob\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/gloob-br.png'],
  [/\btooncast\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tooncast-br.png'],
  [/\btv\s*r[aá]\s*tim\s*bum\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tv-ra-tim-bum-br.png'],
  [/\bzoomoo\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/zoomoo-br.png'],
  [/\bglobo\s*news\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/globo-news-br.png'],
  [/\bglobo\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/globo-br.png'],
  [/\brecord\b.*\bnews\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/record-news-br.png'],
  [/\brecord\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/record-br.png'],
  [/\bband\s*sports\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/band-sports-br.png'],
  [/\bband\s*news\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/band-news-br.png'],
  [/\bband\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/band-br.png'],
  [/\brede\s*tv\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/rede-tv-br.png'],
  [/\btv\s*cultura\b|\bcultura\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tv-cultura-br.png'],
  [/\bfutura\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/futura-br.png'],
  [/\bcanal\s*brasil\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/canal-brasil-br.png'],
  [/\bsportv\s*2\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sportv2-br.png'],
  [/\bsportv\s*3\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sportv3-br.png'],
  [/\bsportv\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sportv-br.png'],
  [/\bpremiere\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/premiere-br.png'],
  [/\bcombate\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/combate.png'],
  [/\b(?:telecine|tc)\s*action\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tele-cine-action-br.png'],
  [/\b(?:telecine|tc)\s*cult\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tele-cine-cult-br.png'],
  [/\b(?:telecine|tc)\s*fun\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tele-cine-fun-br.png'],
  [/\b(?:telecine|tc)\s*pipoca\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tele-cine-pipoca-br.png'],
  [/\b(?:telecine|tc)\s*premium\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tele-cine-premium-br.png'],
  [/\b(?:telecine|tc)\s*touch\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tele-cine-touch-br.png'],
  [/\bmegapix\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/megapix-br.png'],
  [/\bstudio\s*universal\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/studio-universal-br.png'],
  [/\buniversal\s*tv\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/universal-tv-br.png'],
  [/\btnt\s*s[eé]ries\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tnt-series-br.png'],
  [/\btnt\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tnt-br.png'],
  [/\bspace\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/space-br.png'],
  [/\bwarner\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/warner-channel-br.png'],
  [/\bsony\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sony-channel-br.png'],
  [/\baxn\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/axn-br.png'],
  [/\bparamount\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/paramount-network-br.png'],
  [/\bamc\b/i, 'https://1000logos.net/wp-content/uploads/2023/05/AMC-TV-Logo.png'],
  [/\bcinemax\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/cinemax-br.png'],
  [/\bdiscovery\s*h\s*&?\s*h\b|\bhome\s*(?:&|and)\s*health\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/discoveryhh.png'],
  [/\bdiscovery\s*turbo\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/discovery-turbo-br.png'],
  [/\bdiscovery\s*science\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/discoveryscience.png'],
  [/\bdiscovery\s*theat(?:er|her)\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/discoverytheater.png'],
  [/\bdiscovery\s*world\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/discoveryworld.png'],
  [/\bdiscovery\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/discoverychannel.png'],
  [/\banimal\s*planet\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/animalplanet.png'],
  [/\btlc\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/tlc.png'],
  [/\bdiscovery\s*id\b|\binvestiga[cç][aã]o\s*discovery\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/id.png'],
  [/\bhistory\s*2\b|\bh2\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/h2.png'],
  [/\bhistory\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/history.png'],
  [/\ba\s*&?\s*e\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/a-and-e-br.png'],
  [/\blifetime\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/lifetime.png'],
  [/\be!\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/e.png'],
  [/\bfood\s*network\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/foodnetwork.png'],
  [/\bhgtv\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/hgtv.png'],
  [/\barte\s*1\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/arte1-br.png'],
  [/\bcurta!?\b/i, 'https://i0.wp.com/32q0d.xyz/images/logos/15a528af09f0611530f704b661b56d07.png'],
  [/\bmultishow\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/multishow-br.png'],
  [/\bgnt\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/gnt-br.png'],
  [/\bviva\b/i, 'https://cdn.mitvstatic.com/channels/br_viva_m.png'],
  [/\bbis\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/bis-br.png'],
  [/\bcanal\s*off\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/off.png'],
  [/\bmodo\s*viagem\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/modoviagem.png'],
  [/\bcnn\s*brasil\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/cnn-brasil-br.png'],
  [/\bjovem\s*pan\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/jovem-pan-news-br.png'],
  [/\baparecida\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/tv-aparecida-br.png'],
  [/\brede\s*vida\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/rede-vida-br.png'],
  [/\bnovo\s*tempo\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/novo-tempo-br.png'],
  [/\bprime\s*video\b/i, 'https://i0.wp.com/www.fontedecanais.io/logos/canais/primevideo.png'],
  [/\bcaz[eé]\s*tv\b/i, 'https://i0.wp.com/32q0d.xyz/images/caze.png'],
  [/\bcanal\s*goat\b/i, 'https://i0.wp.com/32q0d.xyz/images/goat.png'],
  [/\bplayboy\b/i, 'https://i.imgur.com/5di4Nis.png'],
  [/\bsexy\s*hot\b/i, 'https://i.imgur.com/Fs8xVoY.png'],
  [/\bvenus\b/i, 'https://i.imgur.com/4LFXPMk.png'],
  [/\bblue\s*hustler\b/i, 'https://i.imgur.com/G1YaX0Q.png'],
  [/\bhustler\b/i, 'https://i.imgur.com/41Ej2io.png'],
  [/\bbrazzers\b/i, 'https://i.imgur.com/95nP0Pb.png'],
  [/\bdorcel\b/i, 'https://i.imgur.com/RkzyjEd.png'],
  [/\bpenthouse\b/i, 'https://i.imgur.com/lharlRZ.png'],
  [/\bvivid\b/i, 'https://i.imgur.com/56k2iwG.png'],
  [/\bprivate\b/i, 'https://i.imgur.com/2yt8MAA.png'],
  [/\bredlight\b/i, 'https://i.imgur.com/g0QF5IG.png'],
  [/\bbabes\s*tv\b|\bpure\s*babes\b/i, 'https://i.imgur.com/XK19a9v.png'],
  [/\bvixen\b/i, 'https://i.imgur.com/4XWMriE.png'],
  [/\bsextreme\b/i, 'https://i.imgur.com/jWsW2Rd.png'],
  [/\bsex\s*prive\b/i, 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main/countries/brazil/sexprive-br.png']
];

export function normalizeLiveChannelKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:4k|uhd|fhd|hd|sd|hevc|h\.?26[45]|1080p|720p)\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, '')
    .trim();
}

export function resolveKnownChannelLogo(rawName, tvgId = '') {
  const candidates = [String(rawName || '').trim(), String(tvgId || '').trim()].filter(Boolean);
  for (const text of candidates) {
    const cleaned = text
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '')
      .replace(/\b(?:4k|uhd|fhd|hd|sd|hevc|h\.?26[45]|1080p|720p)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    for (const [pattern, logoUrl] of KNOWN_CHANNEL_LOGOS) {
      if (pattern.test(cleaned) || pattern.test(text)) {
        return logoUrl;
      }
    }
  }
  return '';
}

export function buildProxyLogoFallbackUrl(failedUrl, localProxyBase = '') {
  const u = String(failedUrl || '').trim();
  if (!u || u === 'assets/logo.svg' || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('assets/')) {
    return '';
  }

  const rawProxy = localProxyBase || (typeof window !== 'undefined' && typeof window.__fluiLocalProxyUrl === 'string'
    ? window.__fluiLocalProxyUrl.trim()
    : '');
  const prefix = rawProxy ? (rawProxy.endsWith('/') ? rawProxy : `${rawProxy}/`) : '';

  if (/\/(?:api\/)?proxy\?url=/i.test(u)) {
    return '';
  }

  let inner = u;
  let stage = 'direct';
  if (/^https:\/\/wsrv\.nl\/\?url=/i.test(u)) {
    stage = 'wsrv';
    try {
      inner = new URL(u).searchParams.get('url') || '';
    } catch {
      inner = '';
    }
  } else if (/^https:\/\/i0\.wp\.com\//i.test(u)) {
    stage = 'i0';
    inner = `https://${u.replace(/^https:\/\/i0\.wp\.com\//i, '')}`;
  }

  if (!inner) return '';

  try {
    const parsed = new URL(inner);
    const isCustomPort = Boolean(parsed.port && parsed.port !== '80' && parsed.port !== '443');
    const isRawIp = /^(?:\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\])$/i.test(parsed.hostname);
    if (isCustomPort || isRawIp) {
      return prefix ? `${prefix}proxy?url=${encodeURIComponent(inner)}` : '';
    }
  } catch {
    return '';
  }

  if (stage === 'direct') {
    return `https://wsrv.nl/?url=${encodeURIComponent(inner)}`;
  }
  if (stage === 'wsrv') {
    return `https://i0.wp.com/${inner.replace(/^https?:\/\//i, '')}`;
  }
  if (stage === 'i0') {
    return prefix ? `${prefix}proxy?url=${encodeURIComponent(inner)}` : `https://wsrv.nl/?url=${encodeURIComponent(inner)}`;
  }
  return '';
}

export function cleanMediaTitle(rawName) {
  const raw = String(rawName || '').trim();
  const yearMatch = raw.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '';
  const cleaned = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(\d{4}\)/g, ' ')
    .replace(/\b(?:4K|UHD|FHD|HD|SD|H\.?26[45]|HEVC|DUAL|DUBLADO|LEGENDADO|CAM|WEB-?DL|BLURAY)\b/gi, ' ')
    .replace(/\s*[-–|:]\s*(?:T|S)\d+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: cleaned || raw, year };
}

export function extractYouTubeVideoId(raw) {
  const val = String(raw || '').trim();
  if (!val) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(val)) return val;
  const watchMatch = val.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = val.match(/(?:youtu\.be|youtube(?:-nocookie)?\.com\/(?:embed|shorts))\/([a-zA-Z0-9_-]{11})/i);
  return shortMatch ? shortMatch[1] : '';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos',
  'em', 'no', 'na', 'nos', 'nas', 'e', 'the', 'an', 'and', 'of', 'in', 'to', 'for',
  'el', 'la', 'los', 'las', 'un', 'una', 'del', 'y'
]);

function normalizeCompareText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSignificantTokens(str) {
  const all = normalizeCompareText(str).split(' ').filter(t => t.length >= 2);
  const sig = all.filter(t => !STOP_WORDS.has(t) && !/^\d{4}$/.test(t));
  return sig.length > 0 ? sig : all;
}

export function scoreTitleMatch(candidateTitle, targetTitle, targetYear = '', candidateYear = '') {
  const candNorm = normalizeCompareText(candidateTitle);
  const targetNorm = normalizeCompareText(targetTitle);
  if (!candNorm || !targetNorm) return -1;

  if (targetYear && candidateYear && /^\d{4}$/.test(String(targetYear)) && /^\d{4}$/.test(String(candidateYear))) {
    if (Math.abs(parseInt(targetYear, 10) - parseInt(candidateYear, 10)) > 1) {
      return -1;
    }
  }

  const targetTokens = getSignificantTokens(targetTitle);
  const candTokens = new Set(getSignificantTokens(candidateTitle));
  if (targetTokens.length === 0) return -1;

  const baseTitlePart = normalizeCompareText(String(targetTitle || '').split(/[:\-–|]/)[0]);
  const primaryToken = targetTokens[0];
  let matched = 0;
  for (const t of targetTokens) {
    if (candTokens.has(t)) matched += 1;
  }

  if (targetTokens.length === 1) {
    if (!candTokens.has(primaryToken)) return -1;
  } else {
    const minRequired = Math.ceil(targetTokens.length * 0.5);
    const hasPrimaryAndPrefix = Boolean(baseTitlePart && candNorm.includes(baseTitlePart) && matched >= 1);
    if (matched < minRequired && !hasPrimaryAndPrefix) return -1;
    if (!candTokens.has(primaryToken) && matched < Math.ceil(targetTokens.length * 0.75)) return -1;
  }

  let score = (matched / targetTokens.length) * 20;
  if (candNorm.includes(targetNorm)) score += 10;
  else if (baseTitlePart && candNorm.includes(baseTitlePart)) score += 5;
  if (targetYear && candidateYear && Math.abs(parseInt(targetYear, 10) - parseInt(candidateYear, 10)) <= 1) {
    score += 8;
  }
  return score;
}

export function parseAdoroCinemaHtml(html) {
  const src = String(html || '');
  if (!src) return { synopsis: '', poster: '', detailPath: '', title: '' };

  let synopsis = '';
  let poster = '';
  let title = '';

  const ldMatches = src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!title && typeof node?.name === 'string' && node.name.trim()) {
          title = stripHtml(node.name);
        }
        if (!synopsis && typeof node?.description === 'string' && node.description.trim().length > 20) {
          synopsis = stripHtml(node.description);
        }
        if (!poster && node?.image) {
          poster = typeof node.image === 'string' ? node.image : (node.image.url || '');
        }
      }
    } catch {}
  }

  if (!title) {
    const ogTitle = src.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitle) title = stripHtml(ogTitle[1]);
  }

  if (!synopsis) {
    const synMatch = src.match(/class=["'][^"']*(?:content-txt|synopsis-txt)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|section)>/i);
    if (synMatch) synopsis = stripHtml(synMatch[1]);
  }
  if (!synopsis) {
    const metaDesc = src.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)["']/i);
    if (metaDesc && metaDesc[1].trim().length > 25) synopsis = stripHtml(metaDesc[1]);
  }

  if (!poster) {
    const ogImg = src.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || src.match(/class=["'][^"']*thumbnail-img[^"']*["'][^>]+(?:data-src|src)=["']([^"']+)["']/i);
    if (ogImg) poster = ogImg[1].trim();
  }

  const linkMatch = src.match(/href=["'](\/(?:filmes\/filme|series\/serie)-\d+\/?)["']/i);
  const detailPath = linkMatch ? linkMatch[1] : '';

  return { synopsis, poster, detailPath, title };
}

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchAdoroCinema(title, kind, fetchTextFn, year = '') {
  const isNativeCapable = typeof window !== 'undefined' && Boolean(window.chrome?.webview);
  if (!isNativeCapable && fetchTextFn === fetchRemoteText) return null;
  try {
    const query = year ? `${title} ${year}` : title;
    const searchUrl = `https://www.adorocinema.com/pesquisar/?q=${encodeURIComponent(query)}`;
    const html = await fetchTextFn(searchUrl, 8000);
    let parsed = parseAdoroCinemaHtml(html);
    if ((!parsed.synopsis || !parsed.poster) && parsed.detailPath) {
      const detailHtml = await fetchTextFn(`https://www.adorocinema.com${parsed.detailPath}`, 8000);
      const detailParsed = parseAdoroCinemaHtml(detailHtml);
      parsed = {
        synopsis: detailParsed.synopsis || parsed.synopsis,
        poster: detailParsed.poster || parsed.poster,
        detailPath: parsed.detailPath,
        title: detailParsed.title || parsed.title
      };
    }
    if (parsed.title && scoreTitleMatch(parsed.title, title, year) < 0) {
      return null;
    }
    if (parsed.synopsis || parsed.poster) return parsed;
  } catch {}
  return null;
}

async function fetchItunes(title, kind, fetchJsonFn, year = '') {
  const media = kind === 'series' ? 'tvShow' : 'movie';
  const data = await fetchJsonFn(
    `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=${media}&country=BR&lang=pt_br&limit=8`
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return null;

  let bestHit = null;
  let bestScore = -1;
  for (const cand of results) {
    const candTitle = cand.trackName || cand.collectionName || '';
    const candYear = String(cand.releaseDate || '').slice(0, 4);
    const sc = scoreTitleMatch(candTitle, title, year, candYear);
    if (sc > bestScore) {
      bestScore = sc;
      bestHit = cand;
    }
  }
  if (!bestHit || bestScore < 0) return null;

  const poster = bestHit.artworkUrl100 ? bestHit.artworkUrl100.replace(/100x100bb/i, '600x600bb') : '';
  return {
    synopsis: stripHtml(bestHit.longDescription || bestHit.shortDescription || ''),
    poster,
    trailerUrl: bestHit.previewUrl || '',
    genre: bestHit.primaryGenreName || ''
  };
}

async function fetchTvMaze(title, fetchJsonFn, year = '') {
  const data = await fetchJsonFn(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`);
  if (!data) return null;
  const candYear = String(data.premiered || '').slice(0, 4);
  if (data.name && scoreTitleMatch(data.name, title, year, candYear) < 0) {
    return null;
  }
  return {
    synopsis: stripHtml(data.summary || ''),
    poster: data.image?.original || data.image?.medium || '',
    genre: Array.isArray(data.genres) ? data.genres.slice(0, 2).join(', ') : '',
    rating: data.rating?.average ? String(data.rating.average) : ''
  };
}

async function fetchWikipedia(title, kind, fetchJsonFn) {
  const suffix = kind === 'series' ? 'série' : 'filme';
  for (const lang of ['pt', 'en']) {
    const q = lang === 'pt' ? `${title} ${suffix}` : title;
    const search = await fetchJsonFn(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`
    );
    const pageTitle = search?.query?.search?.[0]?.title;
    if (!pageTitle) continue;
    const summary = await fetchJsonFn(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`
    );
    if (summary?.extract || summary?.thumbnail?.source) {
      return {
        synopsis: stripHtml(summary.extract || ''),
        poster: summary.originalimage?.source || summary.thumbnail?.source || ''
      };
    }
  }
  return null;
}

const YOUTUBE_NOISE_RE = /\b(?:15s|10s|6s|initial credits|bumper|commercial|shorts|making of|bastidores|reaction|react|review|an[áa]lise|cr[íi]tica|soundtrack|trilha sonora|clipe|scene|cena)\b/i;

export function selectBestYouTubeTrailerFromHtml(html, title, year = '') {
  const src = String(html || '');
  if (!src) return '';

  const rendererMatches = [...src.matchAll(/"videoRenderer"\s*:\s*\{\s*"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g)];
  if (rendererMatches.length === 0) {
    const fallbackMatch = src.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
    return fallbackMatch ? fallbackMatch[1] : '';
  }

  let bestId = '';
  let bestScore = -1;

  for (let i = 0; i < rendererMatches.length && i < 20; i++) {
    const match = rendererMatches[i];
    const videoId = match[1];
    const slice = src.slice(match.index, match.index + 1600);
    const titleMatch = slice.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])+)"/)
      || slice.match(/"title"\s*:\s*\{\s*"simpleText"\s*:\s*"((?:\\.|[^"\\])+)"/);
    if (!titleMatch) continue;

    let candTitle = titleMatch[1];
    try {
      candTitle = JSON.parse(`"${candTitle}"`);
    } catch {}

    if (YOUTUBE_NOISE_RE.test(candTitle)) continue;

    // Filtrar clipes curtos (< 25s) como bumpers de distribuidora ("15s video")
    const lenMatch = slice.match(/"lengthText"\s*:\s*\{[^}]*"simpleText"\s*:\s*"(\d+):(\d{2})"/);
    if (lenMatch) {
      const totalSec = parseInt(lenMatch[1], 10) * 60 + parseInt(lenMatch[2], 10);
      if (totalSec > 0 && totalSec < 25) continue;
      if (totalSec > 600) continue; // ignorar filmes completos / lives > 10 min
    }

    const baseScore = scoreTitleMatch(candTitle, title, year);
    if (baseScore < 0) continue;

    let score = baseScore;
    if (/\btrailer\b/i.test(candTitle)) score += 8;
    if (/\b(?:oficial|official|legendado|dublado)\b/i.test(candTitle)) score += 4;
    if (year && candTitle.includes(String(year))) score += 6;
    if (/\bteaser\b/i.test(candTitle) && !/\btrailer\b/i.test(candTitle)) score -= 3;

    if (score > bestScore) {
      bestScore = score;
      bestId = videoId;
    }
  }

  return bestId;
}

export async function resolveYouTubeTrailerId(title, fetchTextFn = fetchRemoteText, year = '') {
  try {
    const q = `${title}${year ? ` ${year}` : ''} trailer oficial legendado`;
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const html = await fetchTextFn(url, 8000);
    return selectBestYouTubeTrailerFromHtml(html, title, year);
  } catch {
    return '';
  }
}

export async function resolveTrailerPlayback(item, meta = null, fetchTextFn = fetchRemoteText) {
  const directCandidate = String(meta?.trailerUrl || item?.trailer || '').trim();
  const ytFromMeta = extractYouTubeVideoId(meta?.youtubeId || item?.trailer || '');

  if (ytFromMeta) {
    return {
      type: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytFromMeta)}?autoplay=1&rel=0`
    };
  }
  if (/^https?:\/\/.+\.(?:mp4|m4v|m3u8|webm)(?:[?#].*)?$/i.test(directCandidate)) {
    return { type: 'video', src: directCandidate };
  }
  if (/^https?:\/\//i.test(directCandidate)) {
    const ytId = extractYouTubeVideoId(directCandidate);
    if (ytId) {
      return {
        type: 'youtube',
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?autoplay=1&rel=0`
      };
    }
  }

  const { title, year } = cleanMediaTitle(item?.name || item?.seriesTitle || '');
  const resolvedYear = meta?.year || year;
  const searchedYtId = await resolveYouTubeTrailerId(title, fetchTextFn, resolvedYear);
  if (searchedYtId) {
    return {
      type: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(searchedYtId)}?autoplay=1&rel=0`
    };
  }

  return { type: 'none', src: '' };
}

export async function resolveMediaMetadata(item, opts = {}) {
  const kind = opts.kind || (item?.type === 'series' ? 'series' : 'movie');
  const rawName = item?.seriesTitle || item?.name || '';
  const { title, year } = cleanMediaTitle(rawName);
  const cacheKey = `${kind}:${title.toLowerCase()}:${item?.id || ''}`;
  if (metadataCache.has(cacheKey)) return metadataCache.get(cacheKey);

  const fetchTextFn = opts.fetchText || fetchRemoteText;
  const fetchJsonFn = opts.fetchJson || safeFetchJson;

  const result = {
    synopsis: String(item?.desc || item?.plot || '').trim(),
    poster: '',
    trailerUrl: String(item?.trailer || '').trim(),
    youtubeId: extractYouTubeVideoId(item?.trailer || ''),
    genre: '',
    rating: '',
    duration: '',
    year
  };

  if (kind === 'live') {
    result.poster = resolveKnownChannelLogo(item?.name || rawName, item?.tvgId || '');
    if (!result.poster) {
      const cleanLive = cleanMediaTitle(item?.name || rawName).title;
      const wiki = await fetchWikipedia(cleanLive, 'series', fetchJsonFn);
      if (wiki?.poster) result.poster = wiki.poster;
    }
    metadataCache.set(cacheKey, result);
    return result;
  }

  // 1. Xtream VOD Info (para filmes)
  if (kind === 'movie' && opts.xtreamApi && item?.url) {
    const vodMatch = String(item.url).match(/\/movie\/[^/]+\/[^/]+\/(\d+)(?:\.[a-z0-9]+)?/i);
    if (vodMatch) {
      const vodInfo = await opts.xtreamApi.getVodInfo(vodMatch[1]);
      const info = vodInfo?.info || {};
      if (!result.synopsis) result.synopsis = stripHtml(info.plot || info.description || '');
      if (!result.poster) result.poster = info.cover_big || info.movie_image || '';
      if (!result.youtubeId && info.youtube_trailer) {
        result.youtubeId = extractYouTubeVideoId(info.youtube_trailer);
      }
      if (!result.genre && info.genre) result.genre = info.genre;
      if (!result.rating && info.rating) result.rating = String(info.rating);
      if (!result.duration && info.duration) result.duration = info.duration;
      if (!result.year && info.releasedate) result.year = String(info.releasedate).slice(0, 4);
    }
  }

  // 2. Fontes externas: AdoroCinema -> iTunes / TVMaze -> Wikipedia
  if (!result.synopsis || !result.poster || (kind === 'movie' && !result.youtubeId && !result.trailerUrl)) {
    const adoro = await fetchAdoroCinema(title, kind, fetchTextFn, result.year);
    if (adoro) {
      if (!result.synopsis && adoro.synopsis) result.synopsis = adoro.synopsis;
      if (!result.poster && adoro.poster) result.poster = adoro.poster;
    }
  }

  if (!result.synopsis || !result.poster || (kind === 'movie' && !result.trailerUrl)) {
    const itunes = await fetchItunes(title, kind, fetchJsonFn, result.year);
    if (itunes) {
      if (!result.synopsis && itunes.synopsis) result.synopsis = itunes.synopsis;
      if (!result.poster && itunes.poster) result.poster = itunes.poster;
      if (!result.trailerUrl && itunes.trailerUrl) result.trailerUrl = itunes.trailerUrl;
      if (!result.genre && itunes.genre) result.genre = itunes.genre;
    }
  }

  if (kind === 'series' && (!result.synopsis || !result.poster)) {
    const tvm = await fetchTvMaze(title, fetchJsonFn, result.year);
    if (tvm) {
      if (!result.synopsis && tvm.synopsis) result.synopsis = tvm.synopsis;
      if (!result.poster && tvm.poster) result.poster = tvm.poster;
      if (!result.genre && tvm.genre) result.genre = tvm.genre;
      if (!result.rating && tvm.rating) result.rating = tvm.rating;
    }
  }

  if (!result.synopsis || !result.poster) {
    const wiki = await fetchWikipedia(title, kind, fetchJsonFn);
    if (wiki) {
      if (!result.synopsis && wiki.synopsis) result.synopsis = wiki.synopsis;
      if (!result.poster && wiki.poster) result.poster = wiki.poster;
    }
  }

  metadataCache.set(cacheKey, result);
  return result;
}

