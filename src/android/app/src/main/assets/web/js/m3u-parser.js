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

    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let epgUrl = null;
    const items = [];

    let currentItem = null;
    let currentGroup = 'Geral';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
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
        currentItem = null;
      }
    }

    const summary = {
      total: items.length,
      live: items.filter(x => x.type === ItemType.LIVE).length,
      movies: items.filter(x => x.type === ItemType.MOVIE).length,
      series: items.filter(x => x.type === ItemType.SERIES).length
    };

    return { epgUrl, items, summary };
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
      rawTitle: ''
    };

    // Separar parâmetros do nome (após a última vírgula do header de metadados)
    const commaIdx = line.indexOf(',');
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

    // Atributos chave=valor
    const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*["']([^"']*)["']/g;
    let match;
    while ((match = attrRegex.exec(line)) !== null) {
      const key = match[1].toLowerCase();
      const val = match[2].trim();

      if (key === 'tvg-id') item.tvgId = val;
      else if (key === 'tvg-name') item.tvgName = val;
      else if (key === 'tvg-logo') item.tvgLogo = val;
      else if (key === 'group-title') item.group = val;
    }

    item.name = titlePart || item.tvgName || 'Sem Nome';
    item.logo = item.tvgLogo || '';
    item.rawTitle = titlePart;
    item.id = item.tvgId || `${item.group}_${item.name}`.replace(/\s+/g, '_');

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
