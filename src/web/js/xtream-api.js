/**
 * FluiStream — Xtream Codes API Connector
 * Autenticação e consumo da API do player (player_api.php, get.php, xmltv.php)
 */

import { fetchRemoteText } from './network.js';

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
    if (!this.corsProxy) return targetUrl;
    const proxy = this.corsProxy.endsWith('/') ? this.corsProxy : `${this.corsProxy}/`;
    return `${proxy}${encodeURIComponent(targetUrl)}`;
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

      return {
        success: true,
        user: {
          username: userInfo.username || this.username,
          status: userInfo.status || 'Active',
          expDate: userInfo.exp_date ? new Date(parseInt(userInfo.exp_date, 10) * 1000) : null,
          expDateRaw: userInfo.exp_date,
          isTrial: (userInfo.is_trial === '1' || userInfo.is_trial === 1) ? 'Yes' : 'No',
          activeCons: userInfo.active_cons || '0',
          createdAt: userInfo.created_at ? new Date(parseInt(userInfo.created_at, 10) * 1000) : null,
          createdAtRaw: userInfo.created_at,
          maxConnections: userInfo.max_connections || '1'
        },
        server: data?.server_info || {},
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
   * Baixa a lista M3U Plus completa gerada pelo servidor Xtream
   */
  async fetchM3uContent() {
    const directUrl = this.getM3uUrl();
    const finalUrl = this.corsProxy ? this.applyProxy(directUrl) : directUrl;
    return await fetchRemoteText(finalUrl);
  }
}

