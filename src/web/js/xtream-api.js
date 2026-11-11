/**
 * FluiStream — Xtream Codes API Connector
 * Autenticação e consumo da API do player (player_api.php, get.php, xmltv.php)
 */

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
      const response = await fetch(finalUrl, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ao conectar à API Xtream Codes`);
      }

      const data = await response.json();
      const userInfo = data?.user_info;

      if (!userInfo || userInfo.auth === 0 || userInfo.status !== 'Active') {
        const msg = userInfo?.message || 'Credenciais inválidas ou conta inativa';
        throw new Error(msg);
      }

      return {
        success: true,
        user: {
          username: userInfo.username,
          status: userInfo.status,
          expDate: userInfo.exp_date ? new Date(parseInt(userInfo.exp_date, 10) * 1000) : null,
          maxConnections: userInfo.max_connections,
          activeCons: userInfo.active_cons
        },
        server: data?.server_info || {},
        m3uUrl: this.getM3uUrl(),
        epgUrl: this.getEpgUrl()
      };
    } catch (err) {
      // Se falhar e não estiver usando proxy, ou se der erro de CORS na web
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

    const response = await fetch(finalUrl);
    if (!response.ok) {
      throw new Error(`Falha ao baixar M3U: HTTP ${response.status}`);
    }
    return await response.text();
  }
}
