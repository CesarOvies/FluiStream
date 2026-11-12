/**
 * FluiStream — Main Application Controller
 * Coordena interface, navegação, importação, EPG, player, perfis e séries
 * Padrão Cesar Ovies Engineering Standards (PT/EN/ES, DWM Dark Mode, Single-file/User-space)
 */

import { i18n, SupportedLanguages } from './localization.js';
import { M3UParser, ItemType } from './m3u-parser.js';
import { EPGParser } from './epg-parser.js';
import { XtreamApi } from './xtream-api.js';
import { storage } from './storage.js';
import { VideoPlayerController } from './player.js';
import { fetchRemoteText } from './network.js';
import { APP_VERSION, checkForUpdate, UpdateChecker } from './version.js';

class FluiStreamApp {
  constructor() {
    this.currentView = ItemType.LIVE; // 'live' | 'movie' | 'series' | 'favorites'
    this.playlist = {
      items: [],
      epgUrl: null,
      summary: { total: 0, live: 0, movies: 0, series: 0 },
      name: ''
    };
    this.epg = new EPGParser();
    this.selectedGroup = null; // null = Visão Geral de Categorias
    this.searchQuery = '';
    this.currentPlayingItem = null;
    this.PAGE_SIZE = 60;
    this.renderedCount = 0;
    this.currentFilteredItems = [];
    this.currentFilteredSeries = [];
    this.activeSeries = null;
    this.selectedSeason = 1;
    this.isScrubbing = false;
    this.currentDuration = 0;

    this.init();
  }

  async init() {
    this.bindDomElements();
    this.initPlayer();
    this.initI18n();
    this.bindEvents();
    await this.loadSavedState();
    this.render();
    this.checkAppUpdates();
  }

  bindDomElements() {
    this.dom = {
      video: document.getElementById('main-video'),
      playerContainer: document.getElementById('player-wrapper'),
      channelList: document.getElementById('channel-grid'),
      channelGridSection: document.getElementById('channel-grid-section'),
      categoryList: document.getElementById('category-filter-list'),
      categoryNavBar: document.getElementById('category-nav-bar'),
      categoryCurrentTitle: document.getElementById('category-current-title'),
      categoryOverviewSection: document.getElementById('category-overview-section'),
      categoryOverviewGrid: document.getElementById('category-overview-grid'),
      loadMoreWrap: document.getElementById('load-more-wrap'),
      btnLoadMore: document.getElementById('btn-load-more'),
      searchInput: document.getElementById('global-search'),
      btnBrandHome: document.getElementById('btn-brand-home'),
      btnBackCategories: document.getElementById('btn-back-categories'),
      btnPlayerPlayPause: document.getElementById('btn-player-playpause'),
      iconPlayerPause: document.getElementById('icon-player-pause'),
      iconPlayerPlay: document.getElementById('icon-player-play'),
      btnPlayerStop: document.getElementById('btn-player-stop'),
      btnPlayerClose: document.getElementById('btn-player-close'),
      btnPlayerFullscreen: document.getElementById('btn-player-fullscreen'),
      btnPlayerPip: document.getElementById('btn-player-pip'),
      selectPlayerAudio: document.getElementById('select-player-audio'),
      selectPlayerSubtitles: document.getElementById('select-player-subtitles'),
      currentChannelName: document.getElementById('player-channel-title'),
      currentChannelGroup: document.getElementById('player-channel-group'),
      currentChannelLogo: document.getElementById('player-channel-logo'),
      currentProgramTitle: document.getElementById('player-current-prog-title'),
      currentProgramTime: document.getElementById('player-current-prog-time'),
      currentProgramProgress: document.getElementById('player-prog-progress-bar'),
      currentProgramRemaining: document.getElementById('player-current-prog-remaining'),
      epgStatusBadge: document.getElementById('epg-status-badge'),
      timeCurrent: document.getElementById('player-time-current'),
      timeTotal: document.getElementById('player-time-total'),
      progressBarWrap: document.getElementById('player-progress-bar-wrap'),
      progressThumb: document.getElementById('player-prog-thumb'),
      inputVolume: document.getElementById('input-player-volume'),
      btnMute: document.getElementById('btn-player-mute'),
      iconVolumeHigh: document.getElementById('icon-volume-high'),
      iconVolumeMuted: document.getElementById('icon-volume-muted'),
      navTabs: document.querySelectorAll('.nav-tab-btn'),
      itemCountBadge: document.getElementById('items-count-badge'),
      modalImport: document.getElementById('modal-import'),
      modalSettings: document.getElementById('modal-settings'),
      modalAbout: document.getElementById('modal-about'),
      btnOpenImport: document.getElementById('btn-open-import'),
      btnOpenSettings: document.getElementById('btn-open-settings'),
      btnOpenAbout: document.getElementById('btn-open-about'),
      btnCloseImport: document.getElementById('btn-close-import'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      btnCloseAbout: document.getElementById('btn-close-about'),
      emptyState: document.getElementById('empty-state-view'),
      contentView: document.getElementById('main-content-view'),
      btnLoadDemo: document.getElementById('btn-load-demo'),
      btnEmptyImport: document.getElementById('btn-empty-import'),
      btnEmptyAbout: document.getElementById('btn-empty-about'),
      aspectSelect: document.getElementById('select-aspect-ratio'),
      streamModeSelect: document.getElementById('select-stream-mode'),
      playerEngineSelect: document.getElementById('select-player-engine'),
      langSelect: document.getElementById('settings-lang-select'),
      corsInput: document.getElementById('settings-cors-input'),
      settingsStreamModeSelect: document.getElementById('settings-stream-mode-select'),
      settingsPlayerEngineSelect: document.getElementById('settings-player-engine-select'),
      btnSaveSettings: document.getElementById('btn-save-settings'),
      btnClearAllData: document.getElementById('btn-clear-all-data'),
      // Perfis (Tela 7)
      btnOpenProfiles: document.getElementById('btn-open-profiles'),
      headerProfileName: document.getElementById('header-profile-name'),
      modalProfiles: document.getElementById('modal-profiles'),
      btnCloseProfiles: document.getElementById('btn-close-profiles'),
      btnProfilesAdd: document.getElementById('btn-profiles-add'),
      profilesGrid: document.getElementById('profiles-grid-list'),
      // Edição de Perfil
      modalEditProfile: document.getElementById('modal-edit-profile'),
      btnCloseEditProfile: document.getElementById('btn-close-edit-profile'),
      btnCancelEditProfile: document.getElementById('btn-cancel-edit-profile'),
      btnSaveEditProfile: document.getElementById('btn-save-edit-profile'),
      btnReloadEditProfile: document.getElementById('btn-reload-edit-profile'),
      editProfileId: document.getElementById('edit-profile-id'),
      editProfileType: document.getElementById('edit-profile-type'),
      inputEditProfileName: document.getElementById('input-edit-profile-name'),
      editSectionXtream: document.getElementById('edit-section-xtream'),
      inputEditXtreamServer: document.getElementById('input-edit-xtream-server'),
      inputEditXtreamUser: document.getElementById('input-edit-xtream-user'),
      inputEditXtreamPass: document.getElementById('input-edit-xtream-pass'),
      editSectionM3uUrl: document.getElementById('edit-section-m3u-url'),
      inputEditM3uUrl: document.getElementById('input-edit-m3u-url'),
      inputEditExternalEpg: document.getElementById('input-edit-external-epg'),
      selectEditStreamMode: document.getElementById('select-edit-stream-mode'),
      selectEditPlayerEngine: document.getElementById('select-edit-player-engine'),
      inputEditCorsProxy: document.getElementById('input-edit-cors-proxy'),
      editProfileStatus: document.getElementById('edit-profile-status'),
      // Informações da Conta (Tela 6)
      btnOpenAccount: document.getElementById('btn-open-account'),
      modalAccount: document.getElementById('modal-account'),
      btnCloseAccount: document.getElementById('btn-close-account'),
      btnAccBack: document.getElementById('btn-acc-back'),
      btnAccEdit: document.getElementById('btn-acc-edit'),
      btnAccLogout: document.getElementById('btn-acc-logout'),
      accUsername: document.getElementById('acc-info-username'),
      accStatus: document.getElementById('acc-info-status'),
      accExpDate: document.getElementById('acc-info-exp-date'),
      accTrial: document.getElementById('acc-info-trial'),
      accActiveCons: document.getElementById('acc-info-active-cons'),
      accCreatedAt: document.getElementById('acc-info-created-at'),
      accMaxCons: document.getElementById('acc-info-max-cons'),
      // Séries & Temporadas (Telas 2, 3 e 4)
      modalSeries: document.getElementById('modal-series'),
      btnCloseSeries: document.getElementById('btn-close-series'),
      seriesPoster: document.getElementById('series-modal-poster'),
      seriesTitle: document.getElementById('series-modal-title'),
      seriesGenre: document.getElementById('series-modal-genre'),
      seriesStats: document.getElementById('series-modal-stats'),
      seriesDesc: document.getElementById('series-modal-desc'),
      btnSeriesWatchNow: document.getElementById('btn-series-watch-now'),
      btnSeriesSeasonSelect: document.getElementById('btn-series-season-select'),
      seasonsPopup: document.getElementById('seasons-popup'),
      btnCloseSeasonsPopup: document.getElementById('btn-close-seasons-popup'),
      seasonsPopupList: document.getElementById('seasons-popup-list'),
      seriesEpisodesContainer: document.getElementById('series-episodes-container'),
      // Import form elements
      importTabs: document.querySelectorAll('.import-tab-btn'),
      importPanels: document.querySelectorAll('.import-panel'),
      profileNameInput: document.getElementById('input-profile-name'),
      fileInput: document.getElementById('input-m3u-file'),
      urlInput: document.getElementById('input-m3u-url'),
      externalEpgInput: document.getElementById('input-external-epg'),
      useEmbeddedEpgCheck: document.getElementById('check-use-embedded-epg'),
      xtreamServerInput: document.getElementById('input-xtream-server'),
      xtreamUserInput: document.getElementById('input-xtream-user'),
      xtreamPassInput: document.getElementById('input-xtream-pass'),
      btnSubmitImport: document.getElementById('btn-submit-import'),
      importStatusMsg: document.getElementById('import-status-text'),
      // Update elements
      updateToast: document.getElementById('update-toast'),
      updateToastDesc: document.getElementById('update-toast-desc'),
      updateToastNotes: document.getElementById('update-toast-notes'),
      btnToastUpdate: document.getElementById('btn-toast-update'),
      btnToastDismiss: document.getElementById('btn-toast-dismiss'),
      btnCheckUpdatesManual: document.getElementById('btn-check-updates-manual'),
      settingsUpdateStatus: document.getElementById('settings-update-status'),
      // Player feedback overlays
      playerLoadingOverlay: document.getElementById('player-loading-spinner'),
      playerLoadingText: document.getElementById('player-loading-text'),
      playerErrorOverlay: document.getElementById('player-error-overlay'),
      playerErrorMsg: document.getElementById('player-error-msg'),
      btnPlayerRetry: document.getElementById('btn-player-retry')
    };
  }

  initPlayer() {
    this.player = new VideoPlayerController(this.dom.video, this.dom.playerContainer);
    this.player.onChannelChange = (delta) => this.navigateChannel(delta);
    this.player.onStateChange = (state, details) => this.handlePlayerState(state, details);

    // Sincronização de progresso e seeking
    this.player.onTimeUpdate = ({ currentTime, duration, position, isSeekable }) => {
      if (this.isScrubbing) return;
      this.currentDuration = duration;
      this.updateTimelineDisplay(currentTime, duration, position, isSeekable);
    };

    // Barra de progresso interativa (arrastar para frente ou para trás - Item 1)
    if (this.dom.progressBarWrap) {
      const wrap = this.dom.progressBarWrap;

      const calcPct = (clientX) => {
        const rect = wrap.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
        return x / rect.width;
      };

      const onPointerMove = (e) => {
        if (!this.isScrubbing) return;
        const pct = calcPct(e.clientX);
        const pct100 = (pct * 100).toFixed(2) + '%';
        if (this.dom.currentProgramProgress) this.dom.currentProgramProgress.style.width = pct100;
        if (this.dom.progressThumb) this.dom.progressThumb.style.left = pct100;

        if (this.currentDuration > 0 && this.dom.timeCurrent) {
          this.dom.timeCurrent.textContent = this.formatDuration(pct * this.currentDuration);
        }
      };

      const onPointerUp = (e) => {
        if (!this.isScrubbing) return;
        this.isScrubbing = false;
        wrap.classList.remove('dragging');
        const pct = calcPct(e.clientX);
        const targetSec = this.currentDuration > 0 ? (pct * this.currentDuration) : null;
        this.player.seek(pct, targetSec);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      wrap.addEventListener('pointerdown', (e) => {
        this.isScrubbing = true;
        wrap.classList.add('dragging');
        onPointerMove(e);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }

    if (this.dom.btnPlayerRetry) {
      this.dom.btnPlayerRetry.addEventListener('click', () => {
        if (this.currentPlayingItem) this.playChannel(this.currentPlayingItem);
      });
    }

    // Registra instância global para comunicação bidirecional com C# WebView2
    window.fluiStreamApp = this;
    this.player.onTracksUpdated = (tracksInfo) => this.updateTrackSelectors(tracksInfo);
    this.handleVlcTimeUpdate = (curSec, durSec, pos, isSeekable) => {
      this.currentDuration = durSec;
      this.player.handleVlcTime(curSec, durSec, pos, isSeekable);
    };
    this.handleNativeTracks = (data) => {
      if (this.player && data) {
        this.player.audioTracks = (data.audioTracks || []).map(t => ({ id: t.id, name: t.name || `Faixa ${t.id}` }));
        this.player.subtitleTracks = (data.subtitleTracks || []).map(t => ({ id: t.id, name: t.name || `Legenda ${t.id}` }));
        this.player.currentAudioTrack = data.currentAudioTrack ?? -1;
        this.player.currentSubtitleTrack = data.currentSubtitleTrack ?? -1;
        this.player.notifyTracks();
      }
    };
  }

  updateTimelineDisplay(currentTime, duration, position, isSeekable) {
    const isVod = Boolean(this.currentPlayingItem && (this.currentPlayingItem.type === ItemType.MOVIE || this.currentPlayingItem.type === ItemType.SERIES));
    const showDuration = isVod || (isSeekable && duration > 0);

    if (showDuration) {
      if (this.dom.timeCurrent) {
        this.dom.timeCurrent.textContent = this.formatDuration(currentTime);
        this.dom.timeCurrent.classList.remove('hidden');
      }
      if (this.dom.timeTotal) {
        this.dom.timeTotal.textContent = this.formatDuration(duration);
        this.dom.timeTotal.classList.remove('hidden');
      }
      if (this.dom.currentProgramProgress) {
        this.dom.currentProgramProgress.style.width = `${Math.min(100, Math.max(0, position * 100))}%`;
      }
      if (this.dom.progressThumb) {
        this.dom.progressThumb.style.left = `${Math.min(100, Math.max(0, position * 100))}%`;
      }
      if (this.dom.currentProgramRemaining) {
        this.dom.currentProgramRemaining.textContent = '';
      }
    } else {
      // Stream ao vivo sem barra de duração gravada: exibe EPG
      if (this.dom.timeCurrent) this.dom.timeCurrent.classList.add('hidden');
      if (this.dom.timeTotal) this.dom.timeTotal.classList.add('hidden');
      this.updateCurrentEpgDisplay();
    }
  }

  formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00:00';
    const total = Math.floor(seconds);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  initI18n() {
    i18n.subscribe(() => {
      i18n.applyToDOM();
      this.render();
      if (this.activeSeries) {
        this.openSeriesDetailModal(this.activeSeries);
      }
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
    // Abas de navegação principais (Ao Vivo, Filmes, Séries, Favoritos)
    this.dom.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.dom.navTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentView = tab.getAttribute('data-view');
        this.selectedGroup = null; // Reinicia na tela geral de categorias da aba selecionada
        this.searchQuery = '';
        if (this.dom.searchInput) this.dom.searchInput.value = '';
        this.render();
      });
    });

    // Busca global com debounce
    let searchTimeout;
    if (this.dom.searchInput) {
      this.dom.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          this.searchQuery = e.target.value.trim().toLowerCase();
          this.render();
        }, 150);
      });
    }

    // Botões de navegação inicial
    if (this.dom.btnBrandHome) {
      this.dom.btnBrandHome.addEventListener('click', () => {
        this.selectedGroup = null;
        this.searchQuery = '';
        if (this.dom.searchInput) this.dom.searchInput.value = '';
        this.render();
      });
    }

    if (this.dom.btnBackCategories) {
      this.dom.btnBackCategories.addEventListener('click', () => {
        this.selectedGroup = null;
        this.render();
      });
    }

    // Controles do Player
    if (this.dom.btnPlayerPlayPause) {
      this.dom.btnPlayerPlayPause.addEventListener('click', () => this.player.togglePlay());
    }
    if (this.dom.btnPlayerStop) {
      this.dom.btnPlayerStop.addEventListener('click', () => this.stopPlayback());
    }
    if (this.dom.btnPlayerClose) {
      this.dom.btnPlayerClose.addEventListener('click', () => this.closePlayerAndReset());
    }
    if (this.dom.btnPlayerFullscreen) {
      this.dom.btnPlayerFullscreen.addEventListener('click', () => this.player.toggleFullscreen());
    }
    if (this.dom.btnPlayerPip) {
      this.dom.btnPlayerPip.addEventListener('click', () => this.player.togglePip());
    }
    if (this.dom.selectPlayerAudio) {
      this.dom.selectPlayerAudio.addEventListener('change', (e) => {
        this.player.setAudioTrack(parseInt(e.target.value, 10));
      });
    }
    if (this.dom.selectPlayerSubtitles) {
      this.dom.selectPlayerSubtitles.addEventListener('change', (e) => {
        this.player.setSubtitleTrack(parseInt(e.target.value, 10));
      });
    }
    if (this.dom.inputVolume) {
      this.dom.inputVolume.addEventListener('input', (e) => this.player.setVolume(parseFloat(e.target.value)));
    }
    if (this.dom.btnMute) {
      this.dom.btnMute.addEventListener('click', () => this.player.toggleMute());
    }
    if (this.dom.aspectSelect) {
      this.dom.aspectSelect.addEventListener('change', (e) => this.player.setAspectRatio(e.target.value));
    }
    if (this.dom.streamModeSelect) {
      this.dom.streamModeSelect.addEventListener('change', () => {
        if (this.currentPlayingItem) this.playChannel(this.currentPlayingItem);
      });
    }
    if (this.dom.playerEngineSelect) {
      this.dom.playerEngineSelect.addEventListener('change', () => {
        if (this.currentPlayingItem) this.playChannel(this.currentPlayingItem);
      });
    }

    // Botão Carregar Mais
    if (this.dom.btnLoadMore) {
      this.dom.btnLoadMore.addEventListener('click', () => this.appendChannelBatch(this.PAGE_SIZE));
    }

    // Delegação de eventos de clique nos canais, séries e favoritos
    if (this.dom.channelList) {
      this.dom.channelList.addEventListener('click', (e) => {
        const favBtn = e.target.closest('.btn-fav');
        if (favBtn) {
          e.stopPropagation();
          const id = favBtn.getAttribute('data-fav-id');
          const isNowFav = storage.toggleFavorite(id);
          favBtn.classList.toggle('is-fav', isNowFav);
          if (this.currentView === 'favorites') this.renderChannelGrid();
          return;
        }

        const card = e.target.closest('.channel-card');
        if (card) {
          const id = card.getAttribute('data-id');
          if (this.currentView === ItemType.SERIES) {
            const series = (this.currentFilteredSeries || []).find(s => s.id === id);
            if (series) {
              this.openSeriesDetailModal(series);
              return;
            }
          }
          const item = (this.currentFilteredItems || []).find(x => x.id === id);
          if (item) this.playChannel(item);
        }
      });
    }

    // Delegação de eventos de clique nos cartões de categoria
    if (this.dom.categoryOverviewGrid) {
      this.dom.categoryOverviewGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.category-card');
        if (card) {
          const group = card.getAttribute('data-group');
          this.selectCategory(group);
        }
      });
    }

    // Modais e Ações
    this.dom.btnOpenImport.addEventListener('click', () => this.openModal(this.dom.modalImport));
    this.dom.btnOpenSettings.addEventListener('click', () => {
      const cfg = storage.getSettings();
      if (this.dom.corsInput) this.dom.corsInput.value = cfg.corsProxy || '';
      if (this.dom.settingsStreamModeSelect) this.dom.settingsStreamModeSelect.value = cfg.streamMode || 'auto';
      if (this.dom.settingsPlayerEngineSelect) {
        const isDesktop = Boolean(window.chrome?.webview);
        const vlcOpt = this.dom.settingsPlayerEngineSelect.querySelector('option[value="vlc"]');
        if (vlcOpt) {
          vlcOpt.disabled = !isDesktop;
          if (!isDesktop) vlcOpt.textContent = `Player VLC (${i18n.get('playerEngineWebOnlyHint')})`;
        }
        this.dom.settingsPlayerEngineSelect.value = (!isDesktop && cfg.playerEngine === 'vlc') ? 'hls' : (cfg.playerEngine || 'hls');
      }
      this.openModal(this.dom.modalSettings);
    });

    // Modais de Perfis e Conta
    if (this.dom.btnOpenProfiles) {
      this.dom.btnOpenProfiles.addEventListener('click', () => this.openProfilesModal());
    }
    if (this.dom.btnCloseProfiles) {
      this.dom.btnCloseProfiles.addEventListener('click', () => this.closeModal(this.dom.modalProfiles));
    }
    if (this.dom.btnProfilesAdd) {
      this.dom.btnProfilesAdd.addEventListener('click', () => {
        this.closeModal(this.dom.modalProfiles);
        this.openModal(this.dom.modalImport);
      });
    }

    if (this.dom.btnOpenAccount) {
      this.dom.btnOpenAccount.addEventListener('click', () => this.openAccountModal());
    }
    if (this.dom.btnCloseAccount) {
      this.dom.btnCloseAccount.addEventListener('click', () => this.closeModal(this.dom.modalAccount));
    }
    if (this.dom.btnAccBack) {
      this.dom.btnAccBack.addEventListener('click', () => this.closeModal(this.dom.modalAccount));
    }
    if (this.dom.btnAccLogout) {
      this.dom.btnAccLogout.addEventListener('click', () => this.handleProfileLogout());
    }
    if (this.dom.btnAccEdit) {
      this.dom.btnAccEdit.addEventListener('click', () => {
        this.closeModal(this.dom.modalAccount);
        this.openEditProfileModal(storage.getActiveProfileId());
      });
    }

    // Modal de Edição de Perfil
    if (this.dom.btnCloseEditProfile) {
      this.dom.btnCloseEditProfile.addEventListener('click', () => this.closeModal(this.dom.modalEditProfile));
    }
    if (this.dom.btnCancelEditProfile) {
      this.dom.btnCancelEditProfile.addEventListener('click', () => this.closeModal(this.dom.modalEditProfile));
    }
    if (this.dom.btnSaveEditProfile) {
      this.dom.btnSaveEditProfile.addEventListener('click', () => this.handleSaveProfileEdit(false));
    }
    if (this.dom.btnReloadEditProfile) {
      this.dom.btnReloadEditProfile.addEventListener('click', () => this.handleSaveProfileEdit(true));
    }

    // Modal de Séries
    if (this.dom.btnCloseSeries) {
      this.dom.btnCloseSeries.addEventListener('click', () => this.closeModal(this.dom.modalSeries));
    }
    if (this.dom.btnSeriesWatchNow) {
      this.dom.btnSeriesWatchNow.addEventListener('click', () => {
        if (!this.activeSeries) return;
        const sNum = this.selectedSeason || 1;
        const eps = this.activeSeries.seasons[sNum] || this.activeSeries.episodes;
        if (eps && eps.length > 0) {
          this.closeModal(this.dom.modalSeries);
          this.playChannel(eps[0]);
        }
      });
    }
    if (this.dom.btnSeriesSeasonSelect) {
      this.dom.btnSeriesSeasonSelect.addEventListener('click', () => {
        if (!this.activeSeries) return;
        this.openSeasonsPopup();
      });
    }
    if (this.dom.btnCloseSeasonsPopup) {
      this.dom.btnCloseSeasonsPopup.addEventListener('click', () => {
        this.dom.seasonsPopup.classList.add('hidden');
      });
    }

    this.dom.btnCloseImport.addEventListener('click', () => this.closeModal(this.dom.modalImport));
    this.dom.btnCloseSettings.addEventListener('click', () => this.closeModal(this.dom.modalSettings));
    if (this.dom.btnOpenAbout) {
      this.dom.btnOpenAbout.addEventListener('click', () => this.openModal(this.dom.modalAbout));
    }
    if (this.dom.btnEmptyAbout) {
      this.dom.btnEmptyAbout.addEventListener('click', () => this.openModal(this.dom.modalAbout));
    }
    if (this.dom.btnCloseAbout) {
      this.dom.btnCloseAbout.addEventListener('click', () => this.closeModal(this.dom.modalAbout));
    }
    if (this.dom.btnEmptyImport) {
      this.dom.btnEmptyImport.addEventListener('click', () => this.openModal(this.dom.modalImport));
    }

    // Tecla Escape fecha qualquer modal ativo
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.dom.seasonsPopup && !this.dom.seasonsPopup.classList.contains('hidden')) {
          this.dom.seasonsPopup.classList.add('hidden');
          return;
        }
        const openBackdrops = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        openBackdrops.forEach(m => this.closeModal(m));
      }
    });

    // Abas de importação
    this.dom.importTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.importTabs.forEach(b => b.classList.remove('active'));
        this.dom.importPanels.forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        const panel = document.getElementById(btn.getAttribute('data-panel'));
        if (panel) panel.classList.remove('hidden');
      });
    });

    // Envio do formulário de importação
    this.dom.btnSubmitImport.addEventListener('click', () => this.handleImportSubmit());

    // Carregar lista de demonstração
    if (this.dom.btnLoadDemo) {
      this.dom.btnLoadDemo.addEventListener('click', () => this.loadDemoPlaylist());
    }

    // Salvar configurações
    if (this.dom.btnSaveSettings) {
      this.dom.btnSaveSettings.addEventListener('click', () => {
        const cfg = storage.getSettings();
        if (this.dom.corsInput) cfg.corsProxy = this.dom.corsInput.value.trim();
        if (this.dom.settingsStreamModeSelect) cfg.streamMode = this.dom.settingsStreamModeSelect.value;
        if (this.dom.settingsPlayerEngineSelect) {
          const isDesktop = Boolean(window.chrome?.webview);
          if (isDesktop || this.dom.settingsPlayerEngineSelect.value !== 'vlc') {
            cfg.playerEngine = this.dom.settingsPlayerEngineSelect.value;
          }
        }
        storage.saveSettings(cfg);
        this.closeModal(this.dom.modalSettings);
        if (this.currentPlayingItem) {
          this.playChannel(this.currentPlayingItem);
        }
      });
    }

    // Limpar dados
    if (this.dom.btnClearAllData) {
      this.dom.btnClearAllData.addEventListener('click', async () => {
        if (confirm('Tem certeza que deseja apagar todas as listas, perfis e configurações salvas?')) {
          await storage.clearAll();
          location.reload();
        }
      });
    }

    // Botão de checagem manual de atualizações
    if (this.dom.btnCheckUpdatesManual) {
      this.dom.btnCheckUpdatesManual.addEventListener('click', () => {
        this.checkAppUpdates(true);
      });
    }

    // Atalhos de teclado
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        this.player.togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        this.player.toggleMute();
      } else if (e.key === 'f' || e.key === 'F') {
        this.player.toggleFullscreen();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateChannel(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateChannel(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.seekRelative(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.seekRelative(10);
      }
    });
  }

  seekRelative(secondsDelta) {
    if (!this.player) return;
    const cur = (this.dom.video?.currentTime) || 0;
    const dur = this.currentDuration || (this.dom.video?.duration) || 0;
    if (dur > 0) {
      const targetSec = Math.max(0, Math.min(dur, cur + secondsDelta));
      const pct = targetSec / dur;
      this.player.seek(pct, targetSec);
    }
  }

  async checkAppUpdates(isManual = false) {
    if (isManual && this.dom.settingsUpdateStatus) {
      this.dom.settingsUpdateStatus.textContent = i18n.get('statusParsingM3u') || 'Verificando...';
    }

    const info = await UpdateChecker.checkForUpdates();
    if (info.hasUpdate) {
      if (this.dom.updateToast) {
        this.dom.updateToast.classList.remove('hidden');
        if (this.dom.updateToastDesc) {
          this.dom.updateToastDesc.textContent = i18n.get('updateNotificationBody', {
            latest: info.latestVersion,
            current: info.currentVersion
          });
        }
        if (this.dom.updateToastNotes && info.releaseNotes) {
          this.dom.updateToastNotes.textContent = info.releaseNotes;
        }

        if (this.dom.btnToastDismiss) {
          this.dom.btnToastDismiss.onclick = () => {
            this.dom.updateToast.classList.add('hidden');
          };
        }

        if (this.dom.btnToastUpdate) {
          this.dom.btnToastUpdate.onclick = () => {
            if (info.releaseUrl) {
              window.open(info.releaseUrl, '_blank', 'noopener,noreferrer');
            }
          };
        }
      }

      if (isManual && this.dom.settingsUpdateStatus) {
        this.dom.settingsUpdateStatus.textContent = i18n.get('updateNotificationBody', {
          latest: info.latestVersion,
          current: info.currentVersion
        });
      }
    } else {
      if (isManual && this.dom.settingsUpdateStatus) {
        this.dom.settingsUpdateStatus.textContent = i18n.get('updateUpToDate');
      }
    }
  }

  /**
   * Abre modal garantindo que o overlay nativo do VLC no Desktop seja ocultado (Item 6)
   */
  openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('data-modal-open', 'true');
    if (this.player) {
      this.player.setOverlayVisible(false);
      this.player.reportLayout();
    }
  }

  /**
   * Fecha modal e restaura visibilidade do player nativo VLC (Item 6)
   */
  closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.removeAttribute('data-modal-open');
    if (this.player) {
      this.player.setOverlayVisible(true);
      this.player.reportLayout();
    }
  }

  async loadSavedState() {
    const cfg = storage.getSettings();
    const isDesktop = Boolean(window.chrome?.webview);

    if (this.dom.streamModeSelect && cfg.streamMode) {
      this.dom.streamModeSelect.value = cfg.streamMode;
    }

    if (this.dom.playerEngineSelect) {
      if (!isDesktop) {
        const vlcOpt = this.dom.playerEngineSelect.querySelector('option[value="vlc"]');
        if (vlcOpt) {
          vlcOpt.disabled = true;
          vlcOpt.textContent += ` (${i18n.get('playerEngineWebOnlyHint')})`;
        }
        this.dom.playerEngineSelect.value = 'hls';
      } else {
        this.dom.playerEngineSelect.value = cfg.playerEngine || 'vlc';
      }
    }

    // Carrega perfil ativo
    let activeProfile = storage.getActiveProfile();
    const saved = await storage.loadPlaylist(activeProfile?.id);
    if (saved && saved.items && saved.items.length > 0) {
      this.playlist = saved;
      if (!activeProfile) {
        activeProfile = {
          id: 'prof_' + Date.now(),
          name: saved.name || 'Eu',
          type: saved.name?.includes('Xtream') ? 'xtream' : 'm3u_file',
          sourceInfo: saved.name || 'Minha Lista',
          streamMode: cfg.streamMode || 'auto',
          playerEngine: cfg.playerEngine || (isDesktop ? 'vlc' : 'hls'),
          corsProxy: cfg.corsProxy || '',
          accountInfo: {
            username: saved.name || 'Eu',
            status: 'Active',
            expDate: 'Sem expiração (M3U)',
            isTrial: 'No',
            activeCons: '0',
            createdAt: new Date().toLocaleDateString('pt-BR'),
            maxConnections: '5'
          },
          summary: saved.summary,
          createdAt: Date.now()
        };
        storage.saveProfile(activeProfile);
      }

      const rawEpg = await storage.loadEpg(activeProfile?.id);
      if (rawEpg) {
        this.epg.parse(rawEpg);
      }
    }

    if (this.dom.headerProfileName) {
      this.dom.headerProfileName.textContent = activeProfile?.name || 'Perfil';
    }
  }

  async loadDemoPlaylist() {
    const demoM3U = `#EXTM3U
#EXTINF:-1 tvg-id="test.mux" tvg-name="Mux Test Live Stream" tvg-logo="assets/logo.svg" group-title="Canais Teste",Mux Test Live Stream (HLS)
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8

#EXTINF:-1 tvg-id="akamai.live" tvg-name="Akamai Live Stream" tvg-logo="assets/logo.svg" group-title="Notícias",Akamai Live Ao Vivo (HLS)
https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8

#EXTINF:-1 tvg-id="mux.sports" tvg-name="Sports Test Stream" tvg-logo="assets/logo.svg" group-title="Esportes",Sports Multi-bitrate (HLS)
https://test-streams.mux.dev/test_001/stream.m3u8

#EXTINF:7200 tvg-id="vod.bbb" tvg-name="Big Buck Bunny 720p" tvg-logo="assets/logo.svg" group-title="Filmes Animação",Big Buck Bunny (2008)
https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4

#EXTINF:7200 tvg-id="vod.oceans" tvg-name="Oceans Nature Video" tvg-logo="assets/logo.svg" group-title="Filmes Ficção",Oceans Nature Documentary
https://vjs.zencdn.net/v/oceans.mp4

#EXTINF:3600 tvg-id="serie.pts.s01e01" tvg-name="PTS Shift S01E01 - O Começo" tvg-logo="assets/logo.svg" group-title="Séries Netflix",PTS Shift S01E01 - O Começo
https://test-streams.mux.dev/pts_shift/master.m3u8

#EXTINF:3600 tvg-id="serie.pts.s01e02" tvg-name="PTS Shift S01E02 - O Retorno" tvg-logo="assets/logo.svg" group-title="Séries Netflix",PTS Shift S01E02 - O Retorno
https://test-streams.mux.dev/pts_shift/master.m3u8

#EXTINF:3600 tvg-id="serie.pts.s02e01" tvg-name="PTS Shift S02E01 - Nova Era" tvg-logo="assets/logo.svg" group-title="Séries Netflix",PTS Shift S02E01 - Nova Era
https://test-streams.mux.dev/pts_shift/master.m3u8
`;

    const now = new Date();
    const demoXmltv = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="test.mux">
    <display-name>Mux Test Live Stream</display-name>
  </channel>
  <programme start="${this.formatXmltvDate(now, 0)}" stop="${this.formatXmltvDate(now, 2)}" channel="test.mux">
    <title>Transmissão Teste Ao Vivo</title>
    <desc>Fluxo contínuo de alta performance HLS.</desc>
    <category>Ao Vivo</category>
  </programme>
  <channel id="akamai.live">
    <display-name>Akamai Live Stream</display-name>
  </channel>
  <programme start="${this.formatXmltvDate(now, 0)}" stop="${this.formatXmltvDate(now, 3)}" channel="akamai.live">
    <title>Akamai Worldwide Feed</title>
    <desc>Cobertura internacional com múltiplos ângulos.</desc>
    <category>Notícias</category>
  </programme>
</tv>`;

    await this.processLoadedM3u(demoM3U, 'Demonstração FluiStream', demoXmltv, null, {
      name: 'Demonstração',
      type: 'm3u_file',
      sourceInfo: 'Demo Integrado'
    });
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
      let listName = this.dom.profileNameInput?.value.trim() || 'Minha Lista';
      let externalEpgUrl = this.dom.externalEpgInput.value.trim();
      let profileMeta = null;

      if (activeTab === 'panel-file') {
        const file = this.dom.fileInput.files[0];
        if (!file) throw new Error(i18n.get('labelFileSelect'));
        listName = this.dom.profileNameInput?.value.trim() || file.name.replace(/\.[^/.]+$/, '');
        m3uContent = await file.text();
        profileMeta = {
          name: listName,
          type: 'm3u_file',
          sourceInfo: `File : ${file.name}`,
          accountInfo: {
            username: listName,
            status: 'Active',
            expDate: 'Sem expiração (M3U)',
            isTrial: 'No',
            activeCons: '0',
            createdAt: new Date().toLocaleDateString('pt-BR'),
            maxConnections: '5'
          }
        };
      } else if (activeTab === 'panel-url') {
        const url = this.dom.urlInput.value.trim();
        if (!url) throw new Error(i18n.get('labelUrlInput') + ' é obrigatória');
        listName = this.dom.profileNameInput?.value.trim() || 'Lista URL';
        m3uContent = await fetchRemoteText(url);
        profileMeta = {
          name: listName,
          type: 'm3u_url',
          sourceInfo: `URL : ${url}`,
          m3uUrl: url,
          accountInfo: {
            username: listName,
            status: 'Active',
            expDate: 'Sem expiração (M3U)',
            isTrial: 'No',
            activeCons: '0',
            createdAt: new Date().toLocaleDateString('pt-BR'),
            maxConnections: '5'
          }
        };
      } else if (activeTab === 'panel-xtream') {
        const server = this.dom.xtreamServerInput.value.trim();
        const user = this.dom.xtreamUserInput.value.trim();
        const pass = this.dom.xtreamPassInput.value.trim();
        if (!server || !user || !pass) throw new Error('Preencha Servidor, Usuário e Senha');

        listName = this.dom.profileNameInput?.value.trim() || user;
        this.dom.importStatusMsg.textContent = i18n.get('statusAuthenticatingXtream');
        const cfg = storage.getSettings();
        const xtream = new XtreamApi(server, user, pass, cfg.corsProxy);

        const auth = await xtream.authenticate();
        if (!auth.success) {
          console.warn('Falha na autenticação via player_api.php, tentando baixar get.php diretamente:', auth.error);
        }

        this.dom.importStatusMsg.textContent = i18n.get('statusParsingM3u');
        m3uContent = await xtream.fetchM3uContent();
        if (!externalEpgUrl) {
          externalEpgUrl = xtream.getEpgUrl();
        }

        const expFormatted = auth.user?.expDate ? auth.user.expDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Ativa';
        const createdFormatted = auth.user?.createdAt ? auth.user.createdAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

        profileMeta = {
          name: listName,
          type: 'xtream',
          sourceInfo: `Username : ${user}`,
          xtreamServer: server,
          xtreamUser: user,
          xtreamPass: pass,
          accountInfo: {
            username: auth.user?.username || user,
            status: auth.user?.status || 'Active',
            expDate: expFormatted,
            isTrial: auth.user?.isTrial || 'No',
            activeCons: String(auth.user?.activeCons || '0'),
            createdAt: createdFormatted,
            maxConnections: String(auth.user?.maxConnections || '1'),
            serverUrl: server
          }
        };
      }

      await this.processLoadedM3u(m3uContent, listName, null, externalEpgUrl, profileMeta);
      this.closeModal(this.dom.modalImport);
    } catch (err) {
      alert(`Erro: ${err.message}`);
      this.dom.importStatusMsg.textContent = err.message;
    } finally {
      this.dom.btnSubmitImport.disabled = false;
    }
  }

  async processLoadedM3u(m3uContent, name, embeddedXmltv = null, externalEpgUrl = null, profileMeta = null) {
    const parsed = M3UParser.parse(m3uContent);
    if (!parsed.items || parsed.items.length === 0) {
      throw new Error(i18n.get('errorM3uEmpty'));
    }

    const cfg = storage.getSettings();
    const isDesktop = Boolean(window.chrome?.webview);
    const profileId = profileMeta?.id || ('prof_' + Date.now());
    const profileName = profileMeta?.name || name || 'Perfil';

    const profile = {
      id: profileId,
      name: profileName,
      type: profileMeta?.type || 'm3u_file',
      sourceInfo: profileMeta?.sourceInfo || name || 'Lista M3U',
      streamMode: profileMeta?.streamMode || this.dom.streamModeSelect?.value || 'auto',
      playerEngine: profileMeta?.playerEngine || this.dom.playerEngineSelect?.value || (isDesktop ? 'vlc' : 'hls'),
      corsProxy: profileMeta?.corsProxy || cfg.corsProxy || '',
      externalEpgUrl: externalEpgUrl || parsed.epgUrl,
      accountInfo: profileMeta?.accountInfo || {
        username: profileName,
        status: 'Active',
        expDate: 'Sem expiração (M3U)',
        isTrial: 'No',
        activeCons: '0',
        createdAt: new Date().toLocaleDateString('pt-BR'),
        maxConnections: '5'
      },
      summary: parsed.summary,
      createdAt: Date.now()
    };

    storage.saveProfile(profile);
    storage.setActiveProfileId(profile.id);

    this.playlist = {
      name: profileName,
      items: parsed.items,
      epgUrl: externalEpgUrl || parsed.epgUrl,
      summary: parsed.summary
    };

    await storage.savePlaylist(this.playlist, profile.id);

    if (this.dom.headerProfileName) {
      this.dom.headerProfileName.textContent = profile.name;
    }

    // Processamento de EPG (.xml ou .xml.gz)
    if (embeddedXmltv) {
      this.epg.parse(embeddedXmltv);
      await storage.saveEpg(embeddedXmltv, profile.id);
      this.updateCurrentEpgDisplay();
    } else if (this.playlist.epgUrl && this.dom.useEmbeddedEpgCheck?.checked !== false) {
      this.fetchAndParseEpg(this.playlist.epgUrl, profile.id);
    }

    this.selectedGroup = null;
    this.render();

    // Auto-reproduzir primeiro canal ao vivo
    const firstLive = this.playlist.items.find(x => x.type === ItemType.LIVE) || this.playlist.items[0];
    if (firstLive) {
      this.playChannel(firstLive);
    }
  }

  async fetchAndParseEpg(epgUrl, profileId = null) {
    try {
      if (this.dom.epgStatusBadge) {
        this.dom.epgStatusBadge.textContent = 'Carregando EPG...';
      }
      const xml = await fetchRemoteText(epgUrl);
      if (xml && xml.includes('<tv')) {
        this.epg.parse(xml);
        await storage.saveEpg(xml, profileId || storage.getActiveProfileId());
        this.updateCurrentEpgDisplay();
        if (this.dom.epgStatusBadge) {
          const totalProgs = Array.from(this.epg.programmes.values()).reduce((acc, p) => acc + p.length, 0);
          this.dom.epgStatusBadge.textContent = `EPG: ${totalProgs} progs`;
        }
      }
    } catch (e) {
      console.warn('Falha ao baixar EPG:', e);
      if (this.dom.epgStatusBadge) {
        this.dom.epgStatusBadge.textContent = 'EPG Indisponível';
      }
    }
  }

  stopPlayback() {
    if (this.player) {
      this.player.stop();
    }
    this.currentPlayingItem = null;
    this.updatePlayPauseUi(false);

    if (this.dom.currentChannelName) this.dom.currentChannelName.textContent = i18n.get('appName');
    if (this.dom.currentChannelGroup) this.dom.currentChannelGroup.textContent = '';
    if (this.dom.currentChannelLogo) this.dom.currentChannelLogo.classList.add('hidden');
    if (this.dom.currentProgramTitle) this.dom.currentProgramTitle.textContent = i18n.get('noEpgAvailable');
    if (this.dom.currentProgramTime) {
      this.dom.currentProgramTime.textContent = '';
      this.dom.currentProgramTime.classList.add('hidden');
    }
    if (this.dom.currentProgramRemaining) this.dom.currentProgramRemaining.textContent = '';
    if (this.dom.currentProgramProgress) this.dom.currentProgramProgress.style.width = '0%';
    if (this.dom.progressThumb) this.dom.progressThumb.style.left = '0%';
  }

  closePlayerAndReset() {
    this.stopPlayback();
    this.selectedGroup = null;
    this.searchQuery = '';
    if (this.dom.searchInput) this.dom.searchInput.value = '';
    this.render();
  }

  navigateChannel(delta) {
    const liveItems = (this.currentFilteredItems.length > 0 ? this.currentFilteredItems : this.playlist.items).filter(x => x.type === ItemType.LIVE);
    if (liveItems.length === 0) return;

    let nextIndex = 0;
    if (this.currentPlayingItem) {
      const curIdx = liveItems.findIndex(x => x.id === this.currentPlayingItem.id);
      if (curIdx !== -1) {
        nextIndex = (curIdx + delta + liveItems.length) % liveItems.length;
      }
    }
    this.playChannel(liveItems[nextIndex]);
  }

  handlePlayerState(state, details = null) {
    if (!this.dom.playerLoadingOverlay || !this.dom.playerErrorOverlay) return;

    switch (state) {
      case 'loading':
      case 'buffering':
        this.dom.playerLoadingOverlay.classList.remove('hidden');
        this.dom.playerErrorOverlay.classList.add('hidden');
        if (this.dom.playerLoadingText) {
          this.dom.playerLoadingText.textContent = state === 'buffering' ? 'Buffering...' : i18n.get('playerLoading');
        }
        break;
      case 'playing':
        this.dom.playerLoadingOverlay.classList.add('hidden');
        this.dom.playerErrorOverlay.classList.add('hidden');
        this.updatePlayPauseUi(true);
        break;
      case 'paused':
      case 'idle':
      case 'ready':
        this.dom.playerLoadingOverlay.classList.add('hidden');
        this.dom.playerErrorOverlay.classList.add('hidden');
        this.updatePlayPauseUi(false);
        break;
      case 'error':
        this.dom.playerLoadingOverlay.classList.add('hidden');
        this.dom.playerErrorOverlay.classList.remove('hidden');
        this.updatePlayPauseUi(false);
        if (this.dom.playerErrorMsg) {
          const detailStr = details?.details || details?.type || '';
          this.dom.playerErrorMsg.textContent = `${i18n.get('playerErrorPlayback')} ${detailStr}`;
        }
        break;
    }
  }

  updatePlayPauseUi(isPlaying) {
    if (!this.dom.btnPlayerPlayPause) return;
    if (this.dom.iconPlayerPause && this.dom.iconPlayerPlay) {
      if (isPlaying) {
        this.dom.iconPlayerPlay.classList.add('hidden');
        this.dom.iconPlayerPause.classList.remove('hidden');
      } else {
        this.dom.iconPlayerPlay.classList.remove('hidden');
        this.dom.iconPlayerPause.classList.add('hidden');
      }
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

    const isSearching = Boolean(this.searchQuery);
    const hasGroupSelected = (this.selectedGroup !== null);

    if (!isSearching && !hasGroupSelected) {
      // Exibir Tela Inicial de Categorias
      if (this.dom.categoryOverviewSection) this.dom.categoryOverviewSection.classList.remove('hidden');
      if (this.dom.channelGridSection) this.dom.channelGridSection.classList.add('hidden');
      if (this.dom.categoryNavBar) this.dom.categoryNavBar.classList.add('hidden');
      this.renderCategoryOverview();
    } else {
      // Exibir Grade de Canais ou Séries
      if (this.dom.categoryOverviewSection) this.dom.categoryOverviewSection.classList.add('hidden');
      if (this.dom.channelGridSection) this.dom.channelGridSection.classList.remove('hidden');
      if (this.dom.categoryNavBar) {
        this.dom.categoryNavBar.classList.remove('hidden');
        if (this.dom.categoryCurrentTitle) {
          const groupName = this.selectedGroup === 'all' ? i18n.get('allCategories') : (this.selectedGroup || i18n.get('allCategories'));
          this.dom.categoryCurrentTitle.textContent = isSearching ? `Busca: "${this.searchQuery}"` : groupName;
        }
      }
      this.renderChannelGrid();
    }
  }

  getCurrentViewItems() {
    let items = [];
    if (this.currentView === 'favorites') {
      const favIds = storage.getFavorites();
      items = this.playlist.items.filter(x => favIds.includes(x.id));
    } else {
      items = this.playlist.items.filter(x => x.type === this.currentView);
    }
    return items;
  }

  renderCategories() {
    if (!this.dom.categoryList) return;
    const items = this.getCurrentViewItems();
    const groupsMap = new Map();
    items.forEach(it => {
      const g = it.group || 'Geral';
      groupsMap.set(g, (groupsMap.get(g) || 0) + 1);
    });

    const sortedGroups = Array.from(groupsMap.entries()).sort((a, b) => b[1] - a[1]);

    let html = `
      <button class="cat-pill ${this.selectedGroup === null ? 'active' : ''}" data-group="null">
        📑 ${i18n.get('categoryOverviewTitle')}
      </button>
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
        const group = btn.getAttribute('data-group');
        this.selectCategory(group === 'null' ? null : group);
      });
    });
  }

  renderCategoryOverview() {
    if (!this.dom.categoryOverviewGrid) return;
    const items = this.getCurrentViewItems();
    const groupsMap = new Map();
    items.forEach(it => {
      const g = it.group || 'Geral';
      groupsMap.set(g, (groupsMap.get(g) || 0) + 1);
    });

    const sortedGroups = Array.from(groupsMap.entries()).sort((a, b) => b[1] - a[1]);
    const isVod = (this.currentView === ItemType.MOVIE || this.currentView === ItemType.SERIES);
    const countLabelKey = isVod ? 'categoryCountVod' : 'categoryCountChannels';

    let html = `
      <div class="category-card" data-group="all">
        <div class="category-card-top">
          <span class="category-card-title">${i18n.get('categoryExploreAll')}</span>
          <div class="category-card-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          </div>
        </div>
        <div class="category-card-bottom">
          <span class="category-card-count">${i18n.get(countLabelKey, { count: items.length })}</span>
          <span class="category-card-arrow">→</span>
        </div>
      </div>
    `;

    sortedGroups.forEach(([groupName, count]) => {
      html += `
        <div class="category-card" data-group="${this.escapeHtml(groupName)}">
          <div class="category-card-top">
            <span class="category-card-title">${this.escapeHtml(groupName)}</span>
            <div class="category-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
          </div>
          <div class="category-card-bottom">
            <span class="category-card-count">${i18n.get(countLabelKey, { count })}</span>
            <span class="category-card-arrow">→</span>
          </div>
        </div>
      `;
    });

    this.dom.categoryOverviewGrid.innerHTML = html;
    this.dom.itemCountBadge.textContent = i18n.get('channelCount', { count: items.length });
  }

  selectCategory(groupName) {
    this.selectedGroup = groupName;
    this.render();
    if (groupName !== null) {
      window.scrollTo({ top: 350, behavior: 'smooth' });
    }
  }

  getFilteredItems() {
    let items = this.getCurrentViewItems();

    if (this.selectedGroup && this.selectedGroup !== 'all') {
      items = items.filter(x => x.group === this.selectedGroup);
    }

    if (this.searchQuery) {
      items = items.filter(x =>
        x.name.toLowerCase().includes(this.searchQuery) ||
        (x.group && x.group.toLowerCase().includes(this.searchQuery))
      );
    }

    return items;
  }

  // --- AGRUPAMENTO DE SÉRIES POR NOME E TEMPORADA (Item 2) ---
  groupSeriesItems(rawItems) {
    const seriesMap = new Map();

    rawItems.forEach(it => {
      let sTitle = it.seriesTitle;
      if (!sTitle) {
        sTitle = it.name.replace(/\s*[-–]\s*(?:T|S)?\d+.*$/i, '').trim();
      }
      const normKey = sTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (!seriesMap.has(normKey)) {
        seriesMap.set(normKey, {
          id: `series_${normKey}`,
          seriesTitle: sTitle,
          group: it.group || 'Séries',
          logo: it.logo,
          type: ItemType.SERIES,
          seasons: {},
          episodes: [],
          sampleItem: it
        });
      }

      const ser = seriesMap.get(normKey);
      if (!ser.logo && it.logo) ser.logo = it.logo;
      const sNum = it.season || 1;
      if (!ser.seasons[sNum]) ser.seasons[sNum] = [];
      ser.seasons[sNum].push(it);
      ser.episodes.push(it);
    });

    const result = Array.from(seriesMap.values());
    result.forEach(s => {
      s.totalSeasons = Object.keys(s.seasons).length;
      s.totalEpisodes = s.episodes.length;
      for (const seasonKey of Object.keys(s.seasons)) {
        s.seasons[seasonKey].sort((a, b) => (a.episode || 0) - (b.episode || 0));
      }
    });

    return result;
  }

  getGroupedSeries() {
    let rawItems = this.playlist.items.filter(x => x.type === ItemType.SERIES);
    if (this.selectedGroup && this.selectedGroup !== 'all') {
      rawItems = rawItems.filter(x => x.group === this.selectedGroup);
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      rawItems = rawItems.filter(x =>
        x.name.toLowerCase().includes(q) ||
        (x.seriesTitle && x.seriesTitle.toLowerCase().includes(q)) ||
        (x.group && x.group.toLowerCase().includes(q))
      );
    }
    return this.groupSeriesItems(rawItems);
  }

  renderChannelGrid() {
    this.renderedCount = 0;

    if (this.currentView === ItemType.SERIES) {
      this.currentFilteredSeries = this.getGroupedSeries();
      this.dom.itemCountBadge.textContent = i18n.get('channelCount', { count: this.currentFilteredSeries.length });

      if (this.currentFilteredSeries.length === 0) {
        this.dom.channelList.innerHTML = `
          <div class="empty-search text-center py-12 text-slate-400" style="grid-column: 1 / -1;">
            <p>${i18n.get('noEpgAvailable')}</p>
          </div>
        `;
        if (this.dom.loadMoreWrap) this.dom.loadMoreWrap.classList.add('hidden');
        return;
      }

      this.dom.channelList.innerHTML = '';
      this.appendSeriesBatch(this.PAGE_SIZE);
      return;
    }

    this.currentFilteredItems = this.getFilteredItems();
    this.dom.itemCountBadge.textContent = i18n.get('channelCount', { count: this.currentFilteredItems.length });

    if (this.currentFilteredItems.length === 0) {
      this.dom.channelList.innerHTML = `
        <div class="empty-search text-center py-12 text-slate-400" style="grid-column: 1 / -1;">
          <p>${i18n.get('noEpgAvailable')}</p>
        </div>
      `;
      if (this.dom.loadMoreWrap) this.dom.loadMoreWrap.classList.add('hidden');
      return;
    }

    this.dom.channelList.innerHTML = '';
    this.appendChannelBatch(this.PAGE_SIZE);
  }

  appendSeriesBatch(count = 60) {
    const nextBatch = this.currentFilteredSeries.slice(this.renderedCount, this.renderedCount + count);
    if (nextBatch.length === 0) return;

    let html = '';
    nextBatch.forEach(ser => {
      const logoUrl = ser.logo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="%238B949E" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>';
      const seasonText = ser.totalSeasons === 1 ? i18n.get('seasonLabel', { num: 1 }) : i18n.get('seasonsCount', { count: ser.totalSeasons });
      const epText = i18n.get('episodesCount', { count: ser.totalEpisodes });

      html += `
        <div class="channel-card" data-id="${ser.id}" style="cursor: pointer;">
          <div class="channel-card-inner">
            <div class="channel-logo-wrap" style="aspect-ratio: 2 / 3; height: auto;">
              <img src="${logoUrl}" alt="${this.escapeHtml(ser.seriesTitle)}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'48\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23555\\' stroke-width=\\'1.5\\'><rect x=\\'2\\' y=\\'7\\' width=\\'20\\' height=\\'15\\' rx=\\'2\\'/><polyline points=\\'17 2 12 7 7 2\\'/></svg>'" />
            </div>
            <div class="channel-info">
              <span class="channel-badge series">${i18n.get('navSeries').toUpperCase()}</span>
              <h4 class="channel-title">${this.escapeHtml(ser.seriesTitle)}</h4>
              <p class="channel-group">${this.escapeHtml(ser.group || '')}</p>
              <div class="channel-card-epg">
                <span style="font-size: 0.75rem; color: #10B981; font-weight: 600;">${seasonText} • ${epText}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    this.dom.channelList.insertAdjacentHTML('beforeend', html);
    this.renderedCount += nextBatch.length;

    if (this.renderedCount < this.currentFilteredSeries.length) {
      if (this.dom.loadMoreWrap) {
        this.dom.loadMoreWrap.classList.remove('hidden');
        if (this.dom.btnLoadMore) {
          this.dom.btnLoadMore.textContent = i18n.get('btnLoadMore', {
            shown: this.renderedCount,
            total: this.currentFilteredSeries.length
          });
        }
      }
    } else {
      if (this.dom.loadMoreWrap) this.dom.loadMoreWrap.classList.add('hidden');
    }
  }

  appendChannelBatch(count = 60) {
    const nextBatch = this.currentFilteredItems.slice(this.renderedCount, this.renderedCount + count);
    if (nextBatch.length === 0) return;

    let html = '';
    nextBatch.forEach(item => {
      const isFav = storage.isFavorite(item.id);
      const isPlaying = this.currentPlayingItem && this.currentPlayingItem.id === item.id;
      const logoUrl = item.logo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="%238B949E" stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>';

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

    this.dom.channelList.insertAdjacentHTML('beforeend', html);
    this.renderedCount += nextBatch.length;

    if (this.renderedCount < this.currentFilteredItems.length) {
      if (this.dom.loadMoreWrap) {
        this.dom.loadMoreWrap.classList.remove('hidden');
        if (this.dom.btnLoadMore) {
          this.dom.btnLoadMore.textContent = i18n.get('btnLoadMore', {
            shown: this.renderedCount,
            total: this.currentFilteredItems.length
          });
        }
      }
    } else {
      if (this.dom.loadMoreWrap) this.dom.loadMoreWrap.classList.add('hidden');
    }
  }

  // --- MODAL DE DETALHES DE SÉRIES (Telas 3 e 4) ---
  openSeriesDetailModal(series) {
    if (!series) return;
    this.activeSeries = series;

    const seasonKeys = Object.keys(series.seasons).map(k => parseInt(k, 10)).sort((a, b) => a - b);
    this.selectedSeason = seasonKeys[0] || 1;

    if (this.dom.seriesPoster) {
      this.dom.seriesPoster.src = series.logo || 'assets/logo.svg';
    }
    if (this.dom.seriesTitle) {
      this.dom.seriesTitle.textContent = series.seriesTitle;
    }
    if (this.dom.seriesGenre) {
      this.dom.seriesGenre.textContent = series.group || 'Série';
    }
    if (this.dom.seriesStats) {
      this.dom.seriesStats.textContent = `${i18n.get('seasonsCount', { count: series.totalSeasons })} • ${i18n.get('episodesCount', { count: series.totalEpisodes })}`;
    }
    if (this.dom.seriesDesc) {
      const sample = series.sampleItem;
      this.dom.seriesDesc.textContent = sample?.desc || sample?.rawTitle || 'Sinopse disponível nos episódios da série.';
    }

    this.updateSeasonButton();
    this.renderSeasonEpisodes(this.selectedSeason);
    this.openModal(this.dom.modalSeries);
  }

  updateSeasonButton() {
    if (this.dom.btnSeriesSeasonSelect) {
      this.dom.btnSeriesSeasonSelect.textContent = `SEASON - ${this.selectedSeason} ▾`;
    }
  }

  openSeasonsPopup() {
    if (!this.activeSeries || !this.dom.seasonsPopupList) return;
    const seasonKeys = Object.keys(this.activeSeries.seasons).map(k => parseInt(k, 10)).sort((a, b) => a - b);

    let html = '';
    seasonKeys.forEach(sNum => {
      const active = sNum === this.selectedSeason ? 'active' : '';
      html += `
        <button class="season-select-item ${active}" data-season="${sNum}">
          Season - ${sNum}
        </button>
      `;
    });

    this.dom.seasonsPopupList.innerHTML = html;
    this.dom.seasonsPopupList.querySelectorAll('.season-select-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = parseInt(btn.getAttribute('data-season'), 10);
        this.selectedSeason = chosen;
        this.updateSeasonButton();
        this.renderSeasonEpisodes(chosen);
        this.dom.seasonsPopup.classList.add('hidden');
      });
    });

    this.dom.seasonsPopup.classList.remove('hidden');
  }

  renderSeasonEpisodes(seasonNum) {
    if (!this.activeSeries || !this.dom.seriesEpisodesContainer) return;
    const episodes = this.activeSeries.seasons[seasonNum] || [];

    if (episodes.length === 0) {
      this.dom.seriesEpisodesContainer.innerHTML = `
        <div style="padding: 1.5rem; text-align: center; color: var(--text-secondary);">
          Nenhum episódio encontrado para esta temporada.
        </div>
      `;
      return;
    }

    let html = '';
    episodes.forEach((ep, idx) => {
      const epNum = ep.episode || (idx + 1);
      const epTitle = `${this.activeSeries.seriesTitle} - S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')} - ${i18n.get('episodeNumber', { num: epNum })}`;
      const durText = ep.duration > 0 ? this.formatDuration(ep.duration) : '00:45:00';
      const thumb = ep.logo || this.activeSeries.logo || 'assets/logo.svg';

      html += `
        <div class="episode-item-row" data-ep-id="${ep.id}">
          <div class="episode-thumb-box">
            <img src="${thumb}" alt="${this.escapeHtml(epTitle)}" loading="lazy" />
          </div>
          <div class="episode-row-info">
            <div class="episode-row-title">${this.escapeHtml(epTitle)}</div>
            <div class="episode-row-duration">⏱ ${durText}</div>
          </div>
          <div class="episode-play-icon" title="${i18n.get('playerPlay')}">
            ▶
          </div>
        </div>
      `;
    });

    this.dom.seriesEpisodesContainer.innerHTML = html;
    this.dom.seriesEpisodesContainer.querySelectorAll('.episode-item-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-ep-id');
        const episode = episodes.find(x => x.id === id);
        if (episode) {
          this.closeModal(this.dom.modalSeries);
          this.playChannel(episode);
        }
      });
    });
  }

  // --- GESTÃO DE PERFIS / MULTI-PLAYLIST (Telas 6 e 7) ---
  openProfilesModal() {
    const profiles = storage.getProfiles();
    const activeId = storage.getActiveProfileId();

    if (!this.dom.profilesGrid) return;

    if (profiles.length === 0) {
      this.dom.profilesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-secondary);">
          <p>Nenhum perfil cadastrado.</p>
        </div>
      `;
    } else {
      let html = '';
      profiles.forEach(p => {
        const isActive = p.id === activeId;
        const iconSvg = p.type === 'xtream'
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
          : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

        html += `
          <div class="profile-card ${isActive ? 'active-profile' : ''}" data-profile-id="${p.id}">
            <div class="profile-card-icon">
              ${iconSvg}
            </div>
            <div class="profile-card-details">
              <div class="profile-card-title">
                ${this.escapeHtml(p.name)}
                ${isActive ? `<span class="profile-tag-active">${i18n.get('profileActiveBadge')}</span>` : ''}
              </div>
              <div class="profile-card-sub">${this.escapeHtml(p.sourceInfo || '')}</div>
            </div>
            <div class="profile-card-actions">
              <button class="btn-secondary btn-icon btn-profile-info" data-info-id="${p.id}" title="${i18n.get('btnAccountInfo')}">
                ℹ
              </button>
              <button class="btn-secondary btn-icon btn-profile-edit" data-edit-id="${p.id}" title="${i18n.get('btnEditProfile')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-secondary btn-icon btn-profile-del" data-del-id="${p.id}" title="${i18n.get('btnDeleteProfile')}" style="color: #EF4444;">
                ✕
              </button>
            </div>
          </div>
        `;
      });

      this.dom.profilesGrid.innerHTML = html;

      // Eventos dos cards de perfil
      this.dom.profilesGrid.querySelectorAll('.profile-card').forEach(card => {
        card.addEventListener('click', async (e) => {
          if (e.target.closest('.profile-card-actions')) return;
          const pId = card.getAttribute('data-profile-id');
          await this.switchProfile(pId);
        });
      });

      this.dom.profilesGrid.querySelectorAll('.btn-profile-info').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const pId = btn.getAttribute('data-info-id');
          const targetProf = profiles.find(p => p.id === pId);
          this.closeModal(this.dom.modalProfiles);
          this.openAccountModal(targetProf);
        });
      });

      this.dom.profilesGrid.querySelectorAll('.btn-profile-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const pId = btn.getAttribute('data-edit-id');
          this.closeModal(this.dom.modalProfiles);
          this.openEditProfileModal(pId);
        });
      });

      this.dom.profilesGrid.querySelectorAll('.btn-profile-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const pId = btn.getAttribute('data-del-id');
          if (confirm(i18n.get('confirmDeleteProfile'))) {
            await storage.deleteProfile(pId);
            const remaining = storage.getProfiles();
            if (remaining.length > 0) {
              await this.switchProfile(remaining[0].id);
            } else {
              this.stopPlayback();
              this.playlist = { items: [], summary: { total: 0, live: 0, movies: 0, series: 0 }, name: '' };
              this.render();
            }
            this.openProfilesModal();
          }
        });
      });
    }

    this.openModal(this.dom.modalProfiles);
  }

  async switchProfile(profileId) {
    storage.setActiveProfileId(profileId);
    const prof = storage.getActiveProfile();
    if (this.dom.headerProfileName) {
      this.dom.headerProfileName.textContent = prof?.name || 'Perfil';
    }

    const saved = await storage.loadPlaylist(profileId);
    if (saved && saved.items) {
      this.playlist = saved;
      const rawEpg = await storage.loadEpg(profileId);
      if (rawEpg) {
        this.epg.parse(rawEpg);
      } else {
        this.epg.channels.clear();
        this.epg.programmes.clear();
      }
    } else {
      this.playlist = { items: [], summary: { total: 0, live: 0, movies: 0, series: 0 }, name: '' };
    }

    this.closeModal(this.dom.modalProfiles);
    this.selectedGroup = null;
    this.searchQuery = '';
    this.render();

    // Auto-reproduz primeiro canal do perfil
    const firstLive = this.playlist.items.find(x => x.type === ItemType.LIVE) || this.playlist.items[0];
    if (firstLive) {
      this.playChannel(firstLive);
    }
  }

  openAccountModal(targetProfile = null) {
    const prof = targetProfile || storage.getActiveProfile();
    const acc = prof?.accountInfo || {
      username: prof?.name || 'Eu',
      status: 'Active',
      expDate: 'Sem expiração (M3U)',
      isTrial: 'No',
      activeCons: '0',
      createdAt: new Date().toLocaleDateString('pt-BR'),
      maxConnections: '5'
    };

    if (this.dom.accUsername) this.dom.accUsername.textContent = acc.username || prof?.name || '-';
    if (this.dom.accStatus) {
      this.dom.accStatus.textContent = acc.status || 'Active';
      this.dom.accStatus.className = `account-info-value ${acc.status === 'Active' ? 'status-active' : ''}`;
    }
    if (this.dom.accExpDate) this.dom.accExpDate.textContent = acc.expDate || 'Sem expiração';
    if (this.dom.accTrial) this.dom.accTrial.textContent = acc.isTrial || 'No';
    if (this.dom.accActiveCons) this.dom.accActiveCons.textContent = acc.activeCons || '0';
    if (this.dom.accCreatedAt) this.dom.accCreatedAt.textContent = acc.createdAt || '-';
    if (this.dom.accMaxCons) this.dom.accMaxCons.textContent = acc.maxConnections || '1';

    this.openModal(this.dom.modalAccount);
  }

  async handleProfileLogout() {
    const activeProf = storage.getActiveProfile();
    if (activeProf && confirm(`Deseja sair do perfil "${activeProf.name}"?`)) {
      await storage.deleteProfile(activeProf.id);
      this.closeModal(this.dom.modalAccount);
      const remaining = storage.getProfiles();
      if (remaining.length > 0) {
        await this.switchProfile(remaining[0].id);
      } else {
        this.stopPlayback();
        this.playlist = { items: [], summary: { total: 0, live: 0, movies: 0, series: 0 }, name: '' };
        this.render();
      }
    }
  }

  openEditProfileModal(profileId) {
    const profiles = storage.getProfiles();
    const prof = profiles.find(p => p.id === profileId) || storage.getActiveProfile();
    if (!prof || !this.dom.modalEditProfile) return;

    if (this.dom.editProfileId) this.dom.editProfileId.value = prof.id;
    if (this.dom.editProfileType) this.dom.editProfileType.value = prof.type || 'm3u_file';
    if (this.dom.inputEditProfileName) this.dom.inputEditProfileName.value = prof.name || '';

    if (prof.type === 'xtream') {
      if (this.dom.editSectionXtream) this.dom.editSectionXtream.classList.remove('hidden');
      if (this.dom.editSectionM3uUrl) this.dom.editSectionM3uUrl.classList.add('hidden');
      if (this.dom.inputEditXtreamServer) this.dom.inputEditXtreamServer.value = prof.url || prof.serverUrl || prof.accountInfo?.serverUrl || '';
      if (this.dom.inputEditXtreamUser) this.dom.inputEditXtreamUser.value = prof.username || prof.accountInfo?.username || '';
      if (this.dom.inputEditXtreamPass) this.dom.inputEditXtreamPass.value = prof.password || prof.accountInfo?.password || '';
      if (this.dom.btnReloadEditProfile) this.dom.btnReloadEditProfile.style.display = 'inline-block';
    } else if (prof.type === 'm3u_url') {
      if (this.dom.editSectionXtream) this.dom.editSectionXtream.classList.add('hidden');
      if (this.dom.editSectionM3uUrl) this.dom.editSectionM3uUrl.classList.remove('hidden');
      if (this.dom.inputEditM3uUrl) this.dom.inputEditM3uUrl.value = prof.url || prof.m3uUrl || '';
      if (this.dom.btnReloadEditProfile) this.dom.btnReloadEditProfile.style.display = 'inline-block';
    } else {
      if (this.dom.editSectionXtream) this.dom.editSectionXtream.classList.add('hidden');
      if (this.dom.editSectionM3uUrl) this.dom.editSectionM3uUrl.classList.add('hidden');
      if (this.dom.btnReloadEditProfile) this.dom.btnReloadEditProfile.style.display = 'none';
    }

    if (this.dom.inputEditExternalEpg) this.dom.inputEditExternalEpg.value = prof.epgUrl || '';
    if (this.dom.selectEditStreamMode) this.dom.selectEditStreamMode.value = prof.streamMode || 'auto';
    if (this.dom.selectEditPlayerEngine) this.dom.selectEditPlayerEngine.value = prof.playerEngine || 'hls';
    if (this.dom.inputEditCorsProxy) this.dom.inputEditCorsProxy.value = prof.corsProxy || '';
    if (this.dom.editProfileStatus) this.dom.editProfileStatus.textContent = '';

    this.openModal(this.dom.modalEditProfile);
  }

  async handleSaveProfileEdit(reloadContent = false) {
    const profId = this.dom.editProfileId?.value;
    if (!profId) return;

    const profiles = storage.getProfiles();
    const prof = profiles.find(p => p.id === profId);
    if (!prof) return;

    const newName = this.dom.inputEditProfileName?.value.trim() || prof.name;
    const newEpgUrl = this.dom.inputEditExternalEpg?.value.trim() || null;
    const newStreamMode = this.dom.selectEditStreamMode?.value || 'auto';
    const newPlayerEngine = this.dom.selectEditPlayerEngine?.value || 'hls';
    const newCorsProxy = this.dom.inputEditCorsProxy?.value.trim() || '';

    prof.name = newName;
    prof.epgUrl = newEpgUrl;
    prof.streamMode = newStreamMode;
    prof.playerEngine = newPlayerEngine;
    prof.corsProxy = newCorsProxy;

    let sourceChanged = false;

    if (prof.type === 'xtream') {
      const newServer = this.dom.inputEditXtreamServer?.value.trim() || '';
      const newUser = this.dom.inputEditXtreamUser?.value.trim() || '';
      const newPass = this.dom.inputEditXtreamPass?.value.trim() || '';

      if (newServer !== prof.url || newUser !== prof.username || newPass !== prof.password) {
        sourceChanged = true;
      }

      prof.url = newServer;
      prof.serverUrl = newServer;
      prof.username = newUser;
      prof.password = newPass;
      try {
        const u = new URL(newServer);
        prof.sourceInfo = `${newUser}@${u.host}`;
      } catch {
        prof.sourceInfo = `${newUser}@${newServer}`;
      }
      if (!prof.accountInfo) prof.accountInfo = {};
      prof.accountInfo.username = newUser;
      prof.accountInfo.serverUrl = newServer;
      prof.accountInfo.password = newPass;
    } else if (prof.type === 'm3u_url') {
      const newUrl = this.dom.inputEditM3uUrl?.value.trim() || '';
      if (newUrl !== prof.url) {
        sourceChanged = true;
      }
      prof.url = newUrl;
      prof.m3uUrl = newUrl;
      prof.sourceInfo = `URL : ${newUrl}`;
    }

    storage.saveProfile(prof);

    const isActive = prof.id === storage.getActiveProfileId();
    if (isActive) {
      if (this.dom.headerProfileName) this.dom.headerProfileName.textContent = prof.name;
      if (this.dom.streamModeSelect) this.dom.streamModeSelect.value = prof.streamMode;
      if (this.dom.playerEngineSelect) this.dom.playerEngineSelect.value = prof.playerEngine;
    }

    if ((reloadContent || sourceChanged) && (prof.type === 'xtream' || prof.type === 'm3u_url')) {
      if (this.dom.editProfileStatus) {
        this.dom.editProfileStatus.textContent = i18n.get('statusParsingM3u') || 'Atualizando lista...';
      }
      try {
        await this.reloadRemoteProfileData(prof);
      } catch (err) {
        console.warn('Erro ao atualizar lista:', err);
      }
    } else if (newEpgUrl && newEpgUrl !== this.playlist?.epgUrl) {
      this.fetchAndParseEpg(newEpgUrl, prof.id);
    }

    this.closeModal(this.dom.modalEditProfile);
    this.openProfilesModal();
  }

  async reloadRemoteProfileData(prof) {
    if (prof.type === 'xtream') {
      const cfg = storage.getSettings();
      const xtream = new XtreamApi(prof.url, prof.username, prof.password, prof.corsProxy || cfg.corsProxy);
      const m3uUrl = xtream.getM3uUrl();
      const m3uContent = await fetchRemoteText(m3uUrl);
      const epgUrl = prof.epgUrl || xtream.getEpgUrl();
      await this.processLoadedM3u(m3uContent, prof.name, null, epgUrl, prof);
    } else if (prof.type === 'm3u_url') {
      const m3uContent = await fetchRemoteText(prof.url);
      await this.processLoadedM3u(m3uContent, prof.name, null, prof.epgUrl, prof);
    }
  }

  updateTrackSelectors({ audioTracks, subtitleTracks, currentAudioTrack, currentSubtitleTrack }) {
    if (this.dom.selectPlayerAudio) {
      const sel = this.dom.selectPlayerAudio;
      sel.innerHTML = `<option value="-1">${i18n.get('playerAudioDefault')}</option>`;
      if (audioTracks && audioTracks.length > 0) {
        audioTracks.forEach((t) => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.name ? `Áudio: ${t.name}` : `Faixa ${t.id}`;
          if (t.id === currentAudioTrack) opt.selected = true;
          sel.appendChild(opt);
        });
      }
    }

    if (this.dom.selectPlayerSubtitles) {
      const sel = this.dom.selectPlayerSubtitles;
      sel.innerHTML = `<option value="-1">${i18n.get('playerSubtitlesNone')}</option>`;
      if (subtitleTracks && subtitleTracks.length > 0) {
        subtitleTracks.forEach((t) => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.name ? `Legenda: ${t.name}` : `Legenda ${t.id}`;
          if (t.id === currentSubtitleTrack) opt.selected = true;
          sel.appendChild(opt);
        });
      }
    }
  }

  playChannel(item) {
    this.currentPlayingItem = item;
    storage.addRecent(item);

    const cfg = storage.getSettings();
    const activeStreamMode = this.dom.streamModeSelect?.value || cfg.streamMode || 'auto';
    const activeEngine = this.dom.playerEngineSelect?.value || cfg.playerEngine || (window.chrome?.webview ? 'vlc' : 'hls');
    this.player.playStream(item, cfg.corsProxy, activeStreamMode, activeEngine);

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
    if (!this.currentPlayingItem) return;

    if (this.currentPlayingItem.type !== ItemType.LIVE) {
      this.dom.currentProgramTitle.textContent = this.currentPlayingItem.name;
      if (this.dom.currentProgramTime) {
        this.dom.currentProgramTime.textContent = this.currentPlayingItem.type.toUpperCase();
        this.dom.currentProgramTime.classList.remove('hidden');
      }
      if (this.dom.currentProgramRemaining) {
        this.dom.currentProgramRemaining.textContent = '';
      }
      return;
    }

    const prog = this.epg.getCurrentProgram(this.currentPlayingItem.tvgId, this.currentPlayingItem.name);
    if (prog) {
      this.dom.currentProgramTitle.textContent = prog.title;
      if (this.dom.currentProgramTime) {
        this.dom.currentProgramTime.textContent = `${prog.formattedStart} - ${prog.formattedStop}`;
        this.dom.currentProgramTime.classList.remove('hidden');
      }
      if (this.dom.currentProgramRemaining) {
        this.dom.currentProgramRemaining.textContent = `${prog.remainingMinutes} min ${i18n.get('epgTimeRemaining')}`;
      }
      if (this.dom.currentProgramProgress) {
        this.dom.currentProgramProgress.style.width = `${prog.progress}%`;
      }
      if (this.dom.progressThumb) {
        this.dom.progressThumb.style.left = `${prog.progress}%`;
      }
    } else {
      this.dom.currentProgramTitle.textContent = i18n.get('noEpgAvailable');
      if (this.dom.currentProgramTime) {
        this.dom.currentProgramTime.textContent = '';
        this.dom.currentProgramTime.classList.add('hidden');
      }
      if (this.dom.currentProgramRemaining) {
        this.dom.currentProgramRemaining.textContent = '';
      }
      if (this.dom.currentProgramProgress) {
        this.dom.currentProgramProgress.style.width = '0%';
      }
      if (this.dom.progressThumb) {
        this.dom.progressThumb.style.left = '0%';
      }
    }
  }

  escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Inicialização da aplicação ao carregar o DOM
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    new FluiStreamApp();
  });
}
