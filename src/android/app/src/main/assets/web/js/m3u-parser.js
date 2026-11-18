/**
 * FluiStream — M3U / M3U8 Parser & Intelligent Classifier
 * Extrai canais, metadados, EPG embutido (x-tvg-url) e classifica em:
 * 1. Ao Vivo (Live TV)
 * 2. Filmes (Movies / VOD)
 * 3. Séries (Series com detecção de temporadas/episódios)
 */

export const ItemType = {
  LIVE: 'live',
  MOVIE: 'movie',
  SERIES: 'series'
};

export class M3UParser {
  /**
   * Faz o parse de texto M3U completo
   * @param {string} content Conteúdo do arquivo M3U
   * @returns {{ epgUrl: string|null, items: Array, summary: Object }}
   */
  static parse(content) {
    if (!content || typeof content !== 'string') {
      return { epgUrl: null, items: [], summary: { total: 0, live: 0, movies: 0, series: 0 } };
    }

    let epgUrl = null;
    const items = [];
    let currentItem = null;
    let currentGroup = 'Geral';

    let liveCount = 0;
    let movieCount = 0;
    let seriesCount = 0;

    let lineStart = 0;
    const len = content.length;

    while (lineStart < len) {
      let lineEnd = content.indexOf('\n', lineStart);
      if (lineEnd === -1) lineEnd = len;

      let line = content.substring(lineStart, lineEnd);
      lineStart = lineEnd + 1;

      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      line = line.trim();
      if (!line) continue;

      // Cabeçalho #EXTM3U e extração de url-tvg / x-tvg-url
      if (line.startsWith('#EXTM3U')) {
        const tvgMatch = line.match(/(?:url-tvg|x-tvg-url)\s*=\s*["']([^"']+)["']/i);
        if (tvgMatch && tvgMatch[1]) {
          epgUrl = tvgMatch[1].trim();
        }
        continue;
      }

      // Diretiva de grupo avulsa (#EXTGRP:)
      if (line.startsWith('#EXTGRP:')) {
        currentGroup = line.substring(8).trim() || currentGroup;
        continue;
      }

      // Linha #EXTINF
      if (line.startsWith('#EXTINF:')) {
        currentItem = this.parseExtInf(line, currentGroup);
        continue;
      }

      // Outras diretivas que precedem o link (ex: #EXTVLCOPT)
      if (line.startsWith('#')) {
        continue;
      }

      // Linha de URL do stream
      if (currentItem && (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://') || line.startsWith('rtsp://') || line.startsWith('/'))) {
        currentItem.url = line;
        
        // Classificação inteligente do item
        const classified = this.classifyItem(currentItem);
        items.push(classified);
        if (classified.type === ItemType.LIVE) liveCount++;
        else if (classified.type === ItemType.MOVIE) movieCount++;
        else if (classified.type === ItemType.SERIES) seriesCount++;
        currentItem = null;
      }
    }

    this.ensureUniqueItemIds(items);

    const summary = {
      total: items.length,
      live: liveCount,
      movies: movieCount,
      series: seriesCount
    };

    return { epgUrl, items, summary };
  }

  /**
   * Garante ID único por item mesmo quando múltiplos canais (FHD/HD/SD) compartilham o mesmo tvg-id.
   */
  static ensureUniqueItemIds(items) {
    if (!Array.isArray(items)) return items;
    const seen = new Map();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const base = `${item.group || 'Geral'}_${item.name || item.id || 'item'}`.replace(/\s+/g, '_');
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      item.id = count > 0 ? `${base}__${count}` : base;
    }
    return items;
  }

  /**
   * Localiza a vírgula que separa os atributos #EXTINF do título do item, ignorando vírgulas entre aspas.
   */
  static findHeaderCommaIndex(line) {
    if (!line || typeof line !== 'string') return -1;
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (!inQuote && (ch === '"' || ch === "'")) {
        inQuote = true;
        quoteChar = ch;
      } else if (inQuote && ch === quoteChar) {
        inQuote = false;
        quoteChar = '';
      } else if (!inQuote && ch === ',') {
        return i;
      }
    }
    return inQuote ? line.lastIndexOf(',') : -1;
  }

  /**
   * Normaliza URLs de logos/capas para evitar falhas de DNS do provedor, hotlink 403, mixed content HTTP e hosts mortos.
   */
  static normalizeLogoUrl(rawUrl) {
    let u = String(rawUrl || '').trim();
    if (!u || u === 'assets/logo.svg') return '';
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('assets/')) return u;

    // Preserva URLs já roteadas pelos proxies de imagem
    if (/^https:\/\/(?:i0\.wp\.com|wsrv\.nl)\//i.test(u)) return u;

    // Reescreve cache TMDB morto de servidores Xtream (ex: tv.factoryiptv.com:80/images/<27-char>_small.jpg)
    const tmdbMatch = u.match(/^https?:\/\/[^/]*factoryiptv\.com(?::\d+)?\/images\/([a-zA-Z0-9]{26,32}?)(?:_(?:small|big))?\.(jpg|jpeg|png)$/i);
    if (tmdbMatch && !/^[a-f0-9]{32}$/i.test(tmdbMatch[1])) {
      return `https://image.tmdb.org/t/p/w600_and_h900_bestv2/${tmdbMatch[1]}.${tmdbMatch[2]}`;
    }

    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === 'app.fluistream.local') {
        return u;
      }

      // Hosts de logos mortos/expirados -> limpa para ativar o fallback imediato
      if (/(?:^|\.)(?:s\d+\.aconvert\.com|easypr1\.com|97j91\.xyz|the-img\.xyz)$/i.test(host)) {
        return '';
      }
      if (/(?:canalsaborearte\.uol\.com\.br\/wp-content\/uploads\/2024\/10\/SABOREARTE\.png|boasnovasfm\.com\.br\/admin\/assets\/img\/logo\.png|img\.elo7\.com\.br\/product\/.*maranata|tvmanabrasil\.com\/wp-content\/uploads\/2023\/05\/LOGO_TV_MANA|infonet\.com\.br\/wp-content\/uploads\/2019\/09\/legiao_boa_vontade)/i.test(u)) {
        return '';
      }

      if (host === 'static.wikia.nocookie.net') {
        u = u.replace(/\/revision\/latest.*$/i, '');
      }

      const isCustomPort = Boolean(parsed.port && parsed.port !== '80' && parsed.port !== '443');
      const isRawIp = /^(?:\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\])$/i.test(host);

      if (isCustomPort || isRawIp) {
        if (parsed.protocol === 'http:' && typeof window !== 'undefined' && typeof window.__fluiLocalProxyUrl === 'string' && window.__fluiLocalProxyUrl.trim()) {
          const base = window.__fluiLocalProxyUrl.trim();
          const prefix = base.endsWith('/') ? base : `${base}/`;
          return `${prefix}proxy?url=${encodeURIComponent(u)}`;
        }
        return u;
      }

      // Domínios bloqueados em DNS de operadoras, com hotlink 403 ou HTTP sem TLS -> roteia via HTTPS Photon CDN
      if (
        /(?:^|\.)(?:fontedecanais\.(?:io|gs|live|bz)|32q0d\.xyz|sportspro\.com|static\.wikia\.nocookie\.net)$/i.test(host) ||
        parsed.protocol === 'http:'
      ) {
        return `https://i0.wp.com/${u.replace(/^https?:\/\//i, '')}`;
      }
    } catch {
      return '';
    }

    return u;
  }

  /**
   * Extrai atributos da linha #EXTINF
   */
  static parseExtInf(line, defaultGroup = 'Geral') {
    const item = {
      id: '',
      name: '',
      logo: '',
      group: defaultGroup,
      tvgId: '',
      tvgName: '',
      tvgLogo: '',
      duration: -1,
      rawTitle: '',
      catchup: '',
      catchupDays: 0,
      catchupSource: '',
      tvgShift: 0,
      hasCatchup: false
    };

    // Separar parâmetros do nome (após a vírgula fora de aspas do header de metadados)
    const commaIdx = this.findHeaderCommaIndex(line);
    let paramsPart = line;
    let titlePart = '';

    if (commaIdx !== -1) {
      paramsPart = line.substring(0, commaIdx);
      titlePart = line.substring(commaIdx + 1).trim();
    }

    // Duração
    const durMatch = paramsPart.match(/^#EXTINF:(-?\d+)/);
    if (durMatch) {
      item.duration = parseInt(durMatch[1], 10);
    }

    // Atributos chave=valor (suporta aspas duplas, simples ou sem aspas)
    const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
    let match;
    while ((match = attrRegex.exec(paramsPart)) !== null) {
      const key = match[1].toLowerCase();
      const val = (match[2] ?? match[3] ?? match[4] ?? '').trim();

      if (key === 'tvg-id') item.tvgId = val;
      else if (key === 'tvg-name') item.tvgName = val;
      else if (key === 'tvg-logo') item.tvgLogo = val;
      else if (key === 'group-title') item.group = val;
      else if (key === 'catchup') item.catchup = val;
      else if (key === 'catchup-days') {
        const days = parseInt(val, 10);
        item.catchupDays = Number.isFinite(days) && days > 0 ? days : 0;
      } else if (key === 'catchup-source') item.catchupSource = val;
      else if (key === 'tvg-shift') {
        const shift = parseFloat(val);
        item.tvgShift = Number.isFinite(shift) ? shift : 0;
      }
    }

    const catchupNorm = item.catchup.toLowerCase();
    const hasCatchupMode = Boolean(catchupNorm) && !['0', 'false', 'none', 'off'].includes(catchupNorm);
    item.hasCatchup = hasCatchupMode || item.catchupDays > 0 || Boolean(item.catchupSource);

    item.name = titlePart || item.tvgName || 'Sem Nome';
    item.logo = this.normalizeLogoUrl(item.tvgLogo) || '';
    item.rawTitle = titlePart;
    item.id = `${item.group || 'Geral'}_${item.name}`.replace(/\s+/g, '_');

    return item;
  }

  /**
   * Classifica o item em Ao Vivo, Filmes ou Séries
   */
  static classifyItem(item) {
    const groupUpper = (item.group || '').toUpperCase();
    const nameUpper = (item.name || '').toUpperCase();
    const urlUpper = (item.url || '').toUpperCase();

    // 1. Detecção de Séries (Padrões de Temporada/Episódio no nome ou grupo)
    // S01E02, S1E1, T01E02, 1x02, Temporada 1 Ep 2
    const seriesRegex = /(?:S(\d+)\s*E(\d+)|T(\d+)\s*E(\d+)|(\d+)x(\d+)|TEMPORADA\s*(\d+).*?EP(?:ISODIO)?\s*(\d+))/i;
    const seriesMatch = item.name.match(seriesRegex);

    const isExplicitSeriesGroup = 
      groupUpper.includes('SERIE') || 
      groupUpper.includes('SÉRIE') || 
      groupUpper.includes('SERIES') || 
      groupUpper.includes('SEASON') || 
      groupUpper.includes('NOVELA') || 
      groupUpper.includes('ANIMES') ||
      groupUpper.includes('ANIME');

    const isXtreamSeriesUrl = urlUpper.includes('/SERIES/');

    if (seriesMatch || (isExplicitSeriesGroup && !groupUpper.includes('AO VIVO')) || isXtreamSeriesUrl) {
      item.type = ItemType.SERIES;
      
      // Extrair informações de temporada e episódio se presentes
      let season = 1;
      let episode = 1;
      let cleanSeriesTitle = item.name;

      if (seriesMatch) {
        season = parseInt(seriesMatch[1] || seriesMatch[3] || seriesMatch[5] || seriesMatch[7] || '1', 10);
        episode = parseInt(seriesMatch[2] || seriesMatch[4] || seriesMatch[6] || seriesMatch[8] || '1', 10);
        cleanSeriesTitle = item.name.substring(0, seriesMatch.index).trim().replace(/[-–|]+$/, '').trim();
      } else {
        // Tentar extrair do formato comum "Nome da Série - T01 E01"
        cleanSeriesTitle = item.name.replace(/\s*[-–]\s*(?:T|S)?\d+.*$/i, '').trim();
      }

      item.seriesTitle = cleanSeriesTitle || item.name;
      item.season = season;
      item.episode = episode;
      return item;
    }

    // 2. Detecção de Filmes (VOD)
    const isExplicitMovieGroup = 
      groupUpper.includes('FILME') || 
      groupUpper.includes('MOVIE') || 
      groupUpper.includes('VOD') || 
      groupUpper.includes('CINEMA') || 
      groupUpper.includes('LANÇAMENTO') || 
      groupUpper.includes('LANCAMENTO') ||
      groupUpper.includes('4K') ||
      groupUpper.includes('DUBLADO') ||
      groupUpper.includes('LEGENDADO');

    const isXtreamMovieUrl = urlUpper.includes('/MOVIE/');
    const isVodExtension = urlUpper.endsWith('.MP4') || urlUpper.endsWith('.MKV') || urlUpper.endsWith('.AVI');

    if (isExplicitMovieGroup || isXtreamMovieUrl || (isVodExtension && item.duration > 0 && !groupUpper.includes('LIVE'))) {
      item.type = ItemType.MOVIE;
      return item;
    }

    // 3. Padrão padrão: Canal Ao Vivo (Live TV)
    item.type = ItemType.LIVE;
    return item;
  }
}
