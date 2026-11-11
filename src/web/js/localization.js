/**
 * FluiStream — Localization Service (i18n)
 * Suporte obrigatório a 3 idiomas: pt-BR, en-US, es.
 * Padrão Cesar Ovies Engineering Standards.
 */

export const SupportedLanguages = {
  PT_BR: 'pt-BR',
  EN_US: 'en-US',
  ES: 'es'
};

export const translations = {
  'pt-BR': {
    appName: 'FluiStream',
    appTagline: 'Reprodutor Fluido de Listas M3U, EPG e Xtream Codes',
    navLive: 'Ao Vivo',
    navMovies: 'Filmes',
    navSeries: 'Séries',
    navFavorites: 'Favoritos',
    navEpg: 'Guia de TV (EPG)',
    navImport: 'Importar Lista',
    navSettings: 'Configurações',
    searchPlaceholder: 'Buscar canais, filmes ou séries...',
    filterAll: 'Todas as Categorias',
    allCategories: 'Todas as Categorias',
    nowPlaying: 'Reproduzindo Agora',
    nextProgram: 'A Seguir',
    noEpgAvailable: 'Guia de programação não disponível para este canal',
    epgTimeRemaining: 'restantes',
    channelCount: '{count} itens',
    emptyListTitle: 'Nenhuma lista carregada',
    emptyListDesc: 'Importe sua lista M3U via arquivo local, URL ou conecte sua conta Xtream Codes para começar.',
    btnImportNow: 'Importar Lista Agora',
    btnLoadSample: 'Carregar Lista de Demonstração',
    tabFile: 'Arquivo Local',
    tabUrl: 'URL da Lista',
    tabXtream: 'API Xtream Codes',
    labelPlaylistName: 'Nome da Lista (opcional)',
    labelFileSelect: 'Selecione ou arraste seu arquivo .m3u ou .m3u8',
    labelUrlInput: 'URL da Lista M3U / M3U8',
    labelServerUrl: 'URL do Servidor (ex: http://servidor.com:8080)',
    labelUsername: 'Usuário',
    labelPassword: 'Senha',
    labelExternalEpg: 'EPG Externo (URL XMLTV opcional)',
    labelUseEmbeddedEpg: 'Usar EPG embutido na lista se disponível',
    btnConfirmImport: 'Carregar Lista',
    btnCancel: 'Cancelar',
    btnSave: 'Salvar',
    btnClear: 'Limpar',
    statusParsingM3u: 'Processando lista M3U...',
    statusParsingEpg: 'Baixando e processando EPG...',
    statusAuthenticatingXtream: 'Autenticando na API Xtream Codes...',
    statusSuccessLoaded: 'Lista carregada com sucesso!',
    errorM3uEmpty: 'O arquivo ou URL não contém canais válidos.',
    errorNetwork: 'Falha ao conectar ao servidor. Verifique a URL ou o CORS.',
    errorXtreamAuth: 'Credenciais inválidas na API Xtream Codes.',
    playerLiveBadge: 'AO VIVO',
    playerVodBadge: 'VOD',
    playerAspectRatio: 'Proporção',
    playerAspectAuto: 'Automático',
    playerAspect169: '16:9 (Widescreen)',
    playerAspect43: '4:3 (Clássico)',
    playerAspectFill: 'Preencher Tela',
    playerQuality: 'Qualidade',
    playerAudio: 'Áudio',
    playerSubtitles: 'Legendas',
    playerPip: 'Picture-in-Picture',
    playerFullscreen: 'Tela Cheia',
    playerMute: 'Mudo',
    playerVolume: 'Volume',
    playerPrevChannel: 'Canal Anterior',
    playerNextChannel: 'Próximo Canal',
    favoritesEmpty: 'Você ainda não adicionou nenhum canal aos favoritos.',
    epgScheduleTitle: 'Grade de Programação',
    epgTimelineNow: 'Agora',
    epgNoData: 'Sem dados de guia',
    settingsTitle: 'Configurações do Player',
    settingsLanguage: 'Idioma da Interface',
    settingsCorsProxy: 'Proxy CORS (para URLs que bloqueiam navegadores)',
    settingsCorsHelp: 'Usado na versão Web para contornar restrições CORS de streams remotos. O app Portable não necessita de proxy.',
    settingsClearData: 'Limpar Todos os Dados Salvos',
    settingsClearConfirm: 'Deseja realmente apagar todas as listas, EPGs e favoritos salvos?',
    settingsAbout: 'Sobre o FluiStream',
    settingsVersion: 'Versão 1.0.0 — Padrão Cesar Ovies',
    footerRights: 'Todos os direitos reservados.',
    season: 'Temporada',
    episode: 'Episódio',
    seriesEpisodesCount: '{count} episódios'
  },
  'en-US': {
    appName: 'FluiStream',
    appTagline: 'Fluid M3U Playlist, EPG and Xtream Codes Player',
    navLive: 'Live TV',
    navMovies: 'Movies',
    navSeries: 'Series',
    navFavorites: 'Favorites',
    navEpg: 'TV Guide (EPG)',
    navImport: 'Import Playlist',
    navSettings: 'Settings',
    searchPlaceholder: 'Search channels, movies or series...',
    filterAll: 'All Categories',
    allCategories: 'All Categories',
    nowPlaying: 'Now Playing',
    nextProgram: 'Up Next',
    noEpgAvailable: 'Electronic Programme Guide not available for this channel',
    epgTimeRemaining: 'remaining',
    channelCount: '{count} items',
    emptyListTitle: 'No playlist loaded',
    emptyListDesc: 'Import your M3U playlist via local file, URL or connect with Xtream Codes to start watching.',
    btnImportNow: 'Import Playlist Now',
    btnLoadSample: 'Load Demo Playlist',
    tabFile: 'Local File',
    tabUrl: 'Playlist URL',
    tabXtream: 'Xtream Codes API',
    labelPlaylistName: 'Playlist Name (optional)',
    labelFileSelect: 'Select or drag your .m3u or .m3u8 file',
    labelUrlInput: 'M3U / M3U8 Playlist URL',
    labelServerUrl: 'Server URL (e.g. http://server.com:8080)',
    labelUsername: 'Username',
    labelPassword: 'Password',
    labelExternalEpg: 'External EPG (optional XMLTV URL)',
    labelUseEmbeddedEpg: 'Use embedded EPG from playlist when available',
    btnConfirmImport: 'Load Playlist',
    btnCancel: 'Cancel',
    btnSave: 'Save',
    btnClear: 'Clear',
    statusParsingM3u: 'Parsing M3U playlist...',
    statusParsingEpg: 'Downloading and parsing EPG...',
    statusAuthenticatingXtream: 'Authenticating with Xtream Codes API...',
    statusSuccessLoaded: 'Playlist loaded successfully!',
    errorM3uEmpty: 'The file or URL contains no valid channels.',
    errorNetwork: 'Failed to connect to server. Check URL or CORS settings.',
    errorXtreamAuth: 'Invalid credentials on Xtream Codes API.',
    playerLiveBadge: 'LIVE',
    playerVodBadge: 'VOD',
    playerAspectRatio: 'Aspect Ratio',
    playerAspectAuto: 'Auto',
    playerAspect169: '16:9 (Widescreen)',
    playerAspect43: '4:3 (Classic)',
    playerAspectFill: 'Fill Screen',
    playerQuality: 'Quality',
    playerAudio: 'Audio',
    playerSubtitles: 'Subtitles',
    playerPip: 'Picture-in-Picture',
    playerFullscreen: 'Fullscreen',
    playerMute: 'Mute',
    playerVolume: 'Volume',
    playerPrevChannel: 'Previous Channel',
    playerNextChannel: 'Next Channel',
    favoritesEmpty: 'You have not added any channel to your favorites yet.',
    epgScheduleTitle: 'Programme Schedule',
    epgTimelineNow: 'Now',
    epgNoData: 'No guide data',
    settingsTitle: 'Player Settings',
    settingsLanguage: 'Interface Language',
    settingsCorsProxy: 'CORS Proxy (for URLs blocking browsers)',
    settingsCorsHelp: 'Used on Web version to bypass CORS restrictions on remote streams. Portable app does not require a proxy.',
    settingsClearData: 'Clear All Stored Data',
    settingsClearConfirm: 'Are you sure you want to delete all saved playlists, EPGs and favorites?',
    settingsAbout: 'About FluiStream',
    settingsVersion: 'Version 1.0.0 — Cesar Ovies Standards',
    footerRights: 'All rights reserved.',
    season: 'Season',
    episode: 'Episode',
    seriesEpisodesCount: '{count} episodes'
  },
  'es': {
    appName: 'FluiStream',
    appTagline: 'Reproductor Fluido de Listas M3U, EPG y Xtream Codes',
    navLive: 'En Vivo',
    navMovies: 'Películas',
    navSeries: 'Series',
    navFavorites: 'Favoritos',
    navEpg: 'Guía de TV (EPG)',
    navImport: 'Importar Lista',
    navSettings: 'Configuración',
    searchPlaceholder: 'Buscar canales, películas o series...',
    filterAll: 'Todas las Categorías',
    allCategories: 'Todas las Categorías',
    nowPlaying: 'Reproduciendo Ahora',
    nextProgram: 'A Continuación',
    noEpgAvailable: 'Guía de programación no disponible para este canal',
    epgTimeRemaining: 'restantes',
    channelCount: '{count} elementos',
    emptyListTitle: 'Ninguna lista cargada',
    emptyListDesc: 'Importe su lista M3U mediante archivo local, URL o conecte su cuenta Xtream Codes para comenzar.',
    btnImportNow: 'Importar Lista Ahora',
    btnLoadSample: 'Cargar Lista de Demostración',
    tabFile: 'Archivo Local',
    tabUrl: 'URL de la Lista',
    tabXtream: 'API Xtream Codes',
    labelPlaylistName: 'Nombre de la Lista (opcional)',
    labelFileSelect: 'Seleccione o arrastre su archivo .m3u o .m3u8',
    labelUrlInput: 'URL de la Lista M3U / M3U8',
    labelServerUrl: 'URL del Servidor (ej: http://servidor.com:8080)',
    labelUsername: 'Usuario',
    labelPassword: 'Password / Contraseña',
    labelExternalEpg: 'EPG Externo (URL XMLTV opcional)',
    labelUseEmbeddedEpg: 'Usar EPG integrado en la lista si está disponible',
    btnConfirmImport: 'Cargar Lista',
    btnCancel: 'Cancelar',
    btnSave: 'Guardar',
    btnClear: 'Limpiar',
    statusParsingM3u: 'Procesando lista M3U...',
    statusParsingEpg: 'Descargando y procesando EPG...',
    statusAuthenticatingXtream: 'Autenticando en la API Xtream Codes...',
    statusSuccessLoaded: '¡Lista cargada con éxito!',
    errorM3uEmpty: 'El archivo o URL no contiene canales válidos.',
    errorNetwork: 'Error al conectar al servidor. Verifique la URL o el CORS.',
    errorXtreamAuth: 'Credenciales inválidas en la API Xtream Codes.',
    playerLiveBadge: 'EN VIVO',
    playerVodBadge: 'VOD',
    playerAspectRatio: 'Proporción',
    playerAspectAuto: 'Automático',
    playerAspect169: '16:9 (Panorámico)',
    playerAspect43: '4:3 (Clásico)',
    playerAspectFill: 'Llenar Pantalla',
    playerQuality: 'Calidad',
    playerAudio: 'Audio',
    playerSubtitles: 'Subtítulos',
    playerPip: 'Picture-in-Picture',
    playerFullscreen: 'Pantalla Completa',
    playerMute: 'Silenciar',
    playerVolume: 'Volumen',
    playerPrevChannel: 'Canal Anterior',
    playerNextChannel: 'Canal Siguiente',
    favoritesEmpty: 'Aún no has agregado ningún canal a favoritos.',
    epgScheduleTitle: 'Parrilla de Programación',
    epgTimelineNow: 'Ahora',
    epgNoData: 'Sin datos de guía',
    settingsTitle: 'Configuración del Reproductor',
    settingsLanguage: 'Idioma de la Interfaz',
    settingsCorsProxy: 'Proxy CORS (para URLs que bloquean navegadores)',
    settingsCorsHelp: 'Utilizado en la versión Web para eludir restricciones CORS de transmisiones remotas. La app Portable no necesita proxy.',
    settingsClearData: 'Borrar Todos los Datos Guardados',
    settingsClearConfirm: '¿Realmente desea eliminar todas las listas, EPGs y favoritos guardados?',
    settingsAbout: 'Acerca de FluiStream',
    settingsVersion: 'Versión 1.0.0 — Estándar Cesar Ovies',
    footerRights: 'Todos los derechos reservados.',
    season: 'Temporada',
    episode: 'Episodio',
    seriesEpisodesCount: '{count} episodios'
  }
};

class LocalizationManager {
  constructor() {
    this.currentLanguage = this.detectInitialLanguage();
    this.listeners = new Set();
  }

  detectInitialLanguage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('fluistream_lang');
        if (saved && Object.values(SupportedLanguages).includes(saved)) {
          return saved;
        }
      }
      if (typeof navigator !== 'undefined') {
        const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
        if (nav.startsWith('pt')) return SupportedLanguages.PT_BR;
        if (nav.startsWith('es')) return SupportedLanguages.ES;
        if (nav.startsWith('en')) return SupportedLanguages.EN_US;
      }
    } catch {
      // Fallback
    }
    return SupportedLanguages.PT_BR;
  }

  setLanguage(lang) {
    if (!Object.values(SupportedLanguages).includes(lang)) return;
    this.currentLanguage = lang;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('fluistream_lang', lang);
      }
    } catch {
      // Ignore storage errors
    }
    this.notify();
  }

  get(key, params = {}) {
    const dict = translations[this.currentLanguage] || translations[SupportedLanguages.PT_BR];
    let text = dict[key] || translations[SupportedLanguages.PT_BR][key] || key;
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.currentLanguage);
      } catch (err) {
        console.error('Localization listener error:', err);
      }
    }
  }

  applyToDOM(root = document) {
    if (!root || !root.querySelectorAll) return;
    const elements = root.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.get(key);
      }
    });

    const placeholders = root.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', this.get(key));
      }
    });

    const titles = root.querySelectorAll('[data-i18n-title]');
    titles.forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', this.get(key));
      }
    });
  }
}

export const i18n = new LocalizationManager();
