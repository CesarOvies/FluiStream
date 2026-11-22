/**
 * FluiStream — Xtream Codes API Connector
 * Autenticação e consumo da API do player (player_api.php, get.php, xmltv.php)
 */

import { fetchRemoteText, applyCorsProxy } from './network.js';
import { M3UParser, ItemType } from './m3u-parser.js';

export class XtreamApi {
  constructor(serverUrl, username, password, corsProxy = '') {
    this.serverUrl = this.normalizeUrl(serverUrl);
    this.username = (username || '').trim();
    this.password = (password || '').trim();
    this.corsProxy = (corsProxy || '').trim();
  }

  normalizeUrl(url) {
    if (!url) return '';
    let clean = url.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    return clean.replace(/\/+$/, '');
  }

  applyProxy(targetUrl) {
    if (!this.corsProxy || !targetUrl) return targetUrl;
    return applyCorsProxy(this.corsProxy, targetUrl);
  }

  getM3uUrl() {
    return `${this.serverUrl}/get.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}&type=m3u_plus&output=m3u8`;
  }

  getEpgUrl() {
    return `${this.serverUrl}/xmltv.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
  }

  getPlayerApiUrl(action = '') {
    let url = `${this.serverUrl}/player_api.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
    if (action) {
      url += `&action=${encodeURIComponent(action)}`;
    }
    return url;
  }

  /**
   * Autentica com o servidor Xtream Codes e valida status da conta
   */
  async authenticate() {
    const directUrl = this.getPlayerApiUrl();
    const finalUrl = this.corsProxy ? this.applyProxy(directUrl) : directUrl;

    try {
      const text = await fetchRemoteText(finalUrl);
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error('Servidor não retornou JSON válido ao autenticar');
      }

      const userInfo = data?.user_info;

      if (!userInfo || userInfo.auth === 0 || userInfo.status !== 'Active') {
        const msg = userInfo?.message || 'Credenciais inválidas ou conta inativa';
        throw new Error(msg);
      }

      const accountInfo = {
        username: userInfo.username || this.username,
        status: userInfo.status || 'Active',
        expDate: userInfo.exp_date ? new Date(parseInt(userInfo.exp_date, 10) * 1000) : null,
        expDateRaw: userInfo.exp_date,
        isTrial: (userInfo.is_trial === '1' || userInfo.is_trial === 1) ? 'Yes' : 'No',
        activeCons: userInfo.active_cons || '0',
        createdAt: userInfo.created_at ? new Date(parseInt(userInfo.created_at, 10) * 1000) : null,
        createdAtRaw: userInfo.created_at,
        maxConnections: userInfo.max_connections || '1'
      };
      const serverInfo = data?.server_info || null;

      return {
        success: true,
        user: accountInfo,
        accountInfo,
        server: serverInfo || {},
        serverInfo,
        m3uUrl: this.getM3uUrl(),
        epgUrl: this.getEpgUrl()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Falha de comunicação com o servidor Xtream Codes'
      };
    }
  }

  /**
   * URL para consulta de metadados e sinopse de filme VOD (action=get_vod_info)
   */
  getVodInfoUrl(vodId) {
    return `${this.serverUrl}/player_api.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}&action=get_vod_info&vod_id=${encodeURIComponent(String(vodId))}`;
  }

  getSeriesInfoUrl(seriesId) {
    return `${this.serverUrl}/player_api.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}&action=get_series_info&series_id=${encodeURIComponent(String(seriesId))}`;
  }

  buildSeriesEpisodeUrl(episodeId, ext = 'mp4') {
    const safeExt = String(ext || 'mp4').replace(/^\./, '') || 'mp4';
    return `${this.serverUrl}/series/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${encodeURIComponent(String(episodeId))}.${safeExt}`;
  }

  async _fetchJsonEndpoint(directUrl, timeoutMs = 45000) {
    const finalUrl = this.corsProxy ? this.applyProxy(directUrl) : directUrl;
    const text = await fetchRemoteText(finalUrl, timeoutMs);
    return JSON.parse(text);
  }

  /**
   * Obtém detalhes, temporadas e episódios de uma série no servidor Xtream (action=get_series_info)
   */
  async getSeriesInfo(seriesId) {
    if (!seriesId) return null;
    try {
      const data = await this._fetchJsonEndpoint(this.getSeriesInfoUrl(seriesId), 45000);
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  /**
   * Obtém detalhes, sinopse e trailer de um filme VOD no servidor Xtream
   */
  async getVodInfo(vodId) {
    if (!vodId) return null;
    try {
      const data = await this._fetchJsonEndpoint(this.getVodInfoUrl(vodId), 45000);
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  async _fetchCategoryMap(action, timeoutMs = 30000) {
    const map = new Map();
    try {
      const list = await this._fetchJsonEndpoint(this.getPlayerApiUrl(action), timeoutMs);
      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const cat = list[i];
          if (!cat || cat.category_id === undefined || cat.category_id === null) continue;
          const label = String(cat.category_name || '').trim();
          if (label) map.set(String(cat.category_id), label);
        }
      }
    } catch {
      // Categories are optional metadata; continue with fallback names
    }
    return map;
  }

  /**
   * Carrega catálogo Xtream via endpoints JSON leves (evita get.php gigantes em TVs com pouca RAM).
   * Episódios de séries são carregados sob demanda via getSeriesInfo(seriesId).
   */
  async fetchStructuredCatalog({ sectionType = null, onProgress = null, maxItems = 0, liveExtension = 'm3u8', timeoutMs = 45000 } = {}) {
    const items = [];
    let liveCount = 0;
    let movieCount = 0;
    let seriesCount = 0;
    let truncated = false;
    let succeededSections = 0;
    const limit = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : 0;
    const wantAll = !sectionType;
    const safeUser = encodeURIComponent(this.username);
    const safePass = encodeURIComponent(this.password);

    const canPushMore = () => !(limit > 0 && items.length >= limit);

    if ((wantAll || sectionType === ItemType.LIVE) && canPushMore()) {
      onProgress?.({ stage: 'live', count: items.length });
      const catMap = await this._fetchCategoryMap('get_live_categories', timeoutMs);
      try {
        const list = await this._fetchJsonEndpoint(this.getPlayerApiUrl('get_live_streams'), timeoutMs);
        if (Array.isArray(list)) {
          succeededSections++;
          for (let i = 0; i < list.length; i++) {
            if (!canPushMore()) { truncated = true; break; }
            const entry = list[i];
            const streamId = entry?.stream_id ?? entry?.id;
            if (!streamId) continue;
            const name = String(entry.name || 'Sem Nome').trim() || 'Sem Nome';
            const group = catMap.get(String(entry.category_id ?? '')) || String(entry.category_name || '').trim() || 'Ao Vivo';
            const catchupDays = parseInt(entry.tv_archive_duration, 10);
            const hasCatchup = Boolean(Number(entry.tv_archive) > 0) || (Number.isFinite(catchupDays) && catchupDays > 0);
            items.push({
              id: '',
              name,
              tvgId: entry.epg_channel_id ? String(entry.epg_channel_id) : '',
              tvgName: name,
              tvgLogo: entry.stream_icon ? String(entry.stream_icon) : '',
              logo: M3UParser.normalizeLogoUrl(entry.stream_icon || ''),
              group,
              url: `${this.serverUrl}/live/${safeUser}/${safePass}/${encodeURIComponent(String(streamId))}.${liveExtension}`,
              type: ItemType.LIVE,
              hasCatchup,
              catchupDays: Number.isFinite(catchupDays) && catchupDays > 0 ? catchupDays : 0
            });
            liveCount++;
          }
        }
      } catch {
        // Ignore single section error so fallback can run if needed
      }
    }

    if ((wantAll || sectionType === ItemType.MOVIE) && canPushMore()) {
      onProgress?.({ stage: 'movie', count: items.length });
      const catMap = await this._fetchCategoryMap('get_vod_categories', timeoutMs);
      try {
        const list = await this._fetchJsonEndpoint(this.getPlayerApiUrl('get_vod_streams'), timeoutMs);
        if (Array.isArray(list)) {
          succeededSections++;
          for (let i = 0; i < list.length; i++) {
            if (!canPushMore()) { truncated = true; break; }
            const entry = list[i];
            const streamId = entry?.stream_id ?? entry?.id;
            if (!streamId) continue;
            const name = String(entry.name || 'Filme').trim() || 'Filme';
            const group = catMap.get(String(entry.category_id ?? '')) || String(entry.category_name || '').trim() || 'Filmes';
            const ext = String(entry.container_extension || 'mp4').replace(/^\./, '') || 'mp4';
            items.push({
              id: '',
              name,
              tvgId: '',
              tvgName: name,
              tvgLogo: entry.stream_icon ? String(entry.stream_icon) : '',
              logo: M3UParser.normalizeLogoUrl(entry.stream_icon || ''),
              group,
              url: `${this.serverUrl}/movie/${safeUser}/${safePass}/${encodeURIComponent(String(streamId))}.${ext}`,
              type: ItemType.MOVIE,
              duration: parseInt(entry.duration, 10) || 0
            });
            movieCount++;
          }
        }
      } catch {
        // Ignore single section error
      }
    }

    if ((wantAll || sectionType === ItemType.SERIES) && canPushMore()) {
      onProgress?.({ stage: 'series', count: items.length });
      const catMap = await this._fetchCategoryMap('get_series_categories', timeoutMs);
      try {
        const list = await this._fetchJsonEndpoint(this.getPlayerApiUrl('get_series'), timeoutMs);
        if (Array.isArray(list)) {
          succeededSections++;
          for (let i = 0; i < list.length; i++) {
            if (!canPushMore()) { truncated = true; break; }
            const entry = list[i];
            const seriesId = entry?.series_id ?? entry?.id;
            if (!seriesId) continue;
            const name = String(entry.name || 'Série').trim() || 'Série';
            const group = catMap.get(String(entry.category_id ?? '')) || String(entry.category_name || '').trim() || 'Séries';
            items.push({
              id: '',
              name,
              seriesTitle: name,
              tvgId: '',
              tvgName: name,
              tvgLogo: entry.cover ? String(entry.cover) : '',
              logo: M3UParser.normalizeLogoUrl(entry.cover || ''),
              group,
              url: '',
              season: 1,
              episode: 1,
              xtreamSeriesId: String(seriesId),
              desc: entry.plot ? String(entry.plot).trim().slice(0, 320) : '',
              genre: entry.genre ? String(entry.genre).trim() : '',
              isLazySeriesPlaceholder: true,
              type: ItemType.SERIES
            });
            seriesCount++;
          }
        }
      } catch {
        // Ignore single section error
      }
    }

    if (succeededSections === 0 || items.length === 0) {
      return null;
    }

    M3UParser.ensureUniqueItemIds(items);
    return {
      epgUrl: this.getEpgUrl(),
      items,
      truncated,
      structured: true,
      summary: {
        total: items.length,
        live: liveCount,
        movies: movieCount,
        series: seriesCount
      }
    };
  }

  /**
   * Baixa a lista M3U Plus completa gerada pelo servidor Xtream
   */
  async fetchM3uContent(timeoutMs = 120000) {
    const directUrl = this.getM3uUrl();
    const finalUrl = this.corsProxy ? this.applyProxy(directUrl) : directUrl;
    return await fetchRemoteText(finalUrl, timeoutMs);
  }
}

