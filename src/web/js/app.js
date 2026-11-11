/**
 * FluiStream — Main Application Controller
 * Coordena interface, navegação, importação, EPG, player e busca
 */

import { i18n, SupportedLanguages } from './localization.js';
import { M3UParser, ItemType } from './m3u-parser.js';
import { EPGParser } from './epg-parser.js';
import { XtreamApi } from './xtream-api.js';
import { storage } from './storage.js';
import { VideoPlayerController } from './player.js';

class FluiStreamApp {
  constructor() {
    this.currentView = ItemType.LIVE; // 'live' | 'movie' | 'series' | 'favorites' | 'epg'
    this.playlist = {
      items: [],
      epgUrl: null,
      summary: { total: 0, live: 0, movies: 0, series: 0 },
      name: ''
    };
    this.epg = new EPGParser();
    this.selectedGroup = 'all';
    this.searchQuery = '';
    this.currentPlayingItem = null;
    this.player = null;

    this.init();
  }

  async init() {
    this.bindDomElements();
    this.initPlayer();
    this.initI18n();
    this.bindEvents();
    await this.loadSavedState();
    this.render();
  }

  bindDomElements() {
    this.dom = {
      video: document.getElementById('main-video'),
      playerContainer: document.getElementById('player-wrapper'),
      channelList: document.getElementById('channel-grid'),
      categoryList: document.getElementById('category-filter-list'),
      searchInput: document.getElementById('global-search'),
      currentChannelName: document.getElementById('player-channel-title'),
      currentChannelGroup: document.getElementById('player-channel-group'),
      currentChannelLogo: document.getElementById('player-channel-logo'),
      currentProgramTitle: document.getElementById('player-current-prog-title'),
      currentProgramTime: document.getElementById('player-current-prog-time'),
      currentProgramProgress: document.getElementById('player-prog-progress-bar'),
      navTabs: document.querySelectorAll('.nav-tab-btn'),
      itemCountBadge: document.getElementById('items-count-badge'),
      modalImport: document.getElementById('modal-import'),
      modalSettings: document.getElementById('modal-settings'),
      modalEpg: document.getElementById('modal-epg'),
      btnOpenImport: document.getElementById('btn-open-import'),
      btnOpenSettings: document.getElementById('btn-open-settings'),
      btnCloseImport: document.getElementById('btn-close-import'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      emptyState: document.getElementById('empty-state-view'),
      contentView: document.getElementById('main-content-view'),
      btnLoadDemo: document.getElementById('btn-load-demo'),
      btnEmptyImport: document.getElementById('btn-empty-import'),
      aspectSelect: document.getElementById('select-aspect-ratio'),
      langSelect: document.getElementById('settings-lang-select'),
      corsInput: document.getElementById('settings-cors-input'),
      btnSaveSettings: document.getElementById('btn-save-settings'),
      btnClearAllData: document.getElementById('btn-clear-all-data'),
      // Import form elements
      importTabs: document.querySelectorAll('.import-tab-btn'),
      importPanels: document.querySelectorAll('.import-panel'),
      fileInput: document.getElementById('input-m3u-file'),
      urlInput: document.getElementById('input-m3u-url'),
      externalEpgInput: document.getElementById('input-external-epg'),
      useEmbeddedEpgCheck: document.getElementById('check-use-embedded-epg'),
      xtreamServerInput: document.getElementById('input-xtream-server'),
      xtreamUserInput: document.getElementById('input-xtream-user'),
      xtreamPassInput: document.getElementById('input-xtream-pass'),
      btnSubmitImport: document.getElementById('btn-submit-import'),
      importStatusMsg: document.getElementById('import-status-text')
    };
  }

  initPlayer() {
    this.player = new VideoPlayerController(this.dom.video, this.dom.playerContainer);
    this.player.onChannelChange = (delta) => this.navigateChannel(delta);

    // Atalhos de teclado
    window.addEventListener('keydown', (e) => {
      // Ignorar se foco estiver em campo de texto
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.player.togglePlay();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        this.player.toggleFullscreen();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        this.player.toggleMute();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.player.setVolume(this.dom.video.volume + 0.05);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.player.setVolume(this.dom.video.volume - 0.05);
      }
    });

    if (this.dom.aspectSelect) {
      this.dom.aspectSelect.addEventListener('change', (e) => {
        this.player.setAspectRatio(e.target.value);
      });
    }

    const btnPip = document.getElementById('btn-player-pip');
    if (btnPip) btnPip.addEventListener('click', () => this.player.togglePip());

    const btnFullscreen = document.getElementById('btn-player-fullscreen');
    if (btnFullscreen) btnFullscreen.addEventListener('click', () => this.player.toggleFullscreen());
  }

  initI18n() {
    i18n.subscribe(() => {
      i18n.applyToDOM();
      this.render();
    });
    i18n.applyToDOM();

    if (this.dom.langSelect) {
      this.dom.langSelect.value = i18n.currentLanguage;
      this.dom.langSelect.addEventListener('change', (e) => {
        i18n.setLanguage(e.target.value);
      });
    }
  }

  bindEvents() {
    // Abas de navegação principais (Ao Vivo, Filmes, Séries, Favoritos, EPG)
    this.dom.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.dom.navTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentView = tab.getAttribute('data-view');
        this.selectedGroup = 'all';
        this.render();
      });
    });

    // Busca
    if (this.dom.searchInput) {
      this.dom.searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderChannelGrid();
      });
    }

    // Modais
    this.dom.btnOpenImport.addEventListener('click', () => this.openModal(this.dom.modalImport));
    this.dom.btnOpenSettings.addEventListener('click', () => {
      const cfg = storage.getSettings();
      if (this.dom.corsInput) this.dom.corsInput.value = cfg.corsProxy || '';
      this.openModal(this.dom.modalSettings);
    });

    this.dom.btnCloseImport.addEventListener('click', () => this.closeModal(this.dom.modalImport));
    this.dom.btnCloseSettings.addEventListener('click', () => this.closeModal(this.dom.modalSettings));
    if (this.dom.btnEmptyImport) {
      this.dom.btnEmptyImport.addEventListener('click', () => this.openModal(this.dom.modalImport));
    }

    // Abas de importação
    this.dom.importTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.importTabs.forEach(b => b.classList.remove('active'));
        this.dom.importPanels.forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        const target = document.getElementById(btn.getAttribute('data-panel'));
        if (target) target.classList.remove('hidden');
      });
    });

    // Submissão de importação
    this.dom.btnSubmitImport.addEventListener('click', () => this.handleImportSubmit());

    // Demo button
    if (this.dom.btnLoadDemo) {
      this.dom.btnLoadDemo.addEventListener('click', () => this.loadDemoPlaylist());
    }

    // Configurações
    if (this.dom.btnSaveSettings) {
      this.dom.btnSaveSettings.addEventListener('click', () => {
        const cfg = storage.getSettings();
        cfg.corsProxy = (this.dom.corsInput.value || '').trim();
        storage.saveSettings(cfg);
        this.closeModal(this.dom.modalSettings);
      });
    }

    if (this.dom.btnClearAllData) {
      this.dom.btnClearAllData.addEventListener('click', async () => {
        if (confirm(i18n.get('settingsClearConfirm'))) {
          await storage.clearAll();
          window.location.reload();
        }
      });
    }
  }

  openModal(modal) {
    if (modal) modal.classList.remove('hidden');
  }

  closeModal(modal) {
    if (modal) modal.classList.add('hidden');
  }

  async loadSavedState() {
    const saved = await storage.loadPlaylist();
    if (saved && saved.items && saved.items.length > 0) {
      this.playlist = saved;
      const rawEpg = await storage.loadEpg();
      if (rawEpg) {
        this.epg.parse(rawEpg);
      }
    }
  }

  async loadDemoPlaylist() {
    const demoM3U = `#EXTM3U x-tvg-url="https://raw.githubusercontent.com/CesarOvies/demo-assets/main/epg.xml"
#EXTINF:-1 tvg-id="globo.br" tvg-name="TV Globo HD" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/TV_Globo_2021.svg/300px-TV_Globo_2021.svg.png" group-title="Canais Abertos",TV Globo HD
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8

#EXTINF:-1 tvg-id="cnn.br" tvg-name="CNN Brasil" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/CNN_Brasil_logo.svg/320px-CNN_Brasil_logo.svg.png" group-title="Notícias",CNN Brasil Ao Vivo
https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8

#EXTINF:-1 tvg-id="espn.br" tvg-name="ESPN Brasil" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/320px-ESPN_wordmark.svg.png" group-title="Esportes",ESPN Ao Vivo
https://test-streams.mux.dev/test_001/stream.m3u8

#EXTINF:7200 tvg-id="vod.bbb" tvg-name="Big Buck Bunny 4K" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/300px-Big_buck_bunny_poster_big.jpg" group-title="Filmes Animação",Big Buck Bunny (2008)
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4

#EXTINF:7200 tvg-id="vod.tos" tvg-name="Tears of Steel Sci-Fi" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Tears_of_Steel_poster.jpg/300px-Tears_of_Steel_poster.jpg" group-title="Filmes Ficção",Tears of Steel (2012)
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4

#EXTINF:3600 tvg-id="serie.sintel" tvg-name="Sintel - S01E01 - O Começo" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Sintel_poster.jpg/300px-Sintel_poster.jpg" group-title="Séries Fantasia",Sintel - S01E01 - O Começo
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4

#EXTINF:3600 tvg-id="serie.sintel2" tvg-name="Sintel - S01E02 - O Confronto" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Sintel_poster.jpg/300px-Sintel_poster.jpg" group-title="Séries Fantasia",Sintel - S01E02 - O Confronto
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4
`;

    const now = new Date();
    const startHour = now.getHours();
    const demoXmltv = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="globo.br">
    <display-name>TV Globo HD</display-name>
  </channel>
  <programme start="${this.formatXmltvDate(now, 0)}" stop="${this.formatXmltvDate(now, 2)}" channel="globo.br">
    <title>Jornal Nacional</title>
    <desc>Principais notícias do Brasil e do mundo com cobertura ao vivo.</desc>
    <category>Notícias</category>
  </programme>
  <programme start="${this.formatXmltvDate(now, 2)}" stop="${this.formatXmltvDate(now, 4)}" channel="globo.br">
    <title>Cinema Especial</title>
    <desc>Superprodução inédita com áudio 5.1 e alta definição.</desc>
    <category>Filmes</category>
  </programme>
  <channel id="cnn.br">
    <display-name>CNN Brasil</display-name>
  </channel>
  <programme start="${this.formatXmltvDate(now, 0)}" stop="${this.formatXmltvDate(now, 3)}" channel="cnn.br">
    <title>CNN 360 Graus</title>
    <desc>Análise aprofundada dos fatos políticos e econômicos.</desc>
    <category>Notícias</category>
  </programme>
</tv>`;

    this.processLoadedM3u(demoM3U, 'Demonstração FluiStream', demoXmltv);
    this.closeModal(this.dom.modalImport);
  }

  formatXmltvDate(baseDate, addHours = 0) {
    const d = new Date(baseDate.getTime() + addHours * 3600000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${day}${h}${min}${s} +0000`;
  }

  async handleImportSubmit() {
    const activeTab = document.querySelector('.import-tab-btn.active')?.getAttribute('data-panel');
    this.dom.importStatusMsg.textContent = i18n.get('statusParsingM3u');
    this.dom.btnSubmitImport.disabled = true;

    try {
      let m3uContent = '';
      let listName = 'Minha Lista';
      let externalEpgUrl = this.dom.externalEpgInput.value.trim();

      if (activeTab === 'panel-file') {
        const file = this.dom.fileInput.files[0];
        if (!file) throw new Error(i18n.get('labelFileSelect'));
        listName = file.name.replace(/\.[^/.]+$/, '');
        m3uContent = await file.text();
      } else if (activeTab === 'panel-url') {
        const url = this.dom.urlInput.value.trim();
        if (!url) throw new Error('URL da lista M3U é obrigatória');
        listName = 'Lista URL';
        const cfg = storage.getSettings();
        const finalUrl = cfg.corsProxy ? `${cfg.corsProxy}/${encodeURIComponent(url)}` : url;
        const res = await fetch(finalUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        m3uContent = await res.text();
      } else if (activeTab === 'panel-xtream') {
        const server = this.dom.xtreamServerInput.value.trim();
        const user = this.dom.xtreamUserInput.value.trim();
        const pass = this.dom.xtreamPassInput.value.trim();
        if (!server || !user || !pass) throw new Error('Preencha Servidor, Usuário e Senha');

        listName = `Xtream (${user})`;
        this.dom.importStatusMsg.textContent = i18n.get('statusAuthenticatingXtream');
        const cfg = storage.getSettings();
        const xtream = new XtreamApi(server, user, pass, cfg.corsProxy);
        
        m3uContent = await xtream.fetchM3uContent();
        if (!externalEpgUrl) {
          externalEpgUrl = xtream.getEpgUrl();
        }
      }

      await this.processLoadedM3u(m3uContent, listName, null, externalEpgUrl);
      this.closeModal(this.dom.modalImport);
    } catch (err) {
      alert(`Erro: ${err.message}`);
      this.dom.importStatusMsg.textContent = err.message;
    } finally {
      this.dom.btnSubmitImport.disabled = false;
    }
  }

  async processLoadedM3u(m3uContent, name, embeddedXmltv = null, externalEpgUrl = null) {
    const parsed = M3UParser.parse(m3uContent);
    if (!parsed.items || parsed.items.length === 0) {
      throw new Error(i18n.get('errorM3uEmpty'));
    }

    this.playlist = {
      name: name || 'Lista',
      items: parsed.items,
      epgUrl: externalEpgUrl || parsed.epgUrl,
      summary: parsed.summary
    };

    await storage.savePlaylist(this.playlist);

    // Processamento de EPG
    if (embeddedXmltv) {
      this.epg.parse(embeddedXmltv);
      await storage.saveEpg(embeddedXmltv);
    } else if (this.playlist.epgUrl && this.dom.useEmbeddedEpgCheck?.checked !== false) {
      this.fetchAndParseEpg(this.playlist.epgUrl);
    }

    this.render();

    // Auto-reproduzir primeiro canal ao vivo
    const firstLive = this.playlist.items.find(x => x.type === ItemType.LIVE) || this.playlist.items[0];
    if (firstLive) {
      this.playChannel(firstLive);
    }
  }

  async fetchAndParseEpg(epgUrl) {
    try {
      const cfg = storage.getSettings();
      const finalUrl = cfg.corsProxy ? `${cfg.corsProxy}/${encodeURIComponent(epgUrl)}` : epgUrl;
      const res = await fetch(finalUrl);
      if (res.ok) {
        const xml = await res.text();
        this.epg.parse(xml);
        await storage.saveEpg(xml);
        this.updateCurrentEpgDisplay();
      }
    } catch (e) {
      console.warn('Falha ao baixar EPG:', e);
    }
  }

  render() {
    const hasItems = this.playlist.items && this.playlist.items.length > 0;
    if (!hasItems) {
      this.dom.emptyState.classList.remove('hidden');
      this.dom.contentView.classList.add('hidden');
      return;
    }

    this.dom.emptyState.classList.add('hidden');
    this.dom.contentView.classList.remove('hidden');

    this.renderCategories();
    this.renderChannelGrid();
  }

  getFilteredItems() {
    let items = this.playlist.items || [];

    // Filtro por tipo/aba
    if (this.currentView === ItemType.LIVE) {
      items = items.filter(x => x.type === ItemType.LIVE);
    } else if (this.currentView === ItemType.MOVIE) {
      items = items.filter(x => x.type === ItemType.MOVIE);
    } else if (this.currentView === ItemType.SERIES) {
      items = items.filter(x => x.type === ItemType.SERIES);
    } else if (this.currentView === 'favorites') {
      const favs = storage.getFavorites();
      items = items.filter(x => favs.includes(x.id));
    }

    // Filtro por grupo/categoria
    if (this.selectedGroup !== 'all') {
      items = items.filter(x => x.group === this.selectedGroup);
    }

    // Filtro por busca
    if (this.searchQuery) {
      items = items.filter(x => 
        x.name.toLowerCase().includes(this.searchQuery) ||
        (x.group && x.group.toLowerCase().includes(this.searchQuery))
      );
    }

    return items;
  }

  renderCategories() {
    let items = this.playlist.items || [];
    if (this.currentView === ItemType.LIVE) items = items.filter(x => x.type === ItemType.LIVE);
    else if (this.currentView === ItemType.MOVIE) items = items.filter(x => x.type === ItemType.MOVIE);
    else if (this.currentView === ItemType.SERIES) items = items.filter(x => x.type === ItemType.SERIES);
    else if (this.currentView === 'favorites') {
      const favs = storage.getFavorites();
      items = items.filter(x => favs.includes(x.id));
    }

    const groupsMap = new Map();
    items.forEach(it => {
      const g = it.group || 'Geral';
      groupsMap.set(g, (groupsMap.get(g) || 0) + 1);
    });

    const sortedGroups = Array.from(groupsMap.entries()).sort((a, b) => b[1] - a[1]);

    let html = `
      <button class="cat-pill ${this.selectedGroup === 'all' ? 'active' : ''}" data-group="all">
        ${i18n.get('allCategories')} (${items.length})
      </button>
    `;

    sortedGroups.forEach(([groupName, count]) => {
      const active = this.selectedGroup === groupName ? 'active' : '';
      html += `
        <button class="cat-pill ${active}" data-group="${this.escapeHtml(groupName)}">
          ${this.escapeHtml(groupName)} <span class="cat-count">${count}</span>
        </button>
      `;
    });

    this.dom.categoryList.innerHTML = html;

    this.dom.categoryList.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedGroup = btn.getAttribute('data-group');
        this.dom.categoryList.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderChannelGrid();
      });
    });
  }

  renderChannelGrid() {
    const items = this.getFilteredItems();
    this.dom.itemCountBadge.textContent = i18n.get('channelCount', { count: items.length });

    if (items.length === 0) {
      this.dom.channelList.innerHTML = `
        <div class="empty-search text-center py-12 text-slate-400">
          <p>${i18n.get('noEpgAvailable')}</p>
        </div>
      `;
      return;
    }

    let html = '';
    items.forEach(item => {
      const isFav = storage.isFavorite(item.id);
      const isPlaying = this.currentPlayingItem && this.currentPlayingItem.id === item.id;
      const logoUrl = item.logo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="%238B949E" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>';

      // Detalhes de EPG para canal ao vivo
      let epgHtml = '';
      if (item.type === ItemType.LIVE) {
        const curProg = this.epg.getCurrentProgram(item.tvgId, item.name);
        if (curProg) {
          epgHtml = `
            <div class="channel-card-epg">
              <div class="epg-title-now">${this.escapeHtml(curProg.title)}</div>
              <div class="epg-bar"><div class="epg-bar-fill" style="width: ${curProg.progress}%"></div></div>
            </div>
          `;
        }
      }

      html += `
        <div class="channel-card ${isPlaying ? 'playing' : ''}" data-id="${item.id}">
          <div class="channel-card-inner">
            <div class="channel-logo-wrap">
              <img src="${logoUrl}" alt="${this.escapeHtml(item.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'48\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23555\\' stroke-width=\\'1.5\\'><rect x=\\'2\\' y=\\'7\\' width=\\'20\\' height=\\'15\\' rx=\\'2\\'/><polyline points=\\'17 2 12 7 7 2\\'/></svg>'" />
              <button class="btn-fav ${isFav ? 'is-fav' : ''}" data-fav-id="${item.id}" title="${i18n.get('navFavorites')}">
                ★
              </button>
            </div>
            <div class="channel-info">
              <span class="channel-badge ${item.type}">${item.type.toUpperCase()}</span>
              <h4 class="channel-title">${this.escapeHtml(item.name)}</h4>
              <p class="channel-group">${this.escapeHtml(item.group || '')}</p>
              ${epgHtml}
            </div>
          </div>
        </div>
      `;
    });

    this.dom.channelList.innerHTML = html;

    // Listeners de clique nos canais
    this.dom.channelList.querySelectorAll('.channel-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-fav')) return;
        const id = card.getAttribute('data-id');
        const item = items.find(x => x.id === id);
        if (item) this.playChannel(item);
      });
    });

    // Listeners de favoritos
    this.dom.channelList.querySelectorAll('.btn-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-fav-id');
        const isNowFav = storage.toggleFavorite(id);
        btn.classList.toggle('is-fav', isNowFav);
        if (this.currentView === 'favorites') this.renderChannelGrid();
      });
    });
  }

  playChannel(item) {
    this.currentPlayingItem = item;
    storage.addRecent(item);

    const cfg = storage.getSettings();
    this.player.playStream(item, cfg.corsProxy);

    // Atualizar UI de reprodução
    this.dom.currentChannelName.textContent = item.name;
    this.dom.currentChannelGroup.textContent = item.group || '';
    if (item.logo) {
      this.dom.currentChannelLogo.src = item.logo;
      this.dom.currentChannelLogo.classList.remove('hidden');
    } else {
      this.dom.currentChannelLogo.classList.add('hidden');
    }

    this.updateCurrentEpgDisplay();

    // Destacar item selecionado na grade
    document.querySelectorAll('.channel-card').forEach(c => {
      c.classList.toggle('playing', c.getAttribute('data-id') === item.id);
    });
  }

  updateCurrentEpgDisplay() {
    if (!this.currentPlayingItem || this.currentPlayingItem.type !== ItemType.LIVE) {
      this.dom.currentProgramTitle.textContent = this.currentPlayingItem?.name || '';
      this.dom.currentProgramTime.textContent = '';
      this.dom.currentProgramProgress.style.width = '0%';
      return;
    }

    const prog = this.epg.getCurrentProgram(this.currentPlayingItem.tvgId, this.currentPlayingItem.name);
    if (prog) {
      this.dom.currentProgramTitle.textContent = `${prog.title} — ${prog.formattedStart} - ${prog.formattedStop}`;
      this.dom.currentProgramTime.textContent = `${prog.remainingMinutes} min ${i18n.get('epgTimeRemaining')}`;
      this.dom.currentProgramProgress.style.width = `${prog.progress}%`;
    } else {
      this.dom.currentProgramTitle.textContent = i18n.get('noEpgAvailable');
      this.dom.currentProgramTime.textContent = '';
      this.dom.currentProgramProgress.style.width = '0%';
    }
  }

  navigateChannel(delta) {
    const items = this.getFilteredItems();
    if (!items || items.length === 0) return;

    let currentIndex = items.findIndex(x => x.id === this.currentPlayingItem?.id);
    let nextIndex = currentIndex + delta;

    if (nextIndex < 0) nextIndex = items.length - 1;
    if (nextIndex >= items.length) nextIndex = 0;

    this.playChannel(items[nextIndex]);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Inicializar aplicação assim que DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  window.fluiStreamApp = new FluiStreamApp();
});
