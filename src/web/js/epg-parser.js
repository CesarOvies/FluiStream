/**
 * FluiStream — XMLTV EPG Parser & Program Schedule Manager
 * Faz o parsing de guias XMLTV (canais e programas)
 * Suporta EPG embutido (x-tvg-url) ou EPG externo (anexo via URL ou arquivo).
 */

export class EPGParser {
  constructor() {
    this.channels = new Map(); // id -> { id, name, icon }
    this.programmes = new Map(); // channelId -> [{ title, desc, start, stop, category }]
  }

  /**
   * Converte string de data XMLTV 'YYYYMMDDHHMMSS +ZZZZ' para objeto Date
   * Exemplo: '20261111220000 -0300' ou '20261111190000 +0000'
   */
  static parseXmltvDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const clean = dateStr.trim();

    // Regex para YYYY MM DD HH mm ss opcionalmente com fuso (+/-HHMM)
    const match = clean.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
    if (!match) {
      const fallback = new Date(clean);
      return isNaN(fallback.getTime()) ? null : fallback;
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const min = parseInt(match[5], 10);
    const sec = parseInt(match[6], 10);
    const tz = match[7];

    if (tz) {
      const sign = tz[0] === '-' ? -1 : 1;
      const tzHours = parseInt(tz.substring(1, 3), 10);
      const tzMins = parseInt(tz.substring(3, 5), 10);
      const offsetMinutes = sign * (tzHours * 60 + tzMins);

      // Criar data UTC ajustando pelo fuso do EPG
      const utcMs = Date.UTC(year, month, day, hour, min, sec) - (offsetMinutes * 60 * 1000);
      return new Date(utcMs);
    }

    return new Date(year, month, day, hour, min, sec);
  }

  /**
   * Faz o parse do XML em string
   * @param {string} xmlString Conteúdo XMLTV
   * @returns {EPGParser} Instância com canais e programas populados
   */
  parse(xmlString) {
    this.channels.clear();
    this.programmes.clear();

    if (!xmlString || typeof xmlString !== 'string') return this;

    // Se DOMParser estiver disponível (ambiente do navegador)
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'text/xml');

      // 1. Canais (<channel id="...">)
      const channelNodes = doc.querySelectorAll('channel');
      channelNodes.forEach(ch => {
        const id = ch.getAttribute('id') || '';
        if (!id) return;

        const nameNode = ch.querySelector('display-name');
        const iconNode = ch.querySelector('icon');
        const name = nameNode ? nameNode.textContent.trim() : id;
        const icon = iconNode ? iconNode.getAttribute('src') || '' : '';

        this.channels.set(id, { id, name, icon });
      });

      // 2. Programas (<programme start="..." stop="..." channel="...">)
      const progNodes = doc.querySelectorAll('programme');
      progNodes.forEach(pr => {
        const channelId = pr.getAttribute('channel') || '';
        const startStr = pr.getAttribute('start') || '';
        const stopStr = pr.getAttribute('stop') || '';

        if (!channelId || !startStr || !stopStr) return;

        const titleNode = pr.querySelector('title');
        const descNode = pr.querySelector('desc');
        const catNode = pr.querySelector('category');

        const title = titleNode ? titleNode.textContent.trim() : 'Sem Título';
        const desc = descNode ? descNode.textContent.trim() : '';
        const category = catNode ? catNode.textContent.trim() : '';
        const start = EPGParser.parseXmltvDate(startStr);
        const stop = EPGParser.parseXmltvDate(stopStr);

        if (!start || !stop) return;

        if (!this.programmes.has(channelId)) {
          this.programmes.set(channelId, []);
        }

        this.programmes.get(channelId).push({
          title,
          desc,
          category,
          start,
          stop
        });
      });
    } else {
      // Fallback universal leve via regex (para Node.js / CLI / WebWorker)
      const channelRegex = /<channel\s+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/channel>/gi;
      let chMatch;
      while ((chMatch = channelRegex.exec(xmlString)) !== null) {
        const id = chMatch[1];
        const body = chMatch[2];
        const nameMatch = body.match(/<display-name[^>]*>([^<]+)<\/display-name>/i);
        const iconMatch = body.match(/<icon\s+src=["']([^"']+)["']/i);
        const name = nameMatch ? nameMatch[1].trim() : id;
        const icon = iconMatch ? iconMatch[1].trim() : '';
        this.channels.set(id, { id, name, icon });
      }

      const progRegex = /<programme\s+([^>]*?)>([\s\S]*?)<\/programme>/gi;
      let prMatch;
      while ((prMatch = progRegex.exec(xmlString)) !== null) {
        const attrs = prMatch[1];
        const body = prMatch[2];

        const chMatchAttr = attrs.match(/channel=["']([^"']+)["']/i);
        const startMatch = attrs.match(/start=["']([^"']+)["']/i);
        const stopMatch = attrs.match(/stop=["']([^"']+)["']/i);

        if (!chMatchAttr || !startMatch || !stopMatch) continue;

        const channelId = chMatchAttr[1];
        const start = EPGParser.parseXmltvDate(startMatch[1]);
        const stop = EPGParser.parseXmltvDate(stopMatch[1]);
        if (!start || !stop) continue;

        const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = body.match(/<desc[^>]*>([^<]+)<\/desc>/i);
        const catMatch = body.match(/<category[^>]*>([^<]+)<\/category>/i);

        const title = titleMatch ? titleMatch[1].trim() : 'Sem Título';
        const desc = descMatch ? descMatch[1].trim() : '';
        const category = catMatch ? catMatch[1].trim() : '';

        if (!this.programmes.has(channelId)) {
          this.programmes.set(channelId, []);
        }

        this.programmes.get(channelId).push({
          title,
          desc,
          category,
          start,
          stop
        });
      }
    }

    // Ordenar programas de cada canal por horário de início
    for (const [_, progs] of this.programmes.entries()) {
      progs.sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    return this;
  }

  /**
   * Encontra a lista de programas para um canal buscando por tvg-id ou nome
   */
  getChannelPrograms(tvgId, channelName = '') {
    if (tvgId && this.programmes.has(tvgId)) {
      return this.programmes.get(tvgId);
    }

    // Busca alternativa por aproximação de nome
    if (channelName) {
      const cleanName = channelName.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [id, ch] of this.channels.entries()) {
        const cleanChName = (ch.name || id).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanChName && (cleanName.includes(cleanChName) || cleanChName.includes(cleanName))) {
          if (this.programmes.has(id)) {
            return this.programmes.get(id);
          }
        }
      }
    }

    return [];
  }

  /**
   * Obtém o programa em exibição no momento
   */
  getCurrentProgram(tvgId, channelName = '', now = new Date()) {
    const progs = this.getChannelPrograms(tvgId, channelName);
    if (!progs || progs.length === 0) return null;

    const nowTime = now.getTime();
    for (const p of progs) {
      if (nowTime >= p.start.getTime() && nowTime < p.stop.getTime()) {
        const totalDuration = p.stop.getTime() - p.start.getTime();
        const elapsed = nowTime - p.start.getTime();
        const progress = totalDuration > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100))) : 0;
        const remainingMinutes = Math.max(0, Math.round((p.stop.getTime() - nowTime) / 60000));

        return {
          ...p,
          progress,
          remainingMinutes,
          formattedStart: this.formatTime(p.start),
          formattedStop: this.formatTime(p.stop)
        };
      }
    }

    return null;
  }

  /**
   * Obtém os próximos programas agendados
   */
  getUpcomingPrograms(tvgId, channelName = '', limit = 5, now = new Date()) {
    const progs = this.getChannelPrograms(tvgId, channelName);
    if (!progs || progs.length === 0) return [];

    const nowTime = now.getTime();
    const upcoming = [];

    for (const p of progs) {
      if (p.start.getTime() > nowTime) {
        upcoming.push({
          ...p,
          formattedStart: this.formatTime(p.start),
          formattedStop: this.formatTime(p.stop)
        });
        if (upcoming.length >= limit) break;
      }
    }

    return upcoming;
  }

  formatTime(date) {
    if (!date) return '';
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}
