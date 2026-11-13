/**
 * FluiStream — Media Metadata & In-App Trailer Resolver
 * Obtém sinopse, capa/thumb e trailer (para reprodução embutida no app) a partir de
 * Xtream Codes, AdoroCinema (Desktop/Proxy), iTunes, TVMaze e Wikipedia.
 */

import { fetchRemoteText } from './network.js';

const metadataCache = new Map();

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

export function parseAdoroCinemaHtml(html) {
  const src = String(html || '');
  if (!src) return { synopsis: '', poster: '', detailPath: '' };

  let synopsis = '';
  let poster = '';

  const ldMatches = src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!synopsis && typeof node?.description === 'string' && node.description.trim().length > 20) {
          synopsis = stripHtml(node.description);
        }
        if (!poster && node?.image) {
          poster = typeof node.image === 'string' ? node.image : (node.image.url || '');
        }
      }
    } catch {}
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

  return { synopsis, poster, detailPath };
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

async function fetchAdoroCinema(title, kind, fetchTextFn) {
  const isNativeCapable = typeof window !== 'undefined' && Boolean(window.chrome?.webview);
  if (!isNativeCapable && fetchTextFn === fetchRemoteText) return null;
  try {
    const searchUrl = `https://www.adorocinema.com/pesquisar/?q=${encodeURIComponent(title)}`;
    const html = await fetchTextFn(searchUrl, 8000);
    let parsed = parseAdoroCinemaHtml(html);
    if ((!parsed.synopsis || !parsed.poster) && parsed.detailPath) {
      const detailHtml = await fetchTextFn(`https://www.adorocinema.com${parsed.detailPath}`, 8000);
      const detailParsed = parseAdoroCinemaHtml(detailHtml);
      parsed = {
        synopsis: detailParsed.synopsis || parsed.synopsis,
        poster: detailParsed.poster || parsed.poster,
        detailPath: parsed.detailPath
      };
    }
    if (parsed.synopsis || parsed.poster) return parsed;
  } catch {}
  return null;
}

async function fetchItunes(title, kind, fetchJsonFn) {
  const media = kind === 'series' ? 'tvShow' : 'movie';
  const data = await fetchJsonFn(
    `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=${media}&country=BR&lang=pt_br&limit=3`
  );
  const hit = data?.results?.[0];
  if (!hit) return null;
  const poster = hit.artworkUrl100 ? hit.artworkUrl100.replace(/100x100bb/i, '600x600bb') : '';
  return {
    synopsis: stripHtml(hit.longDescription || hit.shortDescription || ''),
    poster,
    trailerUrl: hit.previewUrl || '',
    genre: hit.primaryGenreName || ''
  };
}

async function fetchTvMaze(title, fetchJsonFn) {
  const data = await fetchJsonFn(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`);
  if (!data) return null;
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

export async function resolveYouTubeTrailerId(title, fetchTextFn = fetchRemoteText) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} trailer oficial`)}`;
    const html = await fetchTextFn(url, 8000);
    const m = String(html || '').match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return m ? m[1] : '';
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

  const { title } = cleanMediaTitle(item?.name || item?.seriesTitle || '');
  const searchedYtId = await resolveYouTubeTrailerId(title, fetchTextFn);
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
    const adoro = await fetchAdoroCinema(title, kind, fetchTextFn);
    if (adoro) {
      if (!result.synopsis && adoro.synopsis) result.synopsis = adoro.synopsis;
      if (!result.poster && adoro.poster) result.poster = adoro.poster;
    }
  }

  if (!result.synopsis || !result.poster || (kind === 'movie' && !result.trailerUrl)) {
    const itunes = await fetchItunes(title, kind, fetchJsonFn);
    if (itunes) {
      if (!result.synopsis && itunes.synopsis) result.synopsis = itunes.synopsis;
      if (!result.poster && itunes.poster) result.poster = itunes.poster;
      if (!result.trailerUrl && itunes.trailerUrl) result.trailerUrl = itunes.trailerUrl;
      if (!result.genre && itunes.genre) result.genre = itunes.genre;
    }
  }

  if (kind === 'series' && (!result.synopsis || !result.poster)) {
    const tvm = await fetchTvMaze(title, fetchJsonFn);
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
