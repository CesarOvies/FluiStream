/**
 * FluiStream — XMLTV EPG Parser & High-Performance Program Schedule Manager
 * Parsing ultra-rápido de guias XMLTV com indexação reversa multi-apelidos (display-name).
 * Suporta canais com dezenas de variantes (FHD, HD, 4K, SD, etc.) e correspondência O(1).
 */

export class EPGParser {
  constructor() {
    this.channels = new Map(); // id -> { id, name, icon }
    this.nameIndex = new Map(); // normalized_alias -> channelId
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
   * Normaliza chave de nome para busca agnóstica a símbolos, acentos e maiúsculas
   */
  static normalizeKey(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Remove sufixos comuns de qualidade / codec de nomes de canais
   */
  static stripQuality(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/\[\s*(?:fhd|uhd|4k|hd|sd|hevc|h265|h264|1080p|720p)\s*\]/gi, ' ')
      .replace(/\(\s*(?:fhd|uhd|4k|hd|sd|hevc|h265|h264|1080p|720p)\s*\)/gi, ' ')
      .replace(/\b(?:fhd|uhd|4k|hd|sd|hevc|h265|h264|1080p|720p)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Faz o parsing ultra-rápido do XMLTV em string
   * @param {string} xmlString Conteúdo XMLTV
   * @returns {EPGParser} Instância com canais e programas populados
   */
  parse(xmlString) {
    this.channels.clear();
    this.nameIndex.clear();
    this.programmes.clear();

    if (!xmlString || typeof xmlString !== 'string') return this;

    // 1. Parsing de Canais e indexação de todos os <display-name>
    const chRegex = /<channel\s+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/channel>/gi;
    let chMatch;
    while ((chMatch = chRegex.exec(xmlString)) !== null) {
      const id = chMatch[1];
      const body = chMatch[2];
      const iconMatch = body.match(/<icon\s+src=["']([^"']+)["']/i);
      const icon = iconMatch ? iconMatch[1] : '';

      const names = [];
      const nameRegex = /<display-name[^>]*>([^<]+)<\/display-name>/gi;
      let nm;
      while ((nm = nameRegex.exec(body)) !== null) {
        names.push(nm[1].trim());
      }
      const primaryName = names[0] || id;
      this.channels.set(id, { id, name: primaryName, names, icon });

      // Indexa o ID original e normalizado
      this.nameIndex.set(id.toLowerCase(), id);
      const cleanId = EPGParser.normalizeKey(id);
      if (cleanId) this.nameIndex.set(cleanId, id);

      // Indexa cada um dos display-names / aliases do canal
      for (const n of names) {
        const cleanName = EPGParser.normalizeKey(n);
        if (cleanName) {
          this.nameIndex.set(cleanName, id);
        }
        const stripped = EPGParser.normalizeKey(EPGParser.stripQuality(n));
        if (stripped && !this.nameIndex.has(stripped)) {
          this.nameIndex.set(stripped, id);
        }
      }
    }

    // 2. Parsing de Programas (<programme start="..." stop="..." channel="...">)
    const prRegex = /<programme\s+([^>]*?)>([\s\S]*?)<\/programme>/gi;
    let prMatch;
    while ((prMatch = prRegex.exec(xmlString)) !== null) {
      const attrs = prMatch[1];
      const body = prMatch[2];

      const startM = attrs.match(/start=["']([^"']+)["']/i);
      const stopM = attrs.match(/stop=["']([^"']+)["']/i);
      const chM = attrs.match(/channel=["']([^"']+)["']/i);
      if (!startM || !stopM || !chM) continue;

      const channelId = chM[1];
      const start = EPGParser.parseXmltvDate(startM[1]);
      const stop = EPGParser.parseXmltvDate(stopM[1]);
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

    // Ordenar programas de cada canal por horário de início
    for (const [_, progs] of this.programmes.entries()) {
      progs.sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    return this;
  }

  /**
   * Resolve o ID canônico de canal pelo tvgId ou nome
   */
  resolveChannelId(tvgId, channelName = '') {
    // 1. tvgId exato em programmes
    if (tvgId && this.programmes.has(tvgId)) {
      return tvgId;
    }

    // 2. tvgId no índice de nomes
    if (tvgId) {
      const cleanTvg = EPGParser.normalizeKey(tvgId);
      if (this.nameIndex.has(cleanTvg)) {
        const id = this.nameIndex.get(cleanTvg);
        if (this.programmes.has(id)) return id;
      }
    }

    // 3. channelName direto no índice
    if (channelName) {
      const cleanName = EPGParser.normalizeKey(channelName);
      if (this.nameIndex.has(cleanName)) {
        const id = this.nameIndex.get(cleanName);
        if (this.programmes.has(id)) return id;
      }

      // 4. channelName sem tags de resolução (ex: FHD, HD, 4K)
      const strippedClean = EPGParser.normalizeKey(EPGParser.stripQuality(channelName));
      if (strippedClean && this.nameIndex.has(strippedClean)) {
        const id = this.nameIndex.get(strippedClean);
        if (this.programmes.has(id)) return id;
      }

      // 5. Varredura com prefixo/substring se necessário
      for (const [alias, id] of this.nameIndex.entries()) {
        if (alias.length >= 4 && (cleanName.includes(alias) || alias.includes(cleanName))) {
          if (this.programmes.has(id)) return id;
        }
      }
    }

    return null;
  }

  /**
   * Encontra a lista de programas para um canal buscando por tvg-id ou nome
   */
  getChannelPrograms(tvgId, channelName = '') {
    const matchedId = this.resolveChannelId(tvgId, channelName);
    if (matchedId && this.programmes.has(matchedId)) {
      return this.programmes.get(matchedId);
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
