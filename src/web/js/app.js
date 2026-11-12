/**
 * FluiStream — Main Application Controller (v2.0 Midnight Amber & Steel)
 * Coordena interface (8 telas), navegação espacial D-Pad, importação, EPG multi-fonte,
 * player, multi-screen, controle parental, notificações, perfis e séries.
 * Padrão Cesar Ovies Engineering Standards (PT/EN/ES, DWM Dark Mode, User-space)
 */

import { i18n } from './localization.js';
import { M3UParser, ItemType } from './m3u-parser.js';
import { EPGParser } from './epg-parser.js';
import { XtreamApi } from './xtream-api.js';
import { storage } from './storage.js';
import { VideoPlayerController, MultiScreenController } from './player.js';
import { fetchRemoteText } from './network.js';
import { UpdateChecker, APP_VERSION } from './version.js';

const PARENTAL_CATEGORY_RE = /(?:adult|xxx|18\+|\+18|porn|erotic|sexy|hentai|nsfw)/i;

class FluiStreamApp {
  constructor() {
    this.activeScreen = 'empty'; // 'empty' | 'home' | 'browse' | 'settings' | 'epg' | 'notifications' | 'multiscreen'
    this.previousScreen = 'home';
    this.currentView = ItemType.LIVE; // 'live' | 'movie' | 'series' | 'favorites' | 'history'
    this.playlist = {
      items: [],
      epgUrl: null,
      summary: { total: 0, live: 0, movies: 0, series: 0 },
      name: ''
    };
    this.epg = new EPGParser();
    this.multiScreen = new MultiScreenController();
    this.multiScreenLayout = '2x2';
    this.multiScreenSlots = [null, null, null, null];
    this.activeMultiSlot = 0;
    this.pendingSlotIndex = 0;

    this.selectedGroup = null;
    this.sidebarDrillMode = 'categories';
    this.sidebarSearchQuery = '';
    this.searchQuery = '';
    this.sortOrder = 'default';
    this.currentPlayingItem = null;
    this.browseEpgMode = 'all';
    this.browseEpgAllLimit = 60;
    this._lastExtendedEpgSig = '';
    this.epgTimelineLimit = 60;
    this._indexedPlaylistRef = null;
    this._indexedPlaylistLen = -1;
    this._seriesCache = new Map();
    this._epgItemByChannelKey = new Map();
    this.PAGE_SIZE = 60;
    this.renderedCount = 0;
    this.currentFilteredItems = [];
    this.currentFilteredSeries = [];
    this.activeSeries = null;
    this.selectedSeason = 1;
    this.isScrubbing = false;
    this.currentDuration = 0;
    this.lastProgressSaveAt = 0;
    this.parentalUnlocked = false;
    this.lastFocusedElement = null;

    this.init();
  }

  isNativeApp() {
    return typeof window !== 'undefined' && Boolean(window.chrome?.webview || window.androidBridge);
  }

  async init() {
    this.bindDomElements();
    if (this.isNativeApp() && this.dom.importWebCorsNotice) {
      this.dom.importWebCorsNotice.classList.add('hidden');
    }
    this.initPlayer();
    this.initI18n();
    this.bindEvents();
    this.startClock();
    await this.loadSavedState();
    this.applyDeviceMode();
    this.updateNotificationBadge();

    if (this.playlist.items.length > 0) {
      this.navigateToScreen('home');
      const cfg = storage.getSettings();
      if (cfg.autoRefresh) {
        const prof = storage.getActiveProfile();
        if (prof && (prof.type === 'xtream' || prof.type === 'm3u_url')) {
          this.reloadRemoteProfileData(prof, true).catch(() => {});
        }
      }
    } else {
      this.navigateToScreen('empty');
    }

    this.checkAppUpdates();
    if (!this.isNativeApp()) {
      this.detectLocalProxy();
    }
  }

  bindDomElements() {
    this.dom = {
      appHeader: document.getElementById('app-header'),
      mainLayout: document.getElementById('main-layout'),
      siteFooter: document.getElementById('site-footer'),
      headerClockTime: document.getElementById('header-clock-time'),
      headerClockDate: document.getElementById('header-clock-date'),
      btnMasterSearch: document.getElementById('btn-master-search'),
      btnBrandHome: document.getElementById('btn-brand-home'),
      navTabs: document.querySelectorAll('.nav-tab-btn'),

      // Quick Header Icons
      btnQuickLiveEpg: document.getElementById('btn-quick-live-epg'),
      btnQuickEpgGuide: document.getElementById('btn-quick-epg-guide'),
      btnQuickMultiscreen: document.getElementById('btn-quick-multiscreen'),
      btnQuickNotifications: document.getElementById('btn-quick-notifications'),
      notifBadge: document.getElementById('notif-badge'),
      btnOpenProfiles: document.getElementById('btn-open-profiles'),
      headerProfileName: document.getElementById('header-profile-name'),
      btnOpenAccount: document.getElementById('btn-open-account'),
      btnOpenSettings: document.getElementById('btn-open-settings'),
      btnOpenAbout: document.getElementById('btn-open-about'),

      // Top-level Views
      emptyState: document.getElementById('empty-state-view'),
      homeHubView: document.getElementById('home-hub-view'),
      contentView: document.getElementById('main-content-view'),
      settingsHubView: document.getElementById('settings-hub-view'),
      epgSettingsView: document.getElementById('epg-settings-view'),
      notificationsView: document.getElementById('notifications-view'),
      multiscreenView: document.getElementById('multiscreen-view'),

      // Empty State
      btnLoadDemo: document.getElementById('btn-load-demo'),
      btnEmptyImport: document.getElementById('btn-empty-import'),
      btnEmptyAbout: document.getElementById('btn-empty-about'),

      // Home Hub
      bentoCards: document.querySelectorAll('.bento-card'),
      homeCountLive: document.getElementById('home-count-live'),
      homeCountMovies: document.getElementById('home-count-movies'),
      homeCountSeries: document.getElementById('home-count-series'),
      homeUpdatedLive: document.getElementById('home-updated-live'),
      homeUpdatedMovies: document.getElementById('home-updated-movies'),
      homeUpdatedSeries: document.getElementById('home-updated-series'),
      btnRefreshLive: document.getElementById('btn-refresh-live'),
      btnRefreshMovies: document.getElementById('btn-refresh-movies'),
      btnRefreshSeries: document.getElementById('btn-refresh-series'),
      btnHomeLiveEpg: document.getElementById('btn-home-live-epg'),
      btnHomeFavourite: document.getElementById('btn-home-favourite'),
      homeEpgSub: document.getElementById('home-epg-sub'),
      homeCountFav: document.getElementById('home-count-fav'),
      homeFeaturedList: document.getElementById('home-featured-list'),
      btnHomeHistory: document.getElementById('btn-home-history'),
      btnHomeClearHistory: document.getElementById('btn-home-clear-history'),
      homeExpProfile: document.getElementById('home-exp-profile'),
      homeExpStatus: document.getElementById('home-exp-status'),
      homeExpDate: document.getElementById('home-exp-date'),
      homeExpCons: document.getElementById('home-exp-cons'),
      btnHomeAccountInfo: document.getElementById('btn-home-account-info'),

      // Split-Pane Browser
      splitSidebar: document.getElementById('split-sidebar'),
      splitSidebarTitle: document.getElementById('split-sidebar-title'),
      btnSidebarHome: document.getElementById('btn-sidebar-home'),
      btnSidebarClose: document.getElementById('btn-sidebar-close'),
      btnToggleSidebarMobile: document.getElementById('btn-toggle-sidebar-mobile'),
      sidebarCategorySearch: document.getElementById('sidebar-category-search'),
      sidebarItemsToolbar: document.getElementById('sidebar-items-toolbar'),
      btnSidebarClearHistory: document.getElementById('btn-sidebar-clear-history'),
      sidebarCategoryList: document.getElementById('sidebar-category-list'),
      selectSortItems: document.getElementById('select-sort-items'),
      itemCountBadge: document.getElementById('items-count-badge'),
      loadMoreWrap: document.getElementById('load-more-wrap'),
      btnLoadMore: document.getElementById('btn-load-more'),

      // Player
      playerSection: document.getElementById('player-section'),
      playerIdleOverlay: document.getElementById('player-idle-overlay'),
      playerCenterHit: document.getElementById('player-center-hit'),
      btnPlayerCenterToggle: document.getElementById('btn-player-center-toggle'),
      iconCenterPause: document.getElementById('icon-center-pause'),
      iconCenterPlay: document.getElementById('icon-center-play'),
      playerTimelineRow: document.getElementById('player-timeline-row'),
      playerEpgCard: document.getElementById('player-epg-card'),
      btnEpgModeChannel: document.getElementById('btn-epg-mode-channel'),
      btnEpgModeAll: document.getElementById('btn-epg-mode-all'),
      inputBrowseEpgSearch: document.getElementById('input-browse-epg-search'),
      playerEpgExtendedCount: document.getElementById('player-epg-extended-count'),
      playerEpgExtendedList: document.getElementById('player-epg-extended-list'),
      browseEpgLoadMoreWrap: document.getElementById('browse-epg-load-more-wrap'),
      btnBrowseEpgLoadMore: document.getElementById('btn-browse-epg-load-more'),
      video: document.getElementById('main-video'),
      playerContainer: document.getElementById('player-wrapper'),
      playerLoadingOverlay: document.getElementById('player-loading-spinner'),
      playerLoadingText: document.getElementById('player-loading-text'),
      playerErrorOverlay: document.getElementById('player-error-overlay'),
      playerErrorMsg: document.getElementById('player-error-msg'),
      playerErrorHint: document.getElementById('player-error-hint'),
      btnPlayerRetry: document.getElementById('btn-player-retry'),
      btnPlayerOpenSettings: document.getElementById('btn-player-open-settings'),
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
      aspectSelect: document.getElementById('select-aspect-ratio'),
      streamModeSelect: document.getElementById('select-stream-mode'),
      playerEngineSelect: document.getElementById('select-player-engine'),

      // Settings Hub & Sub-modals
      btnSettingsBack: document.getElementById('btn-settings-back'),
      settingsTileGrid: document.getElementById('settings-tile-grid'),
      tileTimeFormatSub: document.getElementById('tile-time-format-sub'),
      tileStreamFormatSub: document.getElementById('tile-stream-format-sub'),
      tileParentalSub: document.getElementById('tile-parental-sub'),
      tileDeviceModeSub: document.getElementById('tile-device-mode-sub'),
      tileSpeedtestSub: document.getElementById('tile-speedtest-sub'),
      modalSettings: document.getElementById('modal-settings'),
      modalSettingsTitle: document.getElementById('modal-settings-title'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      langSelect: document.getElementById('settings-lang-select'),
      settingsAdvancedDetails: document.getElementById('settings-advanced-details'),
      corsInput: document.getElementById('settings-cors-input'),
      btnUseLocalProxy: document.getElementById('btn-use-local-proxy'),
      localProxyDetectStatus: document.getElementById('local-proxy-detect-status'),
      settingsPlayerEngineSelect: document.getElementById('settings-player-engine-select'),
      settingsHistoryLimitSelect: document.getElementById('settings-history-limit-select'),
      btnSaveSettings: document.getElementById('btn-save-settings'),
      btnClearHistory: document.getElementById('btn-clear-history'),
      settingsHistoryStatus: document.getElementById('settings-history-status'),
      btnClearAllData: document.getElementById('btn-clear-all-data'),
      btnCheckUpdatesManual: document.getElementById('btn-check-updates-manual'),
      settingsUpdateStatus: document.getElementById('settings-update-status'),

      modalSettingsSub: document.getElementById('modal-settings-sub'),
      modalSettingsSubTitle: document.getElementById('modal-settings-sub-title'),
      modalSettingsSubBody: document.getElementById('modal-settings-sub-body'),
      modalSettingsSubFooter: document.getElementById('modal-settings-sub-footer'),
      btnCloseSettingsSub: document.getElementById('btn-close-settings-sub'),
      btnCancelSettingsSub: document.getElementById('btn-cancel-settings-sub'),
      btnSaveSettingsSub: document.getElementById('btn-save-settings-sub'),

      // Parental PIN Prompt
      modalParentalPin: document.getElementById('modal-parental-pin'),
      btnCloseParentalPin: document.getElementById('btn-close-parental-pin'),
      btnCancelParentalPin: document.getElementById('btn-cancel-parental-pin'),
      btnConfirmParentalPin: document.getElementById('btn-confirm-parental-pin'),
      inputParentalPinVerify: document.getElementById('input-parental-pin-verify'),
      parentalPinError: document.getElementById('parental-pin-error'),

      // EPG Subscreen
      btnEpgBack: document.getElementById('btn-epg-back'),
      btnEpgRefreshAll: document.getElementById('btn-epg-refresh-all'),
      epgRailBtns: document.querySelectorAll('.epg-rail-btn'),
      epgPanelSources: document.getElementById('epg-panel-sources'),
      epgPanelTimeline: document.getElementById('epg-panel-timeline'),
      epgPanelTimeshift: document.getElementById('epg-panel-timeshift'),
      inputEpgSourceUrl: document.getElementById('input-epg-source-url'),
      btnEpgAddSource: document.getElementById('btn-epg-add-source'),
      epgSourcesList: document.getElementById('epg-sources-list'),
      inputEpgTimelineSearch: document.getElementById('input-epg-timeline-search'),
      epgTimelineStats: document.getElementById('epg-timeline-stats'),
      epgTimelineContainer: document.getElementById('epg-timeline-container'),
      epgTimelineLoadMoreWrap: document.getElementById('epg-timeline-load-more-wrap'),
      btnEpgTimelineLoadMore: document.getElementById('btn-epg-timeline-load-more'),
      inputEpgTimeshift: document.getElementById('input-epg-timeshift'),
      epgTimeshiftValue: document.getElementById('epg-timeshift-value'),
      btnTimeshiftMinus: document.getElementById('btn-timeshift-minus'),
      btnTimeshiftPlus: document.getElementById('btn-timeshift-plus'),

      // Notifications
      btnNotifBack: document.getElementById('btn-notif-back'),
      btnNotifClear: document.getElementById('btn-notif-clear'),
      notificationsList: document.getElementById('notifications-list'),

      // Multi-Screen
      modalMultiscreen: document.getElementById('modal-multiscreen'),
      btnCloseMultiscreen: document.getElementById('btn-close-multiscreen'),
      multiscreenLayoutOptions: document.getElementById('multiscreen-layout-options'),
      btnMultiscreenBack: document.getElementById('btn-multiscreen-back'),
      btnMultiscreenChooseLayout: document.getElementById('btn-multiscreen-choose-layout'),
      multiscreenNativeNote: document.getElementById('multiscreen-native-note'),
      multiscreenGrid: document.getElementById('multiscreen-grid'),
      modalSlotPicker: document.getElementById('modal-slot-picker'),
      btnCloseSlotPicker: document.getElementById('btn-close-slot-picker'),
      inputSlotPickerSearch: document.getElementById('input-slot-picker-search'),
      slotPickerResults: document.getElementById('slot-picker-results'),

      // Master Search
      modalMasterSearch: document.getElementById('modal-master-search'),
      btnCloseMasterSearch: document.getElementById('btn-close-master-search'),
      inputMasterSearch: document.getElementById('input-master-search'),
      masterSearchResults: document.getElementById('master-search-results'),

      // Import & About
      modalImport: document.getElementById('modal-import'),
      btnCloseImport: document.getElementById('btn-close-import'),
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
      importWebCorsNotice: document.getElementById('import-web-cors-notice'),
      modalAbout: document.getElementById('modal-about'),
      btnCloseAbout: document.getElementById('btn-close-about'),

      // Profiles & Edit Profile
      modalProfiles: document.getElementById('modal-profiles'),
      btnCloseProfiles: document.getElementById('btn-close-profiles'),
      btnProfilesAdd: document.getElementById('btn-profiles-add'),
      profilesGrid: document.getElementById('profiles-grid-list'),
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
      editProfileAdvancedDetails: document.getElementById('edit-profile-advanced-details'),
      inputEditCorsProxy: document.getElementById('input-edit-cors-proxy'),
      editProfileStatus: document.getElementById('edit-profile-status'),

      // Account Info
      modalAccount: document.getElementById('modal-account'),
      btnCloseAccount: document.getElementById('btn-close-account'),
      btnAccBack: document.getElementById('btn-acc-back'),
      btnAccEdit: document.getElementById('btn-acc-edit'),
      btnAccLogout: document.getElementById('btn-acc-logout'),
      accRefreshStatus: document.getElementById('acc-refresh-status'),
      accUsername: document.getElementById('acc-info-username'),
      accStatus: document.getElementById('acc-info-status'),
      accExpDate: document.getElementById('acc-info-exp-date'),
      accTrial: document.getElementById('acc-info-trial'),
      accActiveCons: document.getElementById('acc-info-active-cons'),
      accCreatedAt: document.getElementById('acc-info-created-at'),
      accMaxCons: document.getElementById('acc-info-max-cons'),

      // Series
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
      seriesEpisodesContainer: document.getElementById('series-episodes-container')
    };
  }

  initPlayer() {
    this.player = new VideoPlayerController(this.dom.video, this.dom.playerContainer);
    this.player.onChannelChange = (delta) => this.navigateChannel(delta);
    this.player.onStateChange = (state, details) => this.handlePlayerState(state, details);

    this.player.onTimeUpdate = ({ currentTime, duration, position, isSeekable }) => {
      if (this.isScrubbing) return;
      this.currentDuration = duration;
      this.updateTimelineDisplay(currentTime, duration, position, isSeekable);

      // Salva progresso de VOD/Séries a cada 5s
      if (
        this.currentPlayingItem &&
        this.currentPlayingItem.type !== ItemType.LIVE &&
        duration > 10 &&
        Date.now() - this.lastProgressSaveAt > 5000
      ) {
        this.lastProgressSaveAt = Date.now();
        storage.saveWatchProgress(this.currentPlayingItem.id, currentTime, duration);
      }
    };

    if (this.dom.video) {
      this.dom.video.addEventListener('ended', () => this.handleMediaEnded());
    }

    if (this.dom.progressBarWrap) {
      const wrap = this.dom.progressBarWrap;
      const calcPct = (clientX) => {
        const rect = wrap.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        return Math.max(0, Math.min(rect.width, clientX - rect.left)) / rect.width;
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
        const targetSec = this.currentDuration > 0 ? pct * this.currentDuration : null;
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
    if (this.dom.btnPlayerOpenSettings) {
      this.dom.btnPlayerOpenSettings.addEventListener('click', () => {
        this.openSettingsModal(true);
      });
    }

    window.fluiStreamApp = this;
    this.player.onTracksUpdated = (tracksInfo) => this.updateTrackSelectors(tracksInfo);
    if (this.dom.video) {
      this.dom.video.addEventListener('volumechange', () => this.syncVolumeUi());
    }
    this.syncVolumeUi();
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

  syncVolumeUi() {
    const vid = this.player?.video;
    const rawVol = vid && typeof vid.volume === 'number' ? vid.volume : parseFloat(this.dom.inputVolume?.value || '0.8');
    const vol = Math.max(0, Math.min(1, Number.isFinite(rawVol) ? rawVol : 0.8));
    const muted = Boolean(vid?.muted);
    const isSilent = muted || vol === 0;
    const pct = `${isSilent ? 0 : Math.round(vol * 100)}%`;

    if (this.dom.inputVolume) {
      this.dom.inputVolume.value = String(vol);
      this.dom.inputVolume.style.setProperty('--vol-pct', pct);
    }
    if (this.dom.btnMute) {
      this.dom.btnMute.classList.toggle('is-muted', isSilent);
    }
    if (this.dom.iconVolumeHigh && this.dom.iconVolumeMuted) {
      this.dom.iconVolumeHigh.classList.toggle('hidden', isSilent);
      this.dom.iconVolumeMuted.classList.toggle('hidden', !isSilent);
    }
  }

  handleHardwareVolume(normVolume, isMuted) {
    const vol = Math.max(0, Math.min(1, Number(normVolume) || 0));
    const muted = Boolean(isMuted);
    if (this.player?.video) {
      this.player.video.volume = vol;
      this.player.video.muted = muted;
    }
    this.syncVolumeUi();
  }

  handleNativeBack() {
    if (this.dom.seasonsPopup && !this.dom.seasonsPopup.classList.contains('hidden')) {
      this.dom.seasonsPopup.classList.add('hidden');
      return 'handled';
    }
    const openModals = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'));
    if (openModals.length > 0) {
      this.closeModal(openModals[openModals.length - 1]);
      return 'handled';
    }
    if (['settings', 'epg', 'notifications', 'multiscreen'].includes(this.activeScreen)) {
      const target = this.previousScreen && this.previousScreen !== this.activeScreen ? this.previousScreen : 'home';
      this.navigateToScreen(this.playlist.items.length > 0 ? target : 'empty');
      return 'handled';
    }
    if (this.activeScreen === 'browse') {
      if (this.dom.splitSidebar?.classList.contains('open-mobile')) {
        this.dom.splitSidebar.classList.remove('open-mobile');
        return 'handled';
      }
      if (this.sidebarDrillMode === 'items') {
        this.closeEnteredCategory();
        return 'handled';
      }
      this.navigateToScreen('home');
      return 'handled';
    }
    return 'root';
  }

  handleMediaEnded() {
    const cfg = storage.getSettings();
    if (!cfg.autoPlayNext || !this.currentPlayingItem) return;
    if (this.currentPlayingItem.type === ItemType.SERIES && this.activeSeries) {
      const eps = this.activeSeries.seasons[this.selectedSeason] || this.activeSeries.episodes || [];
      const idx = eps.findIndex(e => e.id === this.currentPlayingItem.id);
      if (idx >= 0 && idx + 1 < eps.length) {
        this.playChannel(eps[idx + 1]);
      }
    }
  }

  startClock() {
    this.updateClock();
    setInterval(() => this.updateClock(), 15000);
  }

  updateClock() {
    const now = new Date();
    const cfg = storage.getSettings();
    const lang = i18n.currentLanguage || 'pt-BR';
    const hour12 = cfg.timeFormat === '12h';
    if (this.dom.headerClockTime) {
      try {
        this.dom.headerClockTime.textContent = new Intl.DateTimeFormat(lang, {
          hour: '2-digit',
          minute: '2-digit',
          hour12
        }).format(now);
      } catch {
        this.dom.headerClockTime.textContent = now.toTimeString().slice(0, 5);
      }
    }
    if (this.dom.headerClockDate) {
      try {
        this.dom.headerClockDate.textContent = new Intl.DateTimeFormat(lang, {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }).format(now);
      } catch {
        this.dom.headerClockDate.textContent = now.toLocaleDateString();
      }
    }
  }

  resolveEffectiveDeviceMode(mode = storage.getSettings().deviceMode || 'auto') {
    if (mode === 'tv' || mode === 'mobile' || mode === 'desktop') return mode;
    if (typeof window === 'undefined') return 'desktop';
    const ua = navigator?.userAgent || '';
    const isTvUa = /(android tv|smarttv|googletv|aft[a-z0-9]|bravia|mibox|tizen|webos)/i.test(ua);
    const hasCoarse = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const hasNoPointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: none)').matches;
    if (isTvUa || hasNoPointer) return 'tv';
    if (hasCoarse || (('ontouchstart' in window) && window.innerWidth <= 900)) return 'mobile';
    return 'desktop';
  }

  applyDeviceMode() {
    const cfg = storage.getSettings();
    const mode = cfg.deviceMode || 'auto';
    const effective = this.resolveEffectiveDeviceMode(mode);
    if (mode === 'auto') {
      document.body.removeAttribute('data-device-mode');
    } else {
      document.body.setAttribute('data-device-mode', mode);
    }
    document.body.setAttribute('data-effective-device-mode', effective);
    this.updateSettingsTileSubtitles();
  }

  updateSettingsTileSubtitles() {
    const cfg = storage.getSettings();
    if (this.dom.tileTimeFormatSub) {
      this.dom.tileTimeFormatSub.textContent = cfg.timeFormat === '12h' ? i18n.get('timeFormat12h') : i18n.get('timeFormat24h');
    }
    if (this.dom.tileParentalSub) {
      this.dom.tileParentalSub.textContent = cfg.parentalPinHash ? 'PIN Active' : 'Off';
    }
    if (this.dom.tileStreamFormatSub) {
      const modeMap = {
        auto: i18n.get('playerStreamAuto'),
        hls: i18n.get('playerStreamHls'),
        ts: i18n.get('playerStreamTs'),
        direct: i18n.get('playerStreamDirect')
      };
      this.dom.tileStreamFormatSub.textContent = modeMap[cfg.streamMode || 'auto'] || modeMap.auto;
    }
    if (this.dom.tileDeviceModeSub) {
      const mode = cfg.deviceMode || 'auto';
      const effective = this.resolveEffectiveDeviceMode(mode);
      const map = {
        auto: i18n.get('deviceModeAuto'),
        tv: i18n.get('deviceModeTv'),
        desktop: i18n.get('deviceModeDesktop'),
        mobile: i18n.get('deviceModeMobile')
      };
      this.dom.tileDeviceModeSub.textContent = mode === 'auto'
        ? `${map.auto} (${map[effective] || effective})`
        : (map[mode] || map.auto);
    }
  }

  navigateToScreen(screenName) {
    if (this.activeScreen === 'multiscreen' && screenName !== 'multiscreen') {
      this.multiScreen.clearAll();
    }
    if (['home', 'browse', 'empty'].includes(this.activeScreen) && screenName !== this.activeScreen) {
      this.previousScreen = this.activeScreen;
    }

    this.activeScreen = screenName;

    const views = {
      empty: this.dom.emptyState,
      home: this.dom.homeHubView,
      browse: this.dom.contentView,
      settings: this.dom.settingsHubView,
      epg: this.dom.epgSettingsView,
      notifications: this.dom.notificationsView,
      multiscreen: this.dom.multiscreenView
    };
    Object.entries(views).forEach(([key, el]) => {
      if (el) el.classList.toggle('hidden', key !== screenName);
    });

    this.dom.navTabs.forEach(tab => {
      const view = tab.getAttribute('data-view');
      const isActive = (screenName === 'home' && view === 'home') || (screenName === 'browse' && view === this.currentView);
      tab.classList.toggle('active', isActive);
    });

    if (screenName === 'home') this.renderHomeHub();
    if (screenName === 'browse') this.renderBrowseView();
    if (screenName === 'settings') this.updateSettingsTileSubtitles();
    if (screenName === 'epg') this.renderEpgSubscreen();
    if (screenName === 'notifications') this.renderNotifications();

    if (this.player) {
      this.player.setOverlayVisible(screenName === 'browse' && Boolean(this.currentPlayingItem));
      this.player.reportLayout();
    }
  }

  initI18n() {
    i18n.subscribe(() => {
      i18n.applyToDOM();
      this.updateClock();
      this.updateSettingsTileSubtitles();
      if (this.activeScreen === 'home') this.renderHomeHub();
      if (this.activeScreen === 'browse') this.renderBrowseView();
      if (this.activeScreen === 'epg') this.renderEpgSubscreen();
      if (this.activeScreen === 'notifications') this.renderNotifications();
      if (this.activeSeries && !this.dom.modalSeries?.classList.contains('hidden')) {
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
    // Nav Tabs
    this.dom.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.getAttribute('data-view');
        if (view === 'home') {
          this.navigateToScreen(this.playlist.items.length > 0 ? 'home' : 'empty');
          return;
        }
        this.openBrowseView(view);
      });
    });

    // Brand Home
    if (this.dom.btnBrandHome) {
      const goHome = () => this.navigateToScreen(this.playlist.items.length > 0 ? 'home' : 'empty');
      this.dom.btnBrandHome.addEventListener('click', goHome);
      this.dom.btnBrandHome.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goHome();
        }
      });
    }

    // Header Quick Actions
    if (this.dom.btnMasterSearch) {
      this.dom.btnMasterSearch.addEventListener('click', () => this.openMasterSearchModal());
    }
    if (this.dom.btnQuickLiveEpg) {
      this.dom.btnQuickLiveEpg.addEventListener('click', () => this.openBrowseView(ItemType.LIVE));
    }
    if (this.dom.btnQuickEpgGuide) {
      this.dom.btnQuickEpgGuide.addEventListener('click', () => {
        this.navigateToScreen('epg');
        this.switchEpgTab('timeline');
      });
    }
    if (this.dom.btnQuickMultiscreen) {
      this.dom.btnQuickMultiscreen.addEventListener('click', () => this.openModal(this.dom.modalMultiscreen));
    }
    if (this.dom.btnQuickNotifications) {
      this.dom.btnQuickNotifications.addEventListener('click', () => this.navigateToScreen('notifications'));
    }

    // Home Hub Events
    this.dom.bentoCards.forEach(card => {
      const open = () => {
        const view = card.getAttribute('data-bento');
        if (view) this.openBrowseView(view);
      };
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-bento-refresh')) return;
        open();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });

    [this.dom.btnRefreshLive, this.dom.btnRefreshMovies, this.dom.btnRefreshSeries].forEach(btn => {
      if (!btn) return;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const prof = storage.getActiveProfile();
        if (!prof || (prof.type !== 'xtream' && prof.type !== 'm3u_url')) return;
        btn.classList.add('spinning');
        try {
          await this.reloadRemoteProfileData(prof, true);
        } finally {
          btn.classList.remove('spinning');
        }
      });
    });

    if (this.dom.btnHomeLiveEpg) {
      this.dom.btnHomeLiveEpg.addEventListener('click', () => {
        this.navigateToScreen('epg');
        this.switchEpgTab('timeline');
      });
    }
    if (this.dom.btnHomeFavourite) {
      this.dom.btnHomeFavourite.addEventListener('click', () => this.openBrowseView('favorites'));
    }
    if (this.dom.btnHomeHistory) {
      this.dom.btnHomeHistory.addEventListener('click', () => this.openBrowseView('history'));
    }
    if (this.dom.btnHomeClearHistory) {
      this.dom.btnHomeClearHistory.addEventListener('click', () => this.clearWatchHistory());
    }
    if (this.dom.btnSidebarClearHistory) {
      this.dom.btnSidebarClearHistory.addEventListener('click', () => this.clearWatchHistory());
    }
    if (this.dom.btnHomeAccountInfo) {
      this.dom.btnHomeAccountInfo.addEventListener('click', () => this.openAccountModal());
    }

    // Split-Pane Sidebar & Browser
    if (this.dom.btnSidebarHome) {
      this.dom.btnSidebarHome.addEventListener('click', () => {
        this.dom.splitSidebar?.classList.remove('open-mobile');
        if (this.sidebarDrillMode === 'items') {
          this.closeEnteredCategory();
        } else {
          this.navigateToScreen('home');
        }
      });
    }
    if (this.dom.btnToggleSidebarMobile) {
      this.dom.btnToggleSidebarMobile.addEventListener('click', () => {
        this.dom.splitSidebar?.classList.toggle('open-mobile');
      });
    }
    if (this.dom.btnSidebarClose) {
      this.dom.btnSidebarClose.addEventListener('click', () => {
        if (this.dom.splitSidebar?.classList.contains('open-mobile')) {
          this.dom.splitSidebar.classList.remove('open-mobile');
          return;
        }
        if (this.sidebarDrillMode === 'items') {
          this.closeEnteredCategory();
        } else {
          this.navigateToScreen('home');
        }
      });
    }

    let sidebarSearchTimer;
    if (this.dom.sidebarCategorySearch) {
      this.dom.sidebarCategorySearch.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        this.sidebarSearchQuery = val;
        if (this.sidebarDrillMode === 'items') {
          clearTimeout(sidebarSearchTimer);
          sidebarSearchTimer = setTimeout(() => {
            this.renderSidebarItems();
          }, 150);
        } else {
          this.renderSidebarCategories();
        }
      });
    }
    if (this.dom.selectSortItems) {
      this.dom.selectSortItems.addEventListener('change', (e) => {
        this.sortOrder = e.target.value;
        if (this.sidebarDrillMode === 'items') this.renderSidebarItems();
      });
    }

    // Browse EPG Panel (Maximized below player for Live TV)
    if (this.dom.btnEpgModeChannel) {
      this.dom.btnEpgModeChannel.addEventListener('click', () => {
        if (!this.currentPlayingItem || this.currentPlayingItem.type !== ItemType.LIVE) return;
        this.browseEpgMode = 'channel';
        this._lastExtendedEpgSig = '';
        this.updateCurrentEpgDisplay();
      });
    }
    if (this.dom.btnEpgModeAll) {
      this.dom.btnEpgModeAll.addEventListener('click', () => {
        this.browseEpgMode = 'all';
        this._lastExtendedEpgSig = '';
        this.updateCurrentEpgDisplay();
      });
    }
    let browseEpgSearchTimer;
    if (this.dom.inputBrowseEpgSearch) {
      this.dom.inputBrowseEpgSearch.addEventListener('input', () => {
        clearTimeout(browseEpgSearchTimer);
        browseEpgSearchTimer = setTimeout(() => {
          this.browseEpgAllLimit = 60;
          this.browseEpgMode = 'all';
          this._lastExtendedEpgSig = '';
          this.updateCurrentEpgDisplay();
        }, 180);
      });
    }
    if (this.dom.btnBrowseEpgLoadMore) {
      this.dom.btnBrowseEpgLoadMore.addEventListener('click', () => {
        this.browseEpgAllLimit += this.PAGE_SIZE;
        this._lastExtendedEpgSig = '';
        this.updateCurrentEpgDisplay();
      });
    }
    if (this.dom.playerEpgExtendedList) {
      this.dom.playerEpgExtendedList.addEventListener('click', (e) => {
        const playCard = e.target.closest('[data-browse-epg-play-id]');
        if (!playCard) return;
        const id = playCard.getAttribute('data-browse-epg-play-id');
        const item = this.playlist.items.find(x => String(x.id) === String(id));
        if (item) this.playChannel(item, { preserveEpgMode: true });
      });
      this.dom.playerEpgExtendedList.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const playCard = e.target.closest('[data-browse-epg-play-id]');
        if (playCard) {
          e.preventDefault();
          playCard.click();
        }
      });
    }

    // Player Controls
    if (this.dom.btnPlayerPlayPause) this.dom.btnPlayerPlayPause.addEventListener('click', () => this.player.togglePlay());
    if (this.dom.playerCenterHit) {
      let centerClickTimer = null;
      this.dom.playerCenterHit.addEventListener('click', () => {
        if (!this.currentPlayingItem) return;
        clearTimeout(centerClickTimer);
        centerClickTimer = setTimeout(() => {
          this.player.togglePlay();
        }, 180);
      });
      this.dom.playerCenterHit.addEventListener('dblclick', () => {
        if (!this.currentPlayingItem) return;
        clearTimeout(centerClickTimer);
        this.player.toggleFullscreen();
      });
    }
    if (this.dom.btnPlayerStop) this.dom.btnPlayerStop.addEventListener('click', () => this.stopPlayback());
    if (this.dom.btnPlayerClose) this.dom.btnPlayerClose.addEventListener('click', () => this.closePlayerAndReset());
    if (this.dom.btnPlayerFullscreen) this.dom.btnPlayerFullscreen.addEventListener('click', () => this.player.toggleFullscreen());
    if (this.dom.btnPlayerPip) this.dom.btnPlayerPip.addEventListener('click', () => this.player.togglePip());
    if (this.dom.selectPlayerAudio) {
      this.dom.selectPlayerAudio.addEventListener('change', (e) => this.player.setAudioTrack(parseInt(e.target.value, 10)));
    }
    if (this.dom.selectPlayerSubtitles) {
      this.dom.selectPlayerSubtitles.addEventListener('change', (e) => this.player.setSubtitleTrack(parseInt(e.target.value, 10)));
    }
    if (this.dom.inputVolume) {
      this.dom.inputVolume.addEventListener('input', (e) => {
        this.player.setVolume(parseFloat(e.target.value));
        this.syncVolumeUi();
      });
    }
    if (this.dom.btnMute) {
      this.dom.btnMute.addEventListener('click', () => {
        this.player.toggleMute();
        this.syncVolumeUi();
      });
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

    if (this.dom.btnLoadMore) {
      this.dom.btnLoadMore.addEventListener('click', () => {
        if (this.sidebarDrillMode === 'items') {
          this.appendSidebarItemsBatch(this.PAGE_SIZE);
        }
      });
    }

    // Sidebar Delegation (Categories & Drilled Items)
    if (this.dom.sidebarCategoryList) {
      this.dom.sidebarCategoryList.addEventListener('click', async (e) => {
        const catBtn = e.target.closest('.sidebar-cat-btn');
        if (catBtn) {
          await this.selectSidebarGroup(catBtn.getAttribute('data-group'));
          return;
        }
        const favBtn = e.target.closest('.sidebar-item-fav');
        if (favBtn) {
          e.stopPropagation();
          const id = favBtn.getAttribute('data-fav-id');
          const isNowFav = storage.toggleFavorite(id);
          favBtn.classList.toggle('is-fav', isNowFav);
          if (this.currentView === 'favorites' || this.selectedGroup === '__favorites__') {
            this.renderSidebarItems();
          }
          return;
        }
        const row = e.target.closest('.sidebar-item-row');
        if (row) {
          const id = row.getAttribute('data-id');
          if (this._isSeriesGroupingActive()) {
            const series = (this.currentFilteredSeries || []).find(s => s.id === id);
            if (series) {
              this.openSeriesDetailModal(series);
              return;
            }
          }
          const item = (this.currentFilteredItems || []).find(x => x.id === id);
          if (item) {
            this.dom.splitSidebar?.classList.remove('open-mobile');
            this.playChannel(item);
          }
        }
      });
      this.dom.sidebarCategoryList.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.sidebar-item-row');
        if (row && !e.target.closest('.sidebar-item-fav')) {
          e.preventDefault();
          row.click();
        }
      });
    }

    // Settings Hub & Tiles
    if (this.dom.btnOpenSettings) {
      this.dom.btnOpenSettings.addEventListener('click', () => this.navigateToScreen('settings'));
    }
    if (this.dom.btnSettingsBack) {
      this.dom.btnSettingsBack.addEventListener('click', () => {
        this.navigateToScreen(this.playlist.items.length > 0 ? (this.previousScreen || 'home') : 'empty');
      });
    }
    if (this.dom.settingsTileGrid) {
      this.dom.settingsTileGrid.addEventListener('click', (e) => {
        const tile = e.target.closest('.settings-tile');
        if (!tile) return;
        this.handleSettingsTileClick(tile.getAttribute('data-settings-tile'));
      });
    }

    if (this.dom.btnCloseSettings) this.dom.btnCloseSettings.addEventListener('click', () => this.closeModal(this.dom.modalSettings));
    if (this.dom.settingsAdvancedDetails) {
      this.dom.settingsAdvancedDetails.addEventListener('toggle', () => {
        if (this.dom.settingsAdvancedDetails.open && !this.isNativeApp()) this.detectLocalProxy();
      });
    }
    if (this.dom.btnUseLocalProxy) {
      this.dom.btnUseLocalProxy.addEventListener('click', () => {
        if (this.dom.corsInput) this.dom.corsInput.value = 'http://127.0.0.1:8787/?';
      });
    }
    if (this.dom.btnSaveSettings) {
      this.dom.btnSaveSettings.addEventListener('click', () => {
        const cfg = storage.getSettings();
        if (this.dom.corsInput) cfg.corsProxy = this.dom.corsInput.value.trim();
        if (this.dom.settingsPlayerEngineSelect) {
          const isDesktop = Boolean(window.chrome?.webview);
          if (isDesktop || this.dom.settingsPlayerEngineSelect.value !== 'vlc') {
            cfg.playerEngine = this.dom.settingsPlayerEngineSelect.value;
          }
        }
        if (this.dom.settingsHistoryLimitSelect) {
          cfg.historyLimit = parseInt(this.dom.settingsHistoryLimitSelect.value, 10) || 30;
        }
        storage.saveSettings(cfg);
        this.closeModal(this.dom.modalSettings);
        if (this.activeScreen === 'home') this.renderHomeHub();
        if (this.activeScreen === 'browse') this.renderSidebarPanel();
        if (this.currentPlayingItem) this.playChannel(this.currentPlayingItem);
      });
    }
    if (this.dom.btnClearHistory) {
      this.dom.btnClearHistory.addEventListener('click', () => {
        if (this.clearWatchHistory() && this.dom.settingsHistoryStatus) {
          this.dom.settingsHistoryStatus.textContent = i18n.get('historyCleared');
        }
      });
    }
    if (this.dom.btnClearAllData) {
      this.dom.btnClearAllData.addEventListener('click', async () => {
        if (confirm(i18n.get('settingsClearConfirm'))) {
          await storage.clearAll();
          location.reload();
        }
      });
    }
    if (this.dom.btnCheckUpdatesManual) {
      this.dom.btnCheckUpdatesManual.addEventListener('click', () => this.checkAppUpdates(true));
    }

    // Sub-modal close
    if (this.dom.btnCloseSettingsSub) this.dom.btnCloseSettingsSub.addEventListener('click', () => this.closeModal(this.dom.modalSettingsSub));
    if (this.dom.btnCancelSettingsSub) this.dom.btnCancelSettingsSub.addEventListener('click', () => this.closeModal(this.dom.modalSettingsSub));

    // Parental PIN modal close
    if (this.dom.btnCloseParentalPin) this.dom.btnCloseParentalPin.addEventListener('click', () => this.closeModal(this.dom.modalParentalPin));
    if (this.dom.btnCancelParentalPin) this.dom.btnCancelParentalPin.addEventListener('click', () => this.closeModal(this.dom.modalParentalPin));

    // EPG Subscreen
    if (this.dom.btnEpgBack) {
      this.dom.btnEpgBack.addEventListener('click', () => {
        this.navigateToScreen(this.playlist.items.length > 0 ? (this.previousScreen || 'home') : 'empty');
      });
    }
    this.dom.epgRailBtns.forEach(btn => {
      btn.addEventListener('click', () => this.switchEpgTab(btn.getAttribute('data-epg-tab')));
    });
    if (this.dom.btnEpgAddSource) {
      this.dom.btnEpgAddSource.addEventListener('click', () => this.handleAddEpgSource());
    }
    if (this.dom.btnEpgRefreshAll) {
      this.dom.btnEpgRefreshAll.addEventListener('click', () => this.refreshAllEpgSources());
    }
    let epgSearchTimeout;
    if (this.dom.inputEpgTimelineSearch) {
      this.dom.inputEpgTimelineSearch.addEventListener('input', () => {
        clearTimeout(epgSearchTimeout);
        epgSearchTimeout = setTimeout(() => {
          this.epgTimelineLimit = 60;
          this.renderEpgTimeline();
        }, 180);
      });
    }
    if (this.dom.btnEpgTimelineLoadMore) {
      this.dom.btnEpgTimelineLoadMore.addEventListener('click', () => {
        this.epgTimelineLimit += 60;
        this.renderEpgTimeline();
      });
    }
    if (this.dom.inputEpgTimeshift) {
      this.dom.inputEpgTimeshift.addEventListener('input', (e) => this.applyEpgTimeshift(parseInt(e.target.value, 10) || 0));
    }
    if (this.dom.btnTimeshiftMinus) {
      this.dom.btnTimeshiftMinus.addEventListener('click', () => {
        const cur = parseInt(this.dom.inputEpgTimeshift?.value || '0', 10) || 0;
        this.applyEpgTimeshift(Math.max(-12, cur - 1));
      });
    }
    if (this.dom.btnTimeshiftPlus) {
      this.dom.btnTimeshiftPlus.addEventListener('click', () => {
        const cur = parseInt(this.dom.inputEpgTimeshift?.value || '0', 10) || 0;
        this.applyEpgTimeshift(Math.min(12, cur + 1));
      });
    }

    // Notifications
    if (this.dom.btnNotifBack) {
      this.dom.btnNotifBack.addEventListener('click', () => {
        this.navigateToScreen(this.playlist.items.length > 0 ? (this.previousScreen || 'home') : 'empty');
      });
    }
    if (this.dom.btnNotifClear) {
      this.dom.btnNotifClear.addEventListener('click', () => {
        storage.clearNotifications();
        this.updateNotificationBadge();
        this.renderNotifications();
      });
    }

    // Multi-Screen
    if (this.dom.btnCloseMultiscreen) this.dom.btnCloseMultiscreen.addEventListener('click', () => this.closeModal(this.dom.modalMultiscreen));
    if (this.dom.multiscreenLayoutOptions) {
      this.dom.multiscreenLayoutOptions.addEventListener('click', (e) => {
        const card = e.target.closest('.layout-template-card');
        if (!card) return;
        this.multiScreenLayout = card.getAttribute('data-layout') || '2x2';
        this.closeModal(this.dom.modalMultiscreen);
        this.openMultiScreenView();
      });
    }
    if (this.dom.btnMultiscreenBack) {
      this.dom.btnMultiscreenBack.addEventListener('click', () => this.navigateToScreen('home'));
    }
    if (this.dom.btnMultiscreenChooseLayout) {
      this.dom.btnMultiscreenChooseLayout.addEventListener('click', () => this.openModal(this.dom.modalMultiscreen));
    }
    if (this.dom.btnCloseSlotPicker) this.dom.btnCloseSlotPicker.addEventListener('click', () => this.closeModal(this.dom.modalSlotPicker));
    if (this.dom.inputSlotPickerSearch) {
      this.dom.inputSlotPickerSearch.addEventListener('input', () => this.renderSlotPickerResults());
    }

    // Master Search
    if (this.dom.btnCloseMasterSearch) this.dom.btnCloseMasterSearch.addEventListener('click', () => this.closeModal(this.dom.modalMasterSearch));
    let masterSearchTimer;
    if (this.dom.inputMasterSearch) {
      this.dom.inputMasterSearch.addEventListener('input', () => {
        clearTimeout(masterSearchTimer);
        masterSearchTimer = setTimeout(() => this.renderMasterSearchResults(), 200);
      });
    }

    // Import / Profiles / Account / Edit / Series / About Modals
    if (this.dom.btnEmptyImport) this.dom.btnEmptyImport.addEventListener('click', () => this.openModal(this.dom.modalImport));
    if (this.dom.btnCloseImport) this.dom.btnCloseImport.addEventListener('click', () => this.closeModal(this.dom.modalImport));
    if (this.dom.btnOpenAbout) this.dom.btnOpenAbout.addEventListener('click', () => this.openModal(this.dom.modalAbout));
    if (this.dom.btnEmptyAbout) this.dom.btnEmptyAbout.addEventListener('click', () => this.openModal(this.dom.modalAbout));
    if (this.dom.btnCloseAbout) this.dom.btnCloseAbout.addEventListener('click', () => this.closeModal(this.dom.modalAbout));
    if (this.dom.btnLoadDemo) this.dom.btnLoadDemo.addEventListener('click', () => this.loadDemoPlaylist());
    if (this.dom.btnSubmitImport) this.dom.btnSubmitImport.addEventListener('click', () => this.handleImportSubmit());

    if (this.dom.importTabs && this.dom.importPanels) {
      this.dom.importTabs.forEach(btn => {
        btn.addEventListener('click', () => {
          this.dom.importTabs.forEach(b => b.classList.remove('active'));
          this.dom.importPanels.forEach(p => p.classList.add('hidden'));
          btn.classList.add('active');
          document.getElementById(btn.getAttribute('data-panel'))?.classList.remove('hidden');
        });
      });
    }

    if (this.dom.btnOpenProfiles) this.dom.btnOpenProfiles.addEventListener('click', () => this.openProfilesModal());
    if (this.dom.btnCloseProfiles) this.dom.btnCloseProfiles.addEventListener('click', () => this.closeModal(this.dom.modalProfiles));
    if (this.dom.btnProfilesAdd) {
      this.dom.btnProfilesAdd.addEventListener('click', () => {
        this.closeModal(this.dom.modalProfiles);
        this.openModal(this.dom.modalImport);
      });
    }

    if (this.dom.btnOpenAccount) this.dom.btnOpenAccount.addEventListener('click', () => this.openAccountModal());
    if (this.dom.btnCloseAccount) this.dom.btnCloseAccount.addEventListener('click', () => this.closeModal(this.dom.modalAccount));
    if (this.dom.btnAccBack) this.dom.btnAccBack.addEventListener('click', () => this.closeModal(this.dom.modalAccount));
    if (this.dom.btnAccLogout) this.dom.btnAccLogout.addEventListener('click', () => this.handleProfileLogout());
    if (this.dom.btnAccEdit) {
      this.dom.btnAccEdit.addEventListener('click', () => {
        this.closeModal(this.dom.modalAccount);
        this.openEditProfileModal(storage.getActiveProfileId());
      });
    }

    if (this.dom.btnCloseEditProfile) this.dom.btnCloseEditProfile.addEventListener('click', () => this.closeModal(this.dom.modalEditProfile));
    if (this.dom.btnCancelEditProfile) this.dom.btnCancelEditProfile.addEventListener('click', () => this.closeModal(this.dom.modalEditProfile));
    if (this.dom.btnSaveEditProfile) this.dom.btnSaveEditProfile.addEventListener('click', () => this.handleSaveProfileEdit(false));
    if (this.dom.btnReloadEditProfile) this.dom.btnReloadEditProfile.addEventListener('click', () => this.handleSaveProfileEdit(true));

    if (this.dom.btnCloseSeries) this.dom.btnCloseSeries.addEventListener('click', () => this.closeModal(this.dom.modalSeries));
    if (this.dom.btnSeriesWatchNow) {
      this.dom.btnSeriesWatchNow.addEventListener('click', () => {
        if (!this.activeSeries) return;
        const eps = this.activeSeries.seasons[this.selectedSeason || 1] || this.activeSeries.episodes;
        if (eps && eps.length > 0) {
          this.closeModal(this.dom.modalSeries);
          this.playChannel(eps[0]);
        }
      });
    }
    if (this.dom.btnSeriesSeasonSelect) {
      this.dom.btnSeriesSeasonSelect.addEventListener('click', () => {
        if (this.activeSeries) this.openSeasonsPopup();
      });
    }
    if (this.dom.btnCloseSeasonsPopup) {
      this.dom.btnCloseSeasonsPopup.addEventListener('click', () => this.dom.seasonsPopup?.classList.add('hidden'));
    }

    // Escape closes top modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.dom.seasonsPopup && !this.dom.seasonsPopup.classList.contains('hidden')) {
          this.dom.seasonsPopup.classList.add('hidden');
          return;
        }
        const openBackdrops = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'));
        if (openBackdrops.length > 0) {
          this.closeModal(openBackdrops[openBackdrops.length - 1]);
        }
      }
    });

    // Global Keyboard & Spatial D-Pad Navigation
    window.addEventListener('keydown', (e) => this.handleGlobalKeyDown(e));
    let deviceResizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(deviceResizeTimer);
      deviceResizeTimer = setTimeout(() => {
        if ((storage.getSettings().deviceMode || 'auto') === 'auto') {
          this.applyDeviceMode();
        }
      }, 150);
    });
  }

  handleGlobalKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    const isModalOpen = Boolean(document.querySelector('.modal-backdrop:not(.hidden)'));
    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);

    if (isArrow) {
      // Se foco está dentro da área de vídeo/slider, controla canal/seek; nos controles/botões usa navegação espacial
      const inPlayerRange = Boolean(e.target.closest('[role="slider"], #player-center-hit, #btn-player-center-toggle'));
      if (inPlayerRange && !isModalOpen) {
        if (e.key === 'ArrowUp') { e.preventDefault(); this.navigateChannel(-1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this.navigateChannel(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); this.seekRelative(-10); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); this.seekRelative(10); }
        return;
      }

      if (this.moveSpatialFocus(e.key, isModalOpen)) {
        e.preventDefault();
        return;
      }
    }

    if ((e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') && !isModalOpen) {
      e.preventDefault();
      this.handleNativeBack();
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      if (isModalOpen || e.target.closest('button, a, summary, [tabindex="0"]')) return;
      e.preventDefault();
      this.player.togglePlay();
    } else if ((e.key === 'm' || e.key === 'M') && !isModalOpen) {
      this.player.toggleMute();
    } else if ((e.key === 'f' || e.key === 'F') && !isModalOpen) {
      this.player.toggleFullscreen();
    }
  }

  moveSpatialFocus(direction, isModalOpen) {
    const scopeRoot = isModalOpen
      ? Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)')).pop()
      : document.body;
    if (!scopeRoot) return false;

    const selector = [
      '.nav-tab-btn',
      '.header-actions button',
      '#btn-brand-home',
      '#btn-master-search',
      '.bento-card',
      '.gradient-tile',
      '.featured-item-row',
      '.settings-tile',
      '.sidebar-cat-btn',
      '.sidebar-item-row',
      '.split-sidebar-header button',
      '.category-nav-bar button',
      '.player-controls-bar button',
      '.player-controls-bar select',
      '#btn-player-center-toggle',
      '.layout-template-card',
      '.profile-card',
      '.episode-item-row',
      '.epg-rail-btn',
      '.epg-source-item button',
      '.multiscreen-slot',
      '.btn-notif-update',
      '.modal-header button',
      '.modal-footer button'
    ].join(', ');

    const headerEl = !isModalOpen ? document.getElementById('app-header') : null;
    const mainEl = !isModalOpen ? document.getElementById('main-layout') : scopeRoot;
    const rawElements = [];
    if (headerEl) rawElements.push(...headerEl.querySelectorAll(selector));
    if (mainEl) rawElements.push(...mainEl.querySelectorAll(selector));

    const candidates = rawElements.filter(el => {
      if (el.disabled || el.closest('.hidden')) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (candidates.length === 0) return false;

    const current = document.activeElement;
    if (!current || !scopeRoot.contains(current) || !current.matches(selector)) {
      candidates[0].focus();
      return true;
    }

    const curRect = current.getBoundingClientRect();
    const curX = curRect.left + curRect.width / 2;
    const curY = curRect.top + curRect.height / 2;

    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - curX;
      const dy = y - curY;

      let valid = false;
      let primary = 0;
      let secondary = 0;
      if (direction === 'ArrowRight' && dx > 12) { valid = true; primary = dx; secondary = Math.abs(dy); }
      if (direction === 'ArrowLeft' && dx < -12) { valid = true; primary = -dx; secondary = Math.abs(dy); }
      if (direction === 'ArrowDown' && dy > 12) { valid = true; primary = dy; secondary = Math.abs(dx); }
      if (direction === 'ArrowUp' && dy < -12) { valid = true; primary = -dy; secondary = Math.abs(dx); }
      if (!valid) continue;

      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) {
      best.focus({ preventScroll: false });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
    return false;
  }

  // =====================================================
  // HOME HUB RENDERING (SCREEN 1)
  // =====================================================
  renderHomeHub() {
    const summary = this.playlist.summary || { total: 0, live: 0, movies: 0, series: 0 };
    const favCount = storage.getFavorites().length;
    const prof = storage.getActiveProfile();
    const updatedDate = prof?.updatedAt ? new Date(prof.updatedAt).toLocaleDateString(i18n.currentLanguage || 'pt-BR') : '--';

    if (this.dom.homeCountLive) this.dom.homeCountLive.textContent = String(summary.live || 0);
    if (this.dom.homeCountMovies) this.dom.homeCountMovies.textContent = String(summary.movies || 0);
    if (this.dom.homeCountSeries) this.dom.homeCountSeries.textContent = String(summary.series || 0);
    if (this.dom.homeUpdatedLive) this.dom.homeUpdatedLive.textContent = updatedDate;
    if (this.dom.homeUpdatedMovies) this.dom.homeUpdatedMovies.textContent = updatedDate;
    if (this.dom.homeUpdatedSeries) this.dom.homeUpdatedSeries.textContent = updatedDate;
    if (this.dom.homeCountFav) this.dom.homeCountFav.textContent = String(favCount);

    const epgProgs = Array.from(this.epg.programmes.values()).reduce((a, b) => a + b.length, 0);
    if (this.dom.homeEpgSub) this.dom.homeEpgSub.textContent = epgProgs > 0 ? `${this.epg.channels.size} ch • ${epgProgs} prog` : 'XMLTV';

    // Expiration Footer
    if (this.dom.homeExpProfile) this.dom.homeExpProfile.textContent = prof?.name || 'FluiStream';
    const acc = prof?.accountInfo || {};
    const status = acc.status || 'Active';
    if (this.dom.homeExpStatus) {
      this.dom.homeExpStatus.textContent = status;
      this.dom.homeExpStatus.className = `status-pill ${status === 'Active' ? 'status-pill--active' : 'status-pill--expired'}`;
    }
    if (this.dom.homeExpDate) this.dom.homeExpDate.textContent = acc.expDate || i18n.get('accNoExpiration');
    if (this.dom.homeExpCons) {
      this.dom.homeExpCons.textContent = acc.maxConnections ? `${acc.activeCons || '0'} / ${acc.maxConnections} conn` : '';
    }

    // Featured / Recents + Continue Watching
    if (this.dom.homeFeaturedList) {
      const recents = storage.getRecents();
      if (this.dom.btnHomeClearHistory) {
        this.dom.btnHomeClearHistory.classList.toggle('hidden', recents.length === 0);
      }
      const list = recents.slice(0, storage.getHistoryLimit());
      if (list.length === 0) {
        this.dom.homeFeaturedList.innerHTML = `<p style="color: var(--text-secondary); font-size: 0.84rem; text-align: center; padding: 2rem 0;">${i18n.get('emptyHistory')}</p>`;
      } else {
        this.dom.homeFeaturedList.innerHTML = list.map(item => {
          const prog = item.type !== ItemType.LIVE ? storage.getWatchProgress(item.id) : null;
          const pct = prog?.percent || 0;
          const logo = item.logo || 'assets/logo.svg';
          return `
            <div class="featured-item-row" data-featured-url="${this.escapeHtml(item.url)}" data-featured-id="${this.escapeHtml(item.id)}" tabindex="0" role="button">
              <img class="featured-item-thumb" src="${logo}" alt="" loading="lazy" onerror="this.src='assets/logo.svg'" />
              <div class="featured-item-meta">
                <div class="featured-item-title">${this.escapeHtml(item.name)}</div>
                <div class="featured-item-sub">${this.escapeHtml(item.group || item.type || '')}</div>
                ${pct > 0 ? `<div class="featured-progress-bar"><div class="featured-progress-fill" style="width:${pct}%"></div></div>` : ''}
              </div>
            </div>
          `;
        }).join('');

        this.dom.homeFeaturedList.querySelectorAll('.featured-item-row').forEach(row => {
          const play = () => {
            const id = row.getAttribute('data-featured-id');
            const url = row.getAttribute('data-featured-url');
            const found = this.playlist.items.find(x => x.id === id || x.url === url) || recents.find(x => x.id === id || x.url === url);
            if (found) {
              this.openBrowseView(found.type || ItemType.LIVE, found.group || 'all', true);
              this.playChannel(found);
            }
          };
          row.addEventListener('click', play);
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
          });
        });
      }
    }
  }

  // =====================================================
  // SPLIT-PANE BROWSER (SCREEN 2)
  // =====================================================
  _ensurePlaylistIndexes() {
    const len = this.playlist?.items?.length || 0;
    if (this._indexedPlaylistRef === this.playlist && this._indexedPlaylistLen === len) return;
    this._indexedPlaylistRef = this.playlist;
    this._indexedPlaylistLen = len;
    this._seriesCache = new Map();
    this._epgItemByChannelKey = new Map();
    const items = this.playlist.items || [];
    M3UParser.ensureUniqueItemIds(items);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type !== ItemType.LIVE) continue;
      if (it.tvgId) {
        const k = it.tvgId.toLowerCase();
        if (!this._epgItemByChannelKey.has(k)) this._epgItemByChannelKey.set(k, it);
      }
      if (it.name) {
        const n = it.name.toLowerCase();
        if (!this._epgItemByChannelKey.has(n)) this._epgItemByChannelKey.set(n, it);
      }
    }
  }

  _isSeriesGroupingActive() {
    return this.currentView === ItemType.SERIES &&
      this.selectedGroup !== '__favorites__' &&
      this.selectedGroup !== '__history__';
  }

  _getGroupDisplayLabel(groupName) {
    if (!groupName || groupName === 'all') return i18n.get('sidebarAll');
    if (groupName === '__favorites__') return i18n.get('sidebarFavourites');
    if (groupName === '__history__') return i18n.get('sidebarHistory');
    return groupName;
  }

  openBrowseView(viewType = ItemType.LIVE, initialGroup = null, enterItems = false) {
    this.currentView = viewType;
    this.sidebarSearchQuery = '';
    if (this.dom.sidebarCategorySearch) this.dom.sidebarCategorySearch.value = '';
    this.browseEpgAllLimit = 60;
    this._lastExtendedEpgSig = '';

    if (enterItems && initialGroup) {
      this.selectedGroup = initialGroup;
      this.sidebarDrillMode = 'items';
    } else {
      this.selectedGroup = null;
      this.sidebarDrillMode = 'categories';
      if (this.currentPlayingItem && this.currentPlayingItem.type !== viewType) {
        this.stopPlayback();
      }
      this.browseEpgMode = (this.currentPlayingItem && this.currentPlayingItem.type === ItemType.LIVE)
        ? this.browseEpgMode
        : 'all';
    }

    this.navigateToScreen('browse');
  }

  syncBrowseViewLayout() {
    const playing = Boolean(this.currentPlayingItem);
    const inItemsMode = this.sidebarDrillMode === 'items';

    this.dom.playerSection?.classList.remove('hidden');
    this.dom.playerIdleOverlay?.classList.toggle('hidden', playing);
    this.dom.sidebarItemsToolbar?.classList.toggle('hidden', !inItemsMode);
    if (this.dom.btnSidebarClearHistory) {
      const showSidebarClear = inItemsMode
        && (this.selectedGroup === '__history__' || this.currentView === 'history')
        && storage.getRecents().length > 0;
      this.dom.btnSidebarClearHistory.classList.toggle('hidden', !showSidebarClear);
    }
    if (!inItemsMode) this.dom.loadMoreWrap?.classList.add('hidden');

    if (this.dom.splitSidebarTitle) {
      this.dom.splitSidebarTitle.textContent = inItemsMode
        ? this._getGroupDisplayLabel(this.selectedGroup)
        : i18n.get('appName');
    }
    if (this.dom.sidebarCategorySearch) {
      this.dom.sidebarCategorySearch.placeholder = i18n.get(
        inItemsMode ? 'searchCategoryItemsPlaceholder' : 'sidebarSearchCategories'
      );
    }

    this.updateCurrentEpgDisplay();

    if (this.player) {
      this.player.setOverlayVisible(this.activeScreen === 'browse' && playing);
      this.player.reportLayout();
    }
  }

  closeEnteredCategory() {
    this.sidebarDrillMode = 'categories';
    this.selectedGroup = null;
    this.sidebarSearchQuery = '';
    if (this.dom.sidebarCategorySearch) this.dom.sidebarCategorySearch.value = '';
    this.syncBrowseViewLayout();
    this.renderSidebarPanel();
  }

  renderBrowseView() {
    if (this.playlist.items.length === 0) {
      this.navigateToScreen('empty');
      return;
    }
    this.syncBrowseViewLayout();
    this.renderSidebarPanel();
  }

  renderSidebarPanel() {
    if (this.sidebarDrillMode === 'items') {
      this.renderSidebarItems();
    } else {
      this.renderSidebarCategories();
    }
  }

  getBaseItemsForCurrentView() {
    if (this.selectedGroup === '__favorites__' || this.currentView === 'favorites') {
      const favIds = storage.getFavorites();
      return this.playlist.items.filter(x => favIds.includes(x.id));
    }
    if (this.selectedGroup === '__history__' || this.currentView === 'history') {
      const recents = storage.getRecents();
      return recents.map(r => this.playlist.items.find(p => p.url === r.url || p.id === r.id) || r);
    }
    return this.playlist.items.filter(x => x.type === this.currentView);
  }

  renderSidebarCategories() {
    if (!this.dom.sidebarCategoryList) return;
    const baseItems = this.playlist.items.filter(x => {
      if (this.currentView === 'favorites') return storage.getFavorites().includes(x.id);
      if (this.currentView === 'history') return true;
      return x.type === this.currentView;
    });

    const groupsMap = new Map();
    baseItems.forEach(it => {
      const g = it.group || 'Geral';
      groupsMap.set(g, (groupsMap.get(g) || 0) + 1);
    });

    let sortedGroups = Array.from(groupsMap.entries()).sort((a, b) => b[1] - a[1]);
    if (this.sidebarSearchQuery) {
      sortedGroups = sortedGroups.filter(([name]) => name.toLowerCase().includes(this.sidebarSearchQuery));
    }

    const favCount = storage.getFavorites().length;
    const historyCount = storage.getRecents().length;
    const cfg = storage.getSettings();
    const hasPin = Boolean(cfg.parentalPinHash) && !this.parentalUnlocked;

    let html = `
      <button class="sidebar-cat-btn ${this.selectedGroup === 'all' ? 'active' : ''}" data-group="all">
        <span class="sidebar-cat-name">${this.escapeHtml(i18n.get('sidebarAll'))}</span>
        <span class="sidebar-cat-count">${baseItems.length}</span>
      </button>
      <button class="sidebar-cat-btn ${this.selectedGroup === '__favorites__' ? 'active' : ''}" data-group="__favorites__">
        <span class="sidebar-cat-name">★ ${this.escapeHtml(i18n.get('sidebarFavourites'))}</span>
        <span class="sidebar-cat-count">${favCount}</span>
      </button>
      <button class="sidebar-cat-btn ${this.selectedGroup === '__history__' ? 'active' : ''}" data-group="__history__">
        <span class="sidebar-cat-name">🕒 ${this.escapeHtml(i18n.get('sidebarHistory'))}</span>
        <span class="sidebar-cat-count">${historyCount}</span>
      </button>
      <div class="sidebar-divider"></div>
    `;

    sortedGroups.forEach(([groupName, count]) => {
      const active = this.selectedGroup === groupName ? 'active' : '';
      const locked = hasPin && PARENTAL_CATEGORY_RE.test(groupName) ? '🔒 ' : '';
      html += `
        <button class="sidebar-cat-btn ${active}" data-group="${this.escapeHtml(groupName)}">
          <span class="sidebar-cat-name">${locked}${this.escapeHtml(groupName)}</span>
          <span class="sidebar-cat-count">${count}</span>
        </button>
      `;
    });

    this.dom.sidebarCategoryList.innerHTML = html;
    this.dom.sidebarCategoryList.scrollTop = 0;
  }

  async selectSidebarGroup(groupName) {
    const cfg = storage.getSettings();
    if (cfg.parentalPinHash && !this.parentalUnlocked && PARENTAL_CATEGORY_RE.test(groupName || '')) {
      const ok = await this.promptParentalPin();
      if (!ok) return;
    }
    this.selectedGroup = groupName || 'all';
    this.sidebarDrillMode = 'items';
    this.sidebarSearchQuery = '';
    if (this.dom.sidebarCategorySearch) this.dom.sidebarCategorySearch.value = '';
    this.syncBrowseViewLayout();
    this.renderSidebarItems();
  }

  getFilteredItems() {
    let items = this.getBaseItemsForCurrentView();

    if (
      this.selectedGroup &&
      this.selectedGroup !== 'all' &&
      this.selectedGroup !== '__favorites__' &&
      this.selectedGroup !== '__history__'
    ) {
      items = items.filter(x => (x.group || 'Geral') === this.selectedGroup);
    }

    const activeQuery = this.sidebarDrillMode === 'items' ? this.sidebarSearchQuery : '';
    if (activeQuery) {
      items = items.filter(x =>
        (x.name || '').toLowerCase().includes(activeQuery) ||
        (x.group && x.group.toLowerCase().includes(activeQuery))
      );
    }

    const cfg = storage.getSettings();
    if (cfg.parentalPinHash && !this.parentalUnlocked && this.selectedGroup === 'all') {
      items = items.filter(x => !PARENTAL_CATEGORY_RE.test(x.group || ''));
    }

    if (this.sortOrder === 'alpha') {
      items = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (this.sortOrder === 'recent') {
      const recents = storage.getRecents();
      const rank = new Map(recents.map((r, i) => [r.url, i]));
      items = [...items].sort((a, b) => (rank.has(a.url) ? rank.get(a.url) : 999999) - (rank.has(b.url) ? rank.get(b.url) : 999999));
    }

    return items;
  }

  groupSeriesItems(rawItems) {
    this._ensurePlaylistIndexes();
    const activeQuery = this.sidebarDrillMode === 'items' ? this.sidebarSearchQuery : '';
    const canUseCache = !activeQuery && this.sortOrder === 'default';
    const cacheKey = `${this.selectedGroup || 'all'}|${this.parentalUnlocked ? '1' : '0'}`;
    if (canUseCache && this._seriesCache.has(cacheKey)) {
      return this._seriesCache.get(cacheKey);
    }

    const seriesMap = new Map();
    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const sTitle = it.seriesTitle || it.name.replace(/\s*[-–]\s*(?:T|S)?\d+.*$/i, '').trim();
      const normKey = sTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
      let ser = seriesMap.get(normKey);
      if (!ser) {
        ser = {
          id: `series_${normKey}`,
          seriesTitle: sTitle,
          group: it.group || 'Séries',
          logo: it.logo,
          type: ItemType.SERIES,
          seasons: {},
          episodes: [],
          sampleItem: it
        };
        seriesMap.set(normKey, ser);
      }
      if (!ser.logo && it.logo) ser.logo = it.logo;
      const sNum = it.season || 1;
      if (!ser.seasons[sNum]) ser.seasons[sNum] = [];
      ser.seasons[sNum].push(it);
      ser.episodes.push(it);
    }
    const result = Array.from(seriesMap.values());
    for (let i = 0; i < result.length; i++) {
      const s = result[i];
      s.totalSeasons = Object.keys(s.seasons).length;
      s.totalEpisodes = s.episodes.length;
      for (const k of Object.keys(s.seasons)) {
        if (s.seasons[k].length > 1) {
          s.seasons[k].sort((a, b) => (a.episode || 0) - (b.episode || 0));
        }
      }
    }
    if (canUseCache) {
      this._seriesCache.set(cacheKey, result);
    }
    return result;
  }

  renderSidebarItems() {
    if (!this.dom.sidebarCategoryList) return;
    this.renderedCount = 0;

    if (this._isSeriesGroupingActive()) {
      const raw = this.getFilteredItems();
      this.currentFilteredSeries = this.groupSeriesItems(raw);
      this.currentFilteredItems = [];
      if (this.dom.itemCountBadge) {
        this.dom.itemCountBadge.textContent = i18n.get('channelCount', { count: this.currentFilteredSeries.length });
      }
      if (this.currentFilteredSeries.length === 0) {
        this.dom.sidebarCategoryList.innerHTML = `<div class="help-text" style="text-align: center; padding: 2rem 1rem;">${this.escapeHtml(i18n.get('noEpgAvailable'))}</div>`;
        this.dom.loadMoreWrap?.classList.add('hidden');
        return;
      }
      this.dom.sidebarCategoryList.innerHTML = '';
      this.dom.sidebarCategoryList.scrollTop = 0;
      this.appendSidebarItemsBatch(this.PAGE_SIZE);
      return;
    }

    this.currentFilteredSeries = [];
    this.currentFilteredItems = this.getFilteredItems();
    if (this.dom.itemCountBadge) {
      this.dom.itemCountBadge.textContent = i18n.get('channelCount', { count: this.currentFilteredItems.length });
    }

    if (this.currentFilteredItems.length === 0) {
      let emptyKey = 'noEpgAvailable';
      if (this.selectedGroup === '__history__' || this.currentView === 'history') emptyKey = 'emptyHistory';
      else if (this.selectedGroup === '__favorites__' || this.currentView === 'favorites') emptyKey = 'favoritesEmpty';

      this.dom.sidebarCategoryList.innerHTML = `<div class="help-text" style="text-align: center; padding: 2rem 1rem;">${this.escapeHtml(i18n.get(emptyKey))}</div>`;
      this.dom.loadMoreWrap?.classList.add('hidden');
      return;
    }

    this.dom.sidebarCategoryList.innerHTML = '';
    this.dom.sidebarCategoryList.scrollTop = 0;
    this.appendSidebarItemsBatch(this.PAGE_SIZE);
  }

  appendSidebarItemsBatch(count = 60) {
    if (!this.dom.sidebarCategoryList) return;
    const isSeries = this._isSeriesGroupingActive();
    const list = isSeries ? this.currentFilteredSeries : this.currentFilteredItems;
    const nextBatch = list.slice(this.renderedCount, this.renderedCount + count);
    if (nextBatch.length === 0) return;

    const html = nextBatch.map(entry => {
      if (isSeries) {
        const logoUrl = entry.logo || 'assets/logo.svg';
        const seasonText = entry.totalSeasons === 1
          ? i18n.get('seasonLabel', { num: 1 })
          : i18n.get('seasonsCount', { count: entry.totalSeasons });
        const epText = i18n.get('episodesCount', { count: entry.totalEpisodes });
        const isPlayingSeries = Boolean(this.currentPlayingItem && this.activeSeries?.id === entry.id);
        return `
          <div class="sidebar-item-row ${isPlayingSeries ? 'playing' : ''}" data-id="${this.escapeHtml(entry.id)}" tabindex="0" role="button">
            <img class="sidebar-item-thumb" src="${logoUrl}" alt="" loading="lazy" onerror="this.src='assets/logo.svg'" />
            <div class="sidebar-item-meta">
              <div class="sidebar-item-name">${this.escapeHtml(entry.seriesTitle)}</div>
              <div class="sidebar-item-sub">${this.escapeHtml(seasonText)} • ${this.escapeHtml(epText)}</div>
            </div>
          </div>
        `;
      }

      const isFav = storage.isFavorite(entry.id);
      const isPlaying = Boolean(this.currentPlayingItem && String(this.currentPlayingItem.id) === String(entry.id));
      const logoUrl = entry.logo || 'assets/logo.svg';
      let subText = entry.group || '';
      if (entry.type === ItemType.LIVE) {
        const curProg = this.epg.getCurrentProgram(entry.tvgId, entry.name);
        if (curProg?.title) subText = curProg.title;
      } else {
        const wp = storage.getWatchProgress(entry.id);
        if (wp && wp.percent > 0) subText = `${wp.percent}% • ${subText}`;
      }

      return `
        <div class="sidebar-item-row ${isPlaying ? 'playing' : ''}" data-id="${this.escapeHtml(entry.id)}" tabindex="0" role="button">
          <img class="sidebar-item-thumb" src="${logoUrl}" alt="" loading="lazy" onerror="this.src='assets/logo.svg'" />
          <div class="sidebar-item-meta">
            <div class="sidebar-item-name">${this.escapeHtml(entry.name)}</div>
            <div class="sidebar-item-sub">${this.escapeHtml(subText)}</div>
          </div>
          <button type="button" class="sidebar-item-fav ${isFav ? 'is-fav' : ''}" data-fav-id="${this.escapeHtml(entry.id)}" title="${this.escapeHtml(i18n.get('navFavorites'))}">★</button>
        </div>
      `;
    }).join('');

    this.dom.sidebarCategoryList.insertAdjacentHTML('beforeend', html);
    this.renderedCount += nextBatch.length;
    this.toggleLoadMore(this.renderedCount, list.length);
  }

  toggleLoadMore(rendered, total) {
    if (!this.dom.loadMoreWrap) return;
    if (rendered < total) {
      this.dom.loadMoreWrap.classList.remove('hidden');
      if (this.dom.btnLoadMore) {
        this.dom.btnLoadMore.textContent = i18n.get('btnLoadMore', { shown: rendered, total });
      }
    } else {
      this.dom.loadMoreWrap.classList.add('hidden');
    }
  }

  // =====================================================
  // SETTINGS HUB & SUB-MODALS (SCREENS 3 & 5)
  // =====================================================
  openSettingsModal(openAdvanced = false) {
    const cfg = storage.getSettings();
    if (this.dom.corsInput) this.dom.corsInput.value = cfg.corsProxy || '';
    if (this.dom.settingsAdvancedDetails) this.dom.settingsAdvancedDetails.open = Boolean(openAdvanced);
    if (this.dom.settingsHistoryStatus) this.dom.settingsHistoryStatus.textContent = '';
    if (this.dom.settingsHistoryLimitSelect) {
      const limitStr = String(cfg.historyLimit || 30);
      if (![...this.dom.settingsHistoryLimitSelect.options].some(o => o.value === limitStr)) {
        const opt = document.createElement('option');
        opt.value = limitStr;
        opt.textContent = limitStr;
        this.dom.settingsHistoryLimitSelect.appendChild(opt);
      }
      this.dom.settingsHistoryLimitSelect.value = limitStr;
    }
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
    if (!this.isNativeApp()) this.detectLocalProxy();
  }

  clearWatchHistory() {
    storage.clearRecents(true);
    this.renderHomeHub();
    if (this.activeScreen === 'browse') {
      this.syncBrowseViewLayout();
      this.renderSidebarPanel();
    }
    return true;
  }

  handleSettingsTileClick(tileId) {
    switch (tileId) {
      case 'general':
        this.openSettingsModal(false);
        break;
      case 'stream':
        this.openStreamFormatSubModal();
        break;
      case 'network':
        this.openSettingsModal(true);
        break;
      case 'epg':
        this.navigateToScreen('epg');
        break;
      case 'multiscreen':
        this.openModal(this.dom.modalMultiscreen);
        break;
      case 'account':
        this.openAccountModal();
        break;
      case 'time':
        this.openTimeFormatSubModal();
        break;
      case 'automation':
        this.openAutomationSubModal();
        break;
      case 'parental':
        this.openParentalSubModal();
        break;
      case 'devicemode':
        this.openDeviceModeSubModal();
        break;
      case 'speedtest':
        this.openSpeedTestSubModal();
        break;
    }
  }

  openStreamFormatSubModal() {
    const cfg = storage.getSettings();
    const curMode = cfg.streamMode || 'auto';
    this.dom.modalSettingsSubTitle.textContent = i18n.get('settingsStreamFormat');
    this.dom.modalSettingsSubFooter.classList.remove('hidden');
    this.dom.modalSettingsSubBody.innerHTML = `
      <div class="form-group">
        <label for="sub-stream-mode-select">${this.escapeHtml(i18n.get('settingsStreamMode'))}</label>
        <select id="sub-stream-mode-select" class="form-control">
          <option value="auto" ${curMode === 'auto' ? 'selected' : ''}>${this.escapeHtml(i18n.get('playerStreamAuto'))}</option>
          <option value="hls" ${curMode === 'hls' ? 'selected' : ''}>${this.escapeHtml(i18n.get('playerStreamHls'))}</option>
          <option value="ts" ${curMode === 'ts' ? 'selected' : ''}>${this.escapeHtml(i18n.get('playerStreamTs'))}</option>
          <option value="direct" ${curMode === 'direct' ? 'selected' : ''}>${this.escapeHtml(i18n.get('playerStreamDirect'))}</option>
        </select>
        <p class="help-text">${this.escapeHtml(i18n.get('settingsStreamModeHelp'))}</p>
      </div>
    `;
    this.dom.btnSaveSettingsSub.onclick = () => {
      const val = document.getElementById('sub-stream-mode-select')?.value || 'auto';
      storage.saveSettings({ streamMode: val });
      if (this.dom.streamModeSelect) this.dom.streamModeSelect.value = val;
      this.updateSettingsTileSubtitles();
      this.closeModal(this.dom.modalSettingsSub);
      if (this.currentPlayingItem) this.playChannel(this.currentPlayingItem);
    };
    this.openModal(this.dom.modalSettingsSub);
  }

  openTimeFormatSubModal() {
    const cfg = storage.getSettings();
    this.dom.modalSettingsSubTitle.textContent = i18n.get('settingsTimeFormat');
    this.dom.modalSettingsSubFooter.classList.remove('hidden');
    this.dom.modalSettingsSubBody.innerHTML = `
      <div class="form-group">
        <label>${this.escapeHtml(i18n.get('settingsTimeFormat'))}</label>
        <select id="sub-time-format-select" class="form-control">
          <option value="24h" ${cfg.timeFormat !== '12h' ? 'selected' : ''}>${this.escapeHtml(i18n.get('timeFormat24h'))}</option>
          <option value="12h" ${cfg.timeFormat === '12h' ? 'selected' : ''}>${this.escapeHtml(i18n.get('timeFormat12h'))}</option>
        </select>
      </div>
    `;
    this.dom.btnSaveSettingsSub.onclick = () => {
      const val = document.getElementById('sub-time-format-select')?.value || '24h';
      storage.saveSettings({ timeFormat: val });
      this.updateClock();
      this.updateSettingsTileSubtitles();
      this.closeModal(this.dom.modalSettingsSub);
    };
    this.openModal(this.dom.modalSettingsSub);
  }

  openAutomationSubModal() {
    const cfg = storage.getSettings();
    this.dom.modalSettingsSubTitle.textContent = i18n.get('settingsAutomation');
    this.dom.modalSettingsSubFooter.classList.remove('hidden');
    this.dom.modalSettingsSubBody.innerHTML = `
      <label class="checkbox-label">
        <input type="checkbox" id="sub-auto-refresh" ${cfg.autoRefresh ? 'checked' : ''} />
        <span>${this.escapeHtml(i18n.get('autoRefreshLabel'))}</span>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="sub-auto-play-next" ${cfg.autoPlayNext !== false ? 'checked' : ''} />
        <span>${this.escapeHtml(i18n.get('autoPlayNextLabel'))}</span>
      </label>
    `;
    this.dom.btnSaveSettingsSub.onclick = () => {
      storage.saveSettings({
        autoRefresh: Boolean(document.getElementById('sub-auto-refresh')?.checked),
        autoPlayNext: Boolean(document.getElementById('sub-auto-play-next')?.checked)
      });
      this.closeModal(this.dom.modalSettingsSub);
    };
    this.openModal(this.dom.modalSettingsSub);
  }

  openDeviceModeSubModal() {
    const cfg = storage.getSettings();
    const cur = cfg.deviceMode || 'auto';
    this.dom.modalSettingsSubTitle.textContent = i18n.get('settingsSwitchDeviceMode');
    this.dom.modalSettingsSubFooter.classList.remove('hidden');
    this.dom.modalSettingsSubBody.innerHTML = `
      <div class="form-group">
        <label>${this.escapeHtml(i18n.get('settingsSwitchDeviceMode'))}</label>
        <select id="sub-device-mode-select" class="form-control">
          <option value="auto" ${cur === 'auto' ? 'selected' : ''}>${this.escapeHtml(i18n.get('deviceModeAuto'))}</option>
          <option value="tv" ${cur === 'tv' ? 'selected' : ''}>${this.escapeHtml(i18n.get('deviceModeTv'))}</option>
          <option value="desktop" ${cur === 'desktop' ? 'selected' : ''}>${this.escapeHtml(i18n.get('deviceModeDesktop'))}</option>
          <option value="mobile" ${cur === 'mobile' ? 'selected' : ''}>${this.escapeHtml(i18n.get('deviceModeMobile'))}</option>
        </select>
        <p class="help-text">${this.escapeHtml(i18n.get('deviceModeHelp'))}</p>
      </div>
    `;
    this.dom.btnSaveSettingsSub.onclick = () => {
      const val = document.getElementById('sub-device-mode-select')?.value || 'auto';
      storage.saveSettings({ deviceMode: val });
      this.applyDeviceMode();
      this.closeModal(this.dom.modalSettingsSub);
    };
    this.openModal(this.dom.modalSettingsSub);
  }

  async hashPin(pin) {
    const input = `fluistream_pin_salt_v2:${pin}`;
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'fnv_' + (h >>> 0).toString(16);
  }

  openParentalSubModal() {
    const cfg = storage.getSettings();
    const enabled = Boolean(cfg.parentalPinHash);
    this.dom.modalSettingsSubTitle.textContent = i18n.get('settingsParentalControl');
    this.dom.modalSettingsSubFooter.classList.remove('hidden');
    this.dom.modalSettingsSubBody.innerHTML = `
      <label class="checkbox-label">
        <input type="checkbox" id="sub-parental-enable" ${enabled ? 'checked' : ''} />
        <span>${this.escapeHtml(i18n.get('parentalEnable'))}</span>
      </label>
      <div class="form-group">
        <label>${this.escapeHtml(i18n.get('parentalSetPin'))}</label>
        <input type="password" inputmode="numeric" maxlength="8" id="sub-parental-pin" class="form-control" placeholder="••••" />
      </div>
    `;
    this.dom.btnSaveSettingsSub.onclick = async () => {
      const wantEnable = Boolean(document.getElementById('sub-parental-enable')?.checked);
      const pin = document.getElementById('sub-parental-pin')?.value.trim() || '';
      if (!wantEnable) {
        storage.saveSettings({ parentalPinHash: '' });
        this.parentalUnlocked = false;
      } else if (pin.length >= 4) {
        const hash = await this.hashPin(pin);
        storage.saveSettings({ parentalPinHash: hash });
        this.parentalUnlocked = false;
      }
      this.updateSettingsTileSubtitles();
      this.closeModal(this.dom.modalSettingsSub);
    };
    this.openModal(this.dom.modalSettingsSub);
  }

  promptParentalPin() {
    return new Promise((resolve) => {
      const cfg = storage.getSettings();
      if (!cfg.parentalPinHash) { resolve(true); return; }
      if (this.dom.inputParentalPinVerify) this.dom.inputParentalPinVerify.value = '';
      this.dom.parentalPinError?.classList.add('hidden');

      const cleanup = (ok) => {
        this.dom.btnConfirmParentalPin.onclick = null;
        this.dom.btnCancelParentalPin.onclick = null;
        this.dom.btnCloseParentalPin.onclick = null;
        this.closeModal(this.dom.modalParentalPin);
        resolve(ok);
      };

      this.dom.btnConfirmParentalPin.onclick = async () => {
        const entered = this.dom.inputParentalPinVerify?.value.trim() || '';
        const hashed = await this.hashPin(entered);
        if (hashed === cfg.parentalPinHash) {
          this.parentalUnlocked = true;
          cleanup(true);
        } else {
          this.dom.parentalPinError?.classList.remove('hidden');
        }
      };
      this.dom.btnCancelParentalPin.onclick = () => cleanup(false);
      this.dom.btnCloseParentalPin.onclick = () => cleanup(false);
      this.openModal(this.dom.modalParentalPin);
    });
  }

  openSpeedTestSubModal() {
    this.dom.modalSettingsSubTitle.textContent = i18n.get('settingsSpeedTest');
    this.dom.modalSettingsSubFooter.classList.add('hidden');
    this.dom.modalSettingsSubBody.innerHTML = `
      <div class="speedtest-panel">
        <div class="speedtest-gauge-value"><span id="speedtest-mbps-val">--</span><span class="speedtest-gauge-unit">Mbps</span></div>
        <div class="speedtest-progress-track"><div class="speedtest-progress-fill" id="speedtest-progress-fill"></div></div>
        <div class="speedtest-stats-grid">
          <div class="speedtest-stat-card">
            <span class="speedtest-stat-label">${this.escapeHtml(i18n.get('speedTestPingLabel'))}</span>
            <span class="speedtest-stat-val" id="speedtest-ping-val">--</span>
          </div>
          <div class="speedtest-stat-card">
            <span class="speedtest-stat-label">${this.escapeHtml(i18n.get('speedTestJitterLabel'))}</span>
            <span class="speedtest-stat-val" id="speedtest-jitter-val">--</span>
          </div>
          <div class="speedtest-stat-card">
            <span class="speedtest-stat-label">${this.escapeHtml(i18n.get('speedTestQualityLabel'))}</span>
            <span class="speedtest-stat-val" id="speedtest-quality-val">--</span>
          </div>
        </div>
        <button class="btn-amber" id="btn-run-speedtest">${this.escapeHtml(i18n.get('speedTestRun'))}</button>
        <div id="speedtest-output" style="font-size: 0.85rem; color: var(--text-secondary);">${this.escapeHtml(i18n.get('speedTestIdle'))}</div>
      </div>
    `;
    const runBtn = document.getElementById('btn-run-speedtest');
    const mbpsEl = document.getElementById('speedtest-mbps-val');
    const pingEl = document.getElementById('speedtest-ping-val');
    const jitterEl = document.getElementById('speedtest-jitter-val');
    const qualityEl = document.getElementById('speedtest-quality-val');
    const fillEl = document.getElementById('speedtest-progress-fill');
    const out = document.getElementById('speedtest-output');

    if (runBtn && out) {
      runBtn.onclick = async () => {
        runBtn.disabled = true;
        out.textContent = i18n.get('speedTestRunning');
        if (fillEl) fillEl.style.width = '8%';
        if (mbpsEl) mbpsEl.textContent = '--';
        if (pingEl) pingEl.textContent = '--';
        if (jitterEl) jitterEl.textContent = '--';
        if (qualityEl) qualityEl.textContent = '--';

        try {
          const result = await this.runFreeSpeedTest(({ phase, progressPct, mbps, pingMs, jitterMs }) => {
            if (fillEl && typeof progressPct === 'number') fillEl.style.width = `${progressPct}%`;
            if (pingEl && typeof pingMs === 'number') pingEl.textContent = `${pingMs} ms`;
            if (jitterEl && typeof jitterMs === 'number') jitterEl.textContent = `${jitterMs} ms`;
            if (mbpsEl && typeof mbps === 'number' && phase === 'download') mbpsEl.textContent = mbps.toFixed(1);
          });

          const mbpsFixed = result.mbps.toFixed(2);
          if (mbpsEl) mbpsEl.textContent = result.mbps.toFixed(1);
          if (pingEl) pingEl.textContent = `${result.pingMs} ms`;
          if (jitterEl) jitterEl.textContent = `${result.jitterMs} ms`;
          if (qualityEl) qualityEl.textContent = result.quality;
          if (fillEl) fillEl.style.width = '100%';
          out.innerHTML = `<strong style="color: var(--accent-green);">${this.escapeHtml(i18n.get('speedTestResult', { mbps: mbpsFixed, ms: result.pingMs }))}</strong>`;
          if (this.dom.tileSpeedtestSub) {
            this.dom.tileSpeedtestSub.textContent = `${result.mbps.toFixed(1)} Mbps • ${result.pingMs} ms`;
          }
          runBtn.textContent = i18n.get('speedTestRetry');
        } catch {
          if (fillEl) fillEl.style.width = '0%';
          out.innerHTML = `<span style="color: var(--error-red);">${this.escapeHtml(i18n.get('speedTestError'))}</span>`;
          runBtn.textContent = i18n.get('speedTestRetry');
        } finally {
          runBtn.disabled = false;
        }
      };
    }
    this.openModal(this.dom.modalSettingsSub);
  }

  async runFreeSpeedTest(onProgress = null) {
    const timedFetch = async (url, timeoutMs = 9000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { cache: 'no-store', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    const pingEndpoints = [
      () => `https://speed.cloudflare.com/__down?bytes=0&cb=${Date.now()}_${Math.random()}`,
      () => `https://cdn.jsdelivr.net/npm/hls.js@1.5.17/package.json?cb=${Date.now()}_${Math.random()}`
    ];

    const pings = [];
    for (const makeUrl of pingEndpoints) {
      try {
        await timedFetch(makeUrl(), 5000); // Warm-up TLS/DNS
        for (let i = 0; i < 3; i++) {
          const t0 = performance.now();
          const r = await timedFetch(makeUrl(), 5000);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          pings.push(Math.max(1, Math.round(performance.now() - t0)));
        }
        break;
      } catch {
        pings.length = 0;
      }
    }

    if (pings.length === 0) throw new Error('Ping unreachable');
    const sortedPings = [...pings].sort((a, b) => a - b);
    const pingMs = sortedPings[Math.floor(sortedPings.length / 2)];
    let jitterSum = 0;
    for (let i = 1; i < pings.length; i++) jitterSum += Math.abs(pings[i] - pings[i - 1]);
    const jitterMs = pings.length > 1 ? Math.round(jitterSum / (pings.length - 1)) : 0;
    onProgress?.({ phase: 'ping', progressPct: 28, pingMs, jitterMs });

    const downloadEndpoints = [
      () => `https://speed.cloudflare.com/__down?bytes=5000000&cb=${Date.now()}`,
      () => `https://speed.cloudflare.com/__down?bytes=2000000&cb=${Date.now()}`,
      () => `https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js?cb=${Date.now()}`,
      () => `https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js?cb=${Date.now()}`
    ];

    let totalBytes = 0;
    let elapsedSec = 0;
    for (const makeUrl of downloadEndpoints) {
      const controller = new AbortController();
      const maxTimeTimer = setTimeout(() => controller.abort(), 8000);
      const dlStart = performance.now();
      let received = 0;
      try {
        const res = await fetch(makeUrl(), { cache: 'no-store', signal: controller.signal });
        if (!res.ok) {
          clearTimeout(maxTimeTimer);
          continue;
        }
        const totalExpected = parseInt(res.headers.get('content-length') || '0', 10) || 5000000;
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value ? value.byteLength : 0;
            const dt = Math.max(0.05, (performance.now() - dlStart) / 1000);
            const liveMbps = (received * 8) / dt / 1_000_000;
            const pct = Math.min(95, 28 + Math.round((received / totalExpected) * 67));
            onProgress?.({ phase: 'download', progressPct: pct, mbps: liveMbps, pingMs, jitterMs });
          }
        } else {
          const buf = await res.arrayBuffer();
          received = buf.byteLength;
        }
        clearTimeout(maxTimeTimer);
        elapsedSec = Math.max(0.05, (performance.now() - dlStart) / 1000);
        if (received > 0) {
          totalBytes = received;
          break;
        }
      } catch {
        clearTimeout(maxTimeTimer);
        elapsedSec = Math.max(0.05, (performance.now() - dlStart) / 1000);
        if (received > 65536) {
          totalBytes = received;
          break;
        }
      }
    }

    if (totalBytes <= 0) throw new Error('Download unreachable');
    const mbps = (totalBytes * 8) / elapsedSec / 1_000_000;
    const quality = mbps >= 35 ? '4K UHD' : (mbps >= 15 ? 'Full HD' : (mbps >= 6 ? 'HD' : 'SD'));
    return { mbps, pingMs, jitterMs, quality };
  }

  // =====================================================
  // SCREEN 8: SETTINGS | EPG SUBSCREEN
  // =====================================================
  renderEpgSubscreen() {
    const cfg = storage.getSettings();
    const shift = Number(cfg.epgTimeshift) || 0;
    this.epg.setTimeshift(shift);
    if (this.dom.inputEpgTimeshift) this.dom.inputEpgTimeshift.value = String(shift);
    if (this.dom.epgTimeshiftValue) this.dom.epgTimeshiftValue.textContent = `${shift >= 0 ? '+' : ''}${shift}h`;
    this.renderEpgSources();
    if (!this.dom.epgPanelTimeline?.classList.contains('hidden')) {
      this.renderEpgTimeline();
    }
  }

  switchEpgTab(tabName) {
    this.dom.epgRailBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-epg-tab') === tabName));
    if (this.dom.epgPanelSources) this.dom.epgPanelSources.classList.toggle('hidden', tabName !== 'sources');
    if (this.dom.epgPanelTimeline) this.dom.epgPanelTimeline.classList.toggle('hidden', tabName !== 'timeline');
    if (this.dom.epgPanelTimeshift) this.dom.epgPanelTimeshift.classList.toggle('hidden', tabName !== 'timeshift');
    if (tabName === 'timeline') this.renderEpgTimeline();
  }

  getResolvedEpgSources() {
    const prof = storage.getActiveProfile();
    const profId = prof?.id || 'default';
    let sources = storage.getEpgSources(profId);
    const primaryUrl = prof?.epgUrl || this.playlist?.epgUrl;
    if (primaryUrl && !sources.some(s => s.url === primaryUrl)) {
      sources = [{ url: primaryUrl, enabled: true, status: this.epg.channels.size > 0 ? 'loaded' : 'pending', channels: this.epg.channels.size }, ...sources];
      storage.saveEpgSources(sources, profId);
    }
    return sources;
  }

  async removeEpgSourceAt(index) {
    const prof = storage.getActiveProfile();
    const profId = prof?.id || 'default';
    const list = this.getResolvedEpgSources();
    const removed = list[index];
    if (!removed) return;

    list.splice(index, 1);
    storage.saveEpgSources(list, profId);

    // Clear embedded/profile primary URL if it matches the removed EPG source so getResolvedEpgSources() doesn't re-add it
    if (prof && (prof.epgUrl === removed.url || prof.externalEpgUrl === removed.url)) {
      prof.epgUrl = '';
      prof.externalEpgUrl = '';
      storage.saveProfile(prof);
    }
    if (this.playlist && this.playlist.epgUrl === removed.url) {
      this.playlist.epgUrl = '';
      if (this.playlist.items?.length > 0) {
        await storage.savePlaylist(this.playlist, profId);
      }
    }

    if (list.length === 0 || list.every(s => s.enabled === false)) {
      this.epg.parse('');
      await storage.saveEpg('', profId);
      this.updateCurrentEpgDisplay();
      this.renderHomeHub();
      this.renderEpgTimeline();
    } else {
      await this.refreshAllEpgSources();
      return;
    }

    this.renderEpgSources();
  }

  renderEpgSources() {
    if (!this.dom.epgSourcesList) return;
    const sources = this.getResolvedEpgSources();
    if (sources.length === 0) {
      this.dom.epgSourcesList.innerHTML = `<p class="help-text">${this.escapeHtml(i18n.get('epgNoData'))}</p>`;
      return;
    }
    this.dom.epgSourcesList.innerHTML = sources.map((s, idx) => {
      const statusText = s.status === 'failed' ? i18n.get('epgStatusFailed') : i18n.get('epgStatusLoaded');
      const statusColor = s.status === 'failed' ? 'var(--error-red)' : 'var(--accent-green)';
      return `
        <div class="epg-source-row">
          <label class="checkbox-label" style="flex: 1; min-width: 200px;">
            <input type="checkbox" data-epg-toggle="${idx}" ${s.enabled !== false ? 'checked' : ''} />
            <span style="word-break: break-all; font-size: 0.84rem;">${this.escapeHtml(s.url)}</span>
          </label>
          <span style="font-size: 0.76rem; color: ${statusColor}; font-weight: 700;">${statusText} (${i18n.get('epgChannelsFound', { count: s.channels || 0 })})</span>
          <button type="button" class="btn-secondary" data-epg-remove="${idx}" style="color: var(--error-red); padding: 0.3rem 0.6rem;" aria-label="Remove EPG">✕</button>
        </div>
      `;
    }).join('');

    const profId = storage.getActiveProfileId() || 'default';
    this.dom.epgSourcesList.querySelectorAll('[data-epg-toggle]').forEach(chk => {
      chk.addEventListener('change', () => {
        const i = parseInt(chk.getAttribute('data-epg-toggle'), 10);
        const list = this.getResolvedEpgSources();
        if (list[i]) list[i].enabled = chk.checked;
        storage.saveEpgSources(list, profId);
      });
    });
    this.dom.epgSourcesList.querySelectorAll('[data-epg-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const i = parseInt(btn.getAttribute('data-epg-remove'), 10);
        await this.removeEpgSourceAt(i);
      });
    });
  }

  handleAddEpgSource() {
    const url = this.dom.inputEpgSourceUrl?.value.trim();
    if (!url) return;
    const profId = storage.getActiveProfileId() || 'default';
    const sources = this.getResolvedEpgSources();
    if (!sources.some(s => s.url === url)) {
      sources.push({ url, enabled: true, status: 'pending', channels: 0 });
      storage.saveEpgSources(sources, profId);
    }
    this.dom.inputEpgSourceUrl.value = '';
    this.renderEpgSources();
  }

  async refreshAllEpgSources() {
    const profId = storage.getActiveProfileId() || 'default';
    const sources = this.getResolvedEpgSources();
    const xmlStrings = [];
    for (const src of sources) {
      if (src.enabled === false) continue;
      try {
        const xml = await fetchRemoteText(src.url);
        if (xml && xml.includes('<tv')) {
          xmlStrings.push(xml);
          const tempParser = new EPGParser();
          tempParser.parse(xml);
          src.status = 'loaded';
          src.channels = tempParser.channels.size;
        } else {
          src.status = 'failed';
        }
      } catch {
        src.status = 'failed';
      }
    }
    storage.saveEpgSources(sources, profId);
    if (xmlStrings.length > 0) {
      this.epg.mergeXml(xmlStrings);
      await storage.saveEpg(xmlStrings[0], profId);
      this.updateCurrentEpgDisplay();
      this.addAppNotification('success', i18n.get('notifEpgLoaded'), i18n.get('epgChannelsFound', { count: this.epg.channels.size }));
    } else if (sources.length > 0) {
      this.addAppNotification('error', i18n.get('notifEpgFailed'), '');
    }
    this.renderEpgSources();
    this.renderEpgTimeline();
  }

  _collectLiveEpgRows(query = '', upcomingLimit = 24) {
    const q = (query || '').trim().toLowerCase();
    const withEpg = [];
    const withoutEpg = [];

    for (let i = 0; i < this.playlist.items.length; i++) {
      const ch = this.playlist.items[i];
      if (ch.type !== ItemType.LIVE) continue;

      const cur = this.epg.getCurrentProgram(ch.tvgId, ch.name);
      const upcoming = this.epg.getUpcomingPrograms(ch.tvgId, ch.name, upcomingLimit);
      const hasEpg = Boolean(cur || upcoming.length > 0);

      if (q) {
        const nameMatch = (ch.name || '').toLowerCase().includes(q) || (ch.group || '').toLowerCase().includes(q);
        const progMatch = (cur && (cur.title || '').toLowerCase().includes(q)) ||
          upcoming.some(p => (p.title || '').toLowerCase().includes(q));
        if (!nameMatch && !progMatch) continue;
      }

      const entry = { ch, cur, upcoming };
      if (hasEpg) withEpg.push(entry);
      else withoutEpg.push(entry);
    }

    return [...withEpg, ...withoutEpg];
  }

  _buildLiveEpgChannelRowsHtml(entries, playAttrName = 'data-play-id', playingId = null) {
    return entries.map(({ ch, cur, upcoming }) => {
      const chips = [];
      if (cur) {
        chips.push(`
          <div class="epg-prog-chip is-now">
            <div class="epg-prog-chip-time">${this.escapeHtml(i18n.get('epgTimelineNow'))} • ${cur.formattedStart} - ${cur.formattedStop}</div>
            <div class="epg-prog-chip-title">${this.escapeHtml(cur.title)}</div>
          </div>
        `);
      }
      upcoming.forEach(p => {
        chips.push(`
          <div class="epg-prog-chip">
            <div class="epg-prog-chip-time">${p.formattedStart} - ${p.formattedStop}</div>
            <div class="epg-prog-chip-title">${this.escapeHtml(p.title)}</div>
          </div>
        `);
      });

      const isPlaying = playingId && String(ch.id) === String(playingId);
      return `
        <div class="epg-timeline-channel-row ${isPlaying ? 'is-playing' : ''}">
          <div class="epg-timeline-ch-info" ${playAttrName}="${this.escapeHtml(ch.id)}" tabindex="0" role="button">
            <img src="${ch.logo || 'assets/logo.svg'}" alt="" loading="lazy" onerror="this.src='assets/logo.svg'" />
            <span class="epg-timeline-ch-name">${this.escapeHtml(ch.name)}</span>
          </div>
          <div class="epg-timeline-progs">
            ${chips.length > 0 ? chips.join('') : `<span class="help-text" style="align-self: center;">${this.escapeHtml(i18n.get('epgNoData'))}</span>`}
          </div>
        </div>
      `;
    }).join('');
  }

  renderEpgTimeline() {
    if (!this.dom.epgTimelineContainer) return;
    if (this.dom.epgPanelTimeline?.classList.contains('hidden')) return;

    const ordered = this._collectLiveEpgRows(this.dom.inputEpgTimelineSearch?.value || '', 24);
    const total = ordered.length;
    const limit = Math.max(60, this.epgTimelineLimit || 60);
    const visible = ordered.slice(0, limit);

    if (this.dom.epgTimelineStats) {
      this.dom.epgTimelineStats.textContent = i18n.get('epgChannelsFound', { count: `${visible.length}/${total}` });
    }

    if (visible.length === 0) {
      this.dom.epgTimelineContainer.innerHTML = `<p class="help-text">${this.escapeHtml(i18n.get('epgNoData'))}</p>`;
      this.dom.epgTimelineLoadMoreWrap?.classList.add('hidden');
      return;
    }

    this.dom.epgTimelineContainer.innerHTML = this._buildLiveEpgChannelRowsHtml(visible, 'data-play-id');

    if (this.dom.epgTimelineLoadMoreWrap && this.dom.btnEpgTimelineLoadMore) {
      const hasMore = visible.length < total;
      this.dom.epgTimelineLoadMoreWrap.classList.toggle('hidden', !hasMore);
      if (hasMore) {
        this.dom.btnEpgTimelineLoadMore.textContent = i18n.get('btnLoadMore', { shown: visible.length, total });
      }
    }

    this.dom.epgTimelineContainer.querySelectorAll('[data-play-id]').forEach(el => {
      el.addEventListener('click', () => {
        const item = this.playlist.items.find(x => x.id === el.getAttribute('data-play-id'));
        if (item) {
          this.openBrowseView(ItemType.LIVE, item.group || 'all', true);
          this.playChannel(item);
        }
      });
    });
  }

  applyEpgTimeshift(hours) {
    const h = Math.max(-12, Math.min(12, Number(hours) || 0));
    this.epg.setTimeshift(h);
    storage.saveSettings({ epgTimeshift: h });
    if (this.dom.inputEpgTimeshift) this.dom.inputEpgTimeshift.value = String(h);
    if (this.dom.epgTimeshiftValue) this.dom.epgTimeshiftValue.textContent = `${h >= 0 ? '+' : ''}${h}h`;
    this.updateCurrentEpgDisplay();
    this.renderEpgTimeline();
  }

  // =====================================================
  // SCREEN 6: MULTI-SCREEN
  // =====================================================
  openMultiScreenView() {
    this.navigateToScreen('multiscreen');
    const slotCount = (this.multiScreenLayout === '2x2' || this.multiScreenLayout === '1-3') ? 4
      : (this.multiScreenLayout === '1-2' || this.multiScreenLayout === '2-1') ? 3 : 2;

    if (this.dom.multiscreenNativeNote) {
      this.dom.multiscreenNativeNote.classList.toggle('hidden', !window.androidBridge);
    }

    if (!this.dom.multiscreenGrid) return;
    this.dom.multiscreenGrid.className = `multiscreen-grid layout-${this.multiScreenLayout}`;

    let html = '';
    for (let i = 0; i < slotCount; i++) {
      const item = this.multiScreenSlots[i];
      const activeClass = i === this.activeMultiSlot ? 'slot-active' : '';
      html += `
        <div class="multiscreen-slot ${activeClass}" data-slot-index="${i}" tabindex="0">
          ${item ? `
            <video id="ms-video-${i}" playsinline autoplay ${i !== this.activeMultiSlot ? 'muted' : ''}></video>
            <div class="multiscreen-slot-hud">
              <span class="multiscreen-slot-title">${this.escapeHtml(item.name)}</span>
              <div style="display:flex; gap:0.35rem;">
                <button class="btn-icon" data-ms-audio="${i}" title="Audio">${i === this.activeMultiSlot ? '🔊' : '🔇'}</button>
                <button class="btn-icon" data-ms-pick="${i}" title="Trocar">⇄</button>
                <button class="btn-icon" data-ms-clear="${i}" title="Limpar">✕</button>
              </div>
            </div>
          ` : `
            <button class="multiscreen-slot-empty" data-ms-pick="${i}">
              <span class="multiscreen-slot-plus">+</span>
              <span>${this.escapeHtml(i18n.get('multiScreenSelectSlot'))}</span>
            </button>
          `}
        </div>
      `;
    }
    this.dom.multiscreenGrid.innerHTML = html;

    const cfg = storage.getSettings();
    for (let i = 0; i < slotCount; i++) {
      const item = this.multiScreenSlots[i];
      const vid = document.getElementById(`ms-video-${i}`);
      if (item && vid) {
        this.multiScreen.attachSlot(i, vid, item, cfg.corsProxy, cfg.streamMode);
      }
    }

    this.dom.multiscreenGrid.querySelectorAll('[data-ms-pick]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pendingSlotIndex = parseInt(btn.getAttribute('data-ms-pick'), 10);
        this.openSlotPickerModal();
      });
    });
    this.dom.multiscreenGrid.querySelectorAll('[data-ms-audio]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-ms-audio'), 10);
        this.activeMultiSlot = idx;
        this.multiScreen.setAudioSlot(idx);
        this.openMultiScreenView();
      });
    });
    this.dom.multiscreenGrid.querySelectorAll('[data-ms-clear]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-ms-clear'), 10);
        this.multiScreenSlots[idx] = null;
        this.multiScreen.clearSlot(idx);
        this.openMultiScreenView();
      });
    });
  }

  openSlotPickerModal() {
    if (this.dom.inputSlotPickerSearch) this.dom.inputSlotPickerSearch.value = '';
    this.renderSlotPickerResults();
    this.openModal(this.dom.modalSlotPicker);
  }

  renderSlotPickerResults() {
    if (!this.dom.slotPickerResults) return;
    const q = (this.dom.inputSlotPickerSearch?.value || '').trim().toLowerCase();
    const items = this.playlist.items
      .filter(x => !q || (x.name || '').toLowerCase().includes(q) || (x.group || '').toLowerCase().includes(q))
      .slice(0, 60);

    this.dom.slotPickerResults.innerHTML = items.map(it => `
      <div class="master-search-row" data-slot-item-id="${this.escapeHtml(it.id)}" tabindex="0" role="button">
        <div style="min-width:0;">
          <strong style="display:block; font-size:0.88rem;">${this.escapeHtml(it.name)}</strong>
          <span class="help-text">${this.escapeHtml(it.group || '')}</span>
        </div>
        <span class="channel-badge ${it.type || 'live'}">${(it.type || 'live').toUpperCase()}</span>
      </div>
    `).join('');

    this.dom.slotPickerResults.querySelectorAll('[data-slot-item-id]').forEach(row => {
      row.addEventListener('click', () => {
        const item = this.playlist.items.find(x => x.id === row.getAttribute('data-slot-item-id'));
        if (item) {
          this.multiScreenSlots[this.pendingSlotIndex] = item;
          this.activeMultiSlot = this.pendingSlotIndex;
          this.closeModal(this.dom.modalSlotPicker);
          this.openMultiScreenView();
        }
      });
    });
  }

  // =====================================================
  // SCREEN 7: NOTIFICATIONS
  // =====================================================
  addAppNotification(type, title, message, meta = null) {
    storage.addNotification({ type, title, message, meta, read: false });
    this.updateNotificationBadge();
    if (this.activeScreen === 'notifications') this.renderNotifications();
  }

  addUpdateNotification(info) {
    if (!info || !info.latestVersion) return;
    const ver = String(info.latestVersion).replace(/^[vV]/, '');
    const list = storage.getNotifications();
    const existingIdx = list.findIndex(n => n.meta?.kind === 'app_update' && n.meta?.updateVersion === ver);
    const body = i18n.get('updateNotificationBody', {
      latest: ver,
      current: info.currentVersion || APP_VERSION
    });

    const meta = {
      kind: 'app_update',
      updateVersion: ver,
      downloadUrl: info.downloadUrl || null,
      apkDownloadUrl: info.apkDownloadUrl || null,
      apkAssetName: info.apkAssetName || '',
      sha256SumsUrl: info.sha256SumsUrl || '',
      releaseUrl: info.releaseUrl || 'https://github.com/CesarOvies/FluiStream/releases/latest',
      releaseNotes: info.releaseNotes || ''
    };

    if (existingIdx >= 0) {
      // Atualiza URLs/metadados sem duplicar o alerta no sino superior
      list[existingIdx].meta = { ...list[existingIdx].meta, ...meta };
      list[existingIdx].message = body;
      try { localStorage.setItem('fluistream_notifications', JSON.stringify(list)); } catch {}
      this.updateNotificationBadge();
      if (this.activeScreen === 'notifications') this.renderNotifications();
      return;
    }

    this.addAppNotification('info', i18n.get('notifUpdateTitle'), body, meta);
  }

  notifyHostUpdateAvailable(latestVersion, downloadUrl, releaseNotes = '') {
    this.addUpdateNotification({
      latestVersion,
      currentVersion: i18n.get('settingsVersion')?.match(/\d+\.\d+\.\d+/)?.[0] || '',
      downloadUrl,
      releaseNotes
    });
  }

  triggerAppUpdate(info) {
    if (!info) return;
    if (window.androidBridge?.requestAppUpdate && info.apkDownloadUrl) {
      window.androidBridge.requestAppUpdate(
        info.updateVersion || info.latestVersion || '',
        info.releaseNotes || '',
        info.apkDownloadUrl,
        info.apkAssetName || '',
        info.sha256SumsUrl || '',
        info.releaseUrl || ''
      );
      return;
    }
    if (window.chrome?.webview && info.downloadUrl) {
      window.chrome.webview.postMessage({
        type: 'START_UPDATE',
        version: info.updateVersion || info.latestVersion || '',
        downloadUrl: info.downloadUrl
      });
      return;
    }
    if (info.releaseUrl) {
      window.open(info.releaseUrl, '_blank', 'noopener,noreferrer');
    }
  }

  updateNotificationBadge() {
    if (!this.dom.notifBadge) return;
    const unread = storage.getNotifications().filter(n => !n.read).length;
    this.dom.notifBadge.textContent = String(unread);
    this.dom.notifBadge.classList.toggle('hidden', unread === 0);
  }

  renderNotifications() {
    if (!this.dom.notificationsList) return;
    const list = storage.getNotifications();
    if (list.length === 0) {
      this.dom.notificationsList.innerHTML = `<div class="notifications-empty">${this.escapeHtml(i18n.get('notificationsEmpty'))}</div>`;
      return;
    }

    let markedAny = false;
    list.forEach(n => {
      if (!n.read) { n.read = true; markedAny = true; }
    });
    if (markedAny) {
      try { localStorage.setItem('fluistream_notifications', JSON.stringify(list)); } catch {}
      this.updateNotificationBadge();
    }

    this.dom.notificationsList.innerHTML = list.map((n, idx) => {
      const dateStr = new Date(n.createdAt || Date.now()).toLocaleString(i18n.currentLanguage || 'pt-BR');
      const isUpdate = n.meta?.kind === 'app_update';
      return `
        <div class="notification-card notif-${this.escapeHtml(n.type || 'info')}">
          <div>
            <strong style="display:block; font-size:0.9rem; color:var(--text-primary);">${this.escapeHtml(n.title)}</strong>
            <span style="font-size:0.82rem; color:var(--text-secondary);">${this.escapeHtml(n.message || '')}</span>
          </div>
          <div class="notification-card-actions">
            <span class="help-text">${dateStr}</span>
            ${isUpdate ? `<button type="button" class="btn-amber btn-notif-update" data-notif-idx="${idx}" style="font-size:0.74rem; padding:0.28rem 0.65rem;">${this.escapeHtml(i18n.get('btnUpdateNow'))}</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    this.dom.notificationsList.querySelectorAll('.btn-notif-update').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-notif-idx'), 10);
        const target = list[idx];
        if (target?.meta) this.triggerAppUpdate(target.meta);
      });
    });
  }

  // =====================================================
  // MASTER SEARCH (LIVE + MOVIES + SERIES + EPG)
  // =====================================================
  openMasterSearchModal() {
    if (this.dom.inputMasterSearch) this.dom.inputMasterSearch.value = '';
    this.renderMasterSearchResults();
    this.openModal(this.dom.modalMasterSearch);
    setTimeout(() => this.dom.inputMasterSearch?.focus(), 40);
  }

  renderMasterSearchResults() {
    if (!this.dom.masterSearchResults) return;
    const q = (this.dom.inputMasterSearch?.value || '').trim().toLowerCase();
    if (!q || q.length < 2) {
      this.dom.masterSearchResults.innerHTML = `<p class="help-text" style="text-align:center; padding:1.5rem;">${this.escapeHtml(i18n.get('masterSearchPlaceholder'))}</p>`;
      return;
    }

    this._ensurePlaylistIndexes();
    const items = this.playlist.items || [];
    const cfg = storage.getSettings();
    const hideAdult = Boolean(cfg.parentalPinHash) && !this.parentalUnlocked;

    const itemMatches = [];
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      if (hideAdult && PARENTAL_CATEGORY_RE.test(x.group || '')) continue;
      if ((x.name && x.name.toLowerCase().includes(q)) || (x.group && x.group.toLowerCase().includes(q))) {
        itemMatches.push(x);
        if (itemMatches.length >= 40) break;
      }
    }

    const epgMatches = [];
    for (const [chId, progs] of this.epg.programmes.entries()) {
      const ch = this._epgItemByChannelKey?.get(chId.toLowerCase()) || null;
      if (!ch) continue;
      if (hideAdult && PARENTAL_CATEGORY_RE.test(ch.group || '')) continue;
      for (let j = 0; j < progs.length; j++) {
        const p = progs[j];
        if ((p.title || '').toLowerCase().includes(q)) {
          epgMatches.push({ item: ch, program: p });
          if (epgMatches.length >= 15) break;
        }
      }
      if (epgMatches.length >= 15) break;
    }

    if (itemMatches.length === 0 && epgMatches.length === 0) {
      this.dom.masterSearchResults.innerHTML = `<p class="help-text" style="text-align:center; padding:1.5rem;">${this.escapeHtml(i18n.get('notificationsEmpty'))}</p>`;
      return;
    }

    const matchedMap = new Map();
    itemMatches.forEach(it => matchedMap.set(String(it.id), it));
    epgMatches.forEach(({ item }) => matchedMap.set(String(item.id), item));

    const rows = [
      ...itemMatches.map(it => `
        <div class="master-search-row" data-ms-item-id="${this.escapeHtml(it.id)}" tabindex="0" role="button">
          <div style="min-width:0;">
            <strong style="display:block; font-size:0.88rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.escapeHtml(it.name)}</strong>
            <span class="help-text">${this.escapeHtml(it.group || '')}</span>
          </div>
          <span class="channel-badge ${it.type || 'live'}">${(it.type || 'live').toUpperCase()}</span>
        </div>
      `),
      ...epgMatches.map(({ item, program }) => `
        <div class="master-search-row" data-ms-item-id="${this.escapeHtml(item.id)}" tabindex="0" role="button">
          <div style="min-width:0;">
            <strong style="display:block; font-size:0.88rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">EPG: ${this.escapeHtml(program.title)}</strong>
            <span class="help-text">${this.escapeHtml(item.name)} (${this.epg.formatTime(program.start)})</span>
          </div>
          <span class="channel-badge live">EPG</span>
        </div>
      `)
    ];

    this.dom.masterSearchResults.innerHTML = rows.join('');
    this.dom.masterSearchResults.querySelectorAll('[data-ms-item-id]').forEach(row => {
      const activate = () => {
        const id = row.getAttribute('data-ms-item-id');
        const item = matchedMap.get(String(id)) || this.playlist.items.find(x => String(x.id) === String(id));
        if (item) {
          this.closeModal(this.dom.modalMasterSearch);
          this.openBrowseView(item.type || ItemType.LIVE, item.group || 'all', true);
          this.playChannel(item);
        }
      };
      row.addEventListener('click', activate);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  // =====================================================
  // MODALS, ACCESSIBILITY (inert), STATE & PROFILES
  // =====================================================
  setBackgroundInert(isInert) {
    [this.dom.appHeader, this.dom.mainLayout, this.dom.siteFooter].forEach(el => {
      if (!el) return;
      if (isInert) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  openModal(modal) {
    if (!modal) return;
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) {
      this.lastFocusedElement = document.activeElement;
    }
    modal.classList.remove('hidden');
    modal.setAttribute('data-modal-open', 'true');
    this.setBackgroundInert(true);

    const firstFocusable = modal.querySelector('button, input, select, [tabindex="0"]');
    if (firstFocusable) firstFocusable.focus();

    if (this.player) {
      this.player.setOverlayVisible(false);
      this.player.reportLayout();
    }
  }

  closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.removeAttribute('data-modal-open');

    const stillOpen = Boolean(document.querySelector('.modal-backdrop:not(.hidden)'));
    if (!stillOpen) {
      this.setBackgroundInert(false);
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        this.lastFocusedElement.focus();
      }
    }

    if (this.player) {
      this.player.setOverlayVisible(!stillOpen && this.activeScreen === 'browse' && Boolean(this.currentPlayingItem));
      this.player.reportLayout();
    }
  }

  async loadSavedState() {
    const cfg = storage.getSettings();
    const isDesktop = Boolean(window.chrome?.webview);

    this.epg.setTimeshift(Number(cfg.epgTimeshift) || 0);

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

    let activeProfile = storage.getActiveProfile();
    const saved = await storage.loadPlaylist(activeProfile?.id);
    if (saved && saved.items && saved.items.length > 0) {
      M3UParser.ensureUniqueItemIds(saved.items);
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
            expDate: i18n.get('accNoExpiration'),
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
      if (rawEpg) this.epg.parse(rawEpg);
    }

    if (this.dom.headerProfileName) {
      this.dom.headerProfileName.textContent = activeProfile?.name || 'Perfil';
    }
  }

  async loadDemoPlaylist() {
    const demoM3U = `#EXTM3U
#EXTINF:-1 tvg-id="test.mux" tvg-name="Mux Test Live Stream" tvg-logo="assets/logo.svg" group-title="Canais Teste" catchup="default" catchup-days="3",Mux Test Live Stream (HLS)
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
  <channel id="test.mux"><display-name>Mux Test Live Stream</display-name></channel>
  <programme start="${this.formatXmltvDate(now, 0)}" stop="${this.formatXmltvDate(now, 2)}" channel="test.mux">
    <title>Transmissão Teste Ao Vivo</title>
    <desc>Fluxo contínuo de alta performance HLS.</desc>
  </programme>
  <channel id="akamai.live"><display-name>Akamai Live Stream</display-name></channel>
  <programme start="${this.formatXmltvDate(now, 0)}" stop="${this.formatXmltvDate(now, 3)}" channel="akamai.live">
    <title>Akamai Worldwide Feed</title>
    <desc>Cobertura internacional.</desc>
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
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')} +0000`;
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
            expDate: i18n.get('accNoExpiration'),
            isTrial: 'No',
            activeCons: '0',
            createdAt: new Date().toLocaleDateString('pt-BR'),
            maxConnections: '5'
          }
        };
      } else if (activeTab === 'panel-url') {
        const url = this.dom.urlInput.value.trim();
        if (!url) throw new Error(i18n.get('labelUrlInput'));
        listName = this.dom.profileNameInput?.value.trim() || 'Lista URL';
        m3uContent = await fetchRemoteText(url);
        profileMeta = {
          name: listName,
          type: 'm3u_url',
          sourceInfo: `URL : ${url}`,
          url,
          m3uUrl: url,
          accountInfo: {
            username: listName,
            status: 'Active',
            expDate: i18n.get('accNoExpiration'),
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

        this.dom.importStatusMsg.textContent = i18n.get('statusParsingM3u');
        m3uContent = await xtream.fetchM3uContent();
        if (!externalEpgUrl) externalEpgUrl = xtream.getEpgUrl();

        const accInfo = auth.accountInfo || auth.user;
        const expFormatted = accInfo?.expDate ? accInfo.expDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Active';
        const createdFormatted = accInfo?.createdAt ? accInfo.createdAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

        profileMeta = {
          name: listName,
          type: 'xtream',
          sourceInfo: `Username : ${user}`,
          url: xtream.serverUrl,
          serverUrl: xtream.serverUrl,
          xtreamServer: xtream.serverUrl,
          username: user,
          xtreamUser: user,
          password: pass,
          xtreamPass: pass,
          epgUrl: externalEpgUrl,
          accountInfo: {
            username: accInfo?.username || user,
            status: accInfo?.status || 'Active',
            expDate: expFormatted,
            isTrial: accInfo?.isTrial || 'No',
            activeCons: String(accInfo?.activeCons || '0'),
            createdAt: createdFormatted,
            maxConnections: String(accInfo?.maxConnections || '1'),
            serverUrl: xtream.serverUrl
          }
        };
      }

      await this.processLoadedM3u(m3uContent, listName, null, externalEpgUrl, profileMeta);
      this.closeModal(this.dom.modalImport);
    } catch (err) {
      this.dom.importStatusMsg.textContent = err.message;
      this.addAppNotification('error', i18n.get('errorNetwork'), err.message);
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
      ...profileMeta,
      id: profileId,
      name: profileName,
      type: profileMeta?.type || 'm3u_file',
      sourceInfo: profileMeta?.sourceInfo || name || 'Lista M3U',
      streamMode: profileMeta?.streamMode || this.dom.streamModeSelect?.value || 'auto',
      playerEngine: profileMeta?.playerEngine || this.dom.playerEngineSelect?.value || (isDesktop ? 'vlc' : 'hls'),
      corsProxy: profileMeta?.corsProxy || cfg.corsProxy || '',
      epgUrl: externalEpgUrl || profileMeta?.epgUrl || parsed.epgUrl || null,
      externalEpgUrl: externalEpgUrl || parsed.epgUrl,
      accountInfo: profileMeta?.accountInfo || {
        username: profileName,
        status: 'Active',
        expDate: i18n.get('accNoExpiration'),
        isTrial: 'No',
        activeCons: '0',
        createdAt: new Date().toLocaleDateString('pt-BR'),
        maxConnections: '5'
      },
      summary: parsed.summary,
      createdAt: profileMeta?.createdAt || Date.now()
    };

    storage.saveProfile(profile);
    storage.setActiveProfileId(profile.id);

    this.playlist = {
      name: profileName,
      items: parsed.items,
      epgUrl: profile.epgUrl,
      summary: parsed.summary
    };

    await storage.savePlaylist(this.playlist, profile.id);

    if (this.dom.headerProfileName) {
      this.dom.headerProfileName.textContent = profile.name;
    }

    if (embeddedXmltv) {
      this.epg.parse(embeddedXmltv);
      await storage.saveEpg(embeddedXmltv, profile.id);
      this.updateCurrentEpgDisplay();
    } else if (this.playlist.epgUrl && this.dom.useEmbeddedEpgCheck?.checked !== false) {
      this.fetchAndParseEpg(this.playlist.epgUrl, profile.id);
    }

    this.navigateToScreen('home');
  }

  async fetchAndParseEpg(epgUrl, profileId = null) {
    try {
      if (this.dom.epgStatusBadge) this.dom.epgStatusBadge.textContent = 'Carregando EPG...';
      const xml = await fetchRemoteText(epgUrl);
      if (xml && xml.includes('<tv')) {
        this.epg.parse(xml);
        await storage.saveEpg(xml, profileId || storage.getActiveProfileId());
        this.updateCurrentEpgDisplay();
        const totalProgs = Array.from(this.epg.programmes.values()).reduce((acc, p) => acc + p.length, 0);
        if (this.dom.epgStatusBadge) this.dom.epgStatusBadge.textContent = `EPG: ${totalProgs} progs`;
        this.addAppNotification('success', i18n.get('notifEpgLoaded'), i18n.get('epgChannelsFound', { count: this.epg.channels.size }));
      }
    } catch (e) {
      if (this.dom.epgStatusBadge) this.dom.epgStatusBadge.textContent = 'EPG Indisponível';
      this.addAppNotification('warning', i18n.get('notifEpgFailed'), e.message || '');
    }
  }

  // =====================================================
  // ACCOUNT INFO (SCREEN 4 - LIVE REFRESH)
  // =====================================================
  async openAccountModal(targetProfile = null) {
    const prof = targetProfile || storage.getActiveProfile();
    this.renderAccountModalFields(prof);
    this.openModal(this.dom.modalAccount);

    if (prof && prof.type === 'xtream') {
      const server = prof.url || prof.serverUrl || prof.xtreamServer || prof.accountInfo?.serverUrl;
      const user = prof.username || prof.xtreamUser || prof.accountInfo?.username;
      const pass = prof.password || prof.xtreamPass;
      if (server && user && pass) {
        if (this.dom.accRefreshStatus) this.dom.accRefreshStatus.textContent = '...';
        const cfg = storage.getSettings();
        const xtream = new XtreamApi(server, user, pass, prof.corsProxy || cfg.corsProxy);
        const auth = await xtream.authenticate();
        if (this.dom.accRefreshStatus) this.dom.accRefreshStatus.textContent = '';

        if (auth.success && (auth.accountInfo || auth.user)) {
          const info = auth.accountInfo || auth.user;
          const expFormatted = info.expDate ? info.expDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Active';
          const createdFormatted = info.createdAt ? info.createdAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

          prof.accountInfo = {
            ...(prof.accountInfo || {}),
            username: info.username || user,
            status: info.status || 'Active',
            expDate: expFormatted,
            isTrial: info.isTrial || 'No',
            activeCons: String(info.activeCons || '0'),
            createdAt: createdFormatted,
            maxConnections: String(info.maxConnections || '1'),
            serverUrl: server
          };
          storage.saveProfile(prof);
          this.renderAccountModalFields(prof);

          if (info.expDate && (info.expDate.getTime() - Date.now()) < 7 * 86400000) {
            this.addAppNotification('warning', i18n.get('notifExpirySoon'), `${prof.name} — ${expFormatted}`);
          }
        }
      }
    }
  }

  renderAccountModalFields(prof) {
    const acc = prof?.accountInfo || {
      username: prof?.name || 'Eu',
      status: 'Active',
      expDate: i18n.get('accNoExpiration'),
      isTrial: 'No',
      activeCons: '0',
      createdAt: new Date().toLocaleDateString('pt-BR'),
      maxConnections: '5'
    };
    const status = acc.status || 'Active';
    if (this.dom.accUsername) this.dom.accUsername.textContent = acc.username || prof?.name || '-';
    if (this.dom.accStatus) {
      this.dom.accStatus.textContent = status;
      this.dom.accStatus.className = `status-pill ${status === 'Active' ? 'status-pill--active' : 'status-pill--expired'}`;
    }
    if (this.dom.accExpDate) this.dom.accExpDate.textContent = acc.expDate || i18n.get('accNoExpiration');
    if (this.dom.accTrial) this.dom.accTrial.textContent = acc.isTrial || 'No';
    if (this.dom.accActiveCons) this.dom.accActiveCons.textContent = acc.activeCons || '0';
    if (this.dom.accCreatedAt) this.dom.accCreatedAt.textContent = acc.createdAt || '-';
    if (this.dom.accMaxCons) this.dom.accMaxCons.textContent = acc.maxConnections || '1';
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
        this.navigateToScreen('empty');
      }
    }
  }

  // =====================================================
  // PROFILES & EDIT PROFILE (NORMALIZED XTREAM FIELDS)
  // =====================================================
  openProfilesModal() {
    const profiles = storage.getProfiles();
    const activeId = storage.getActiveProfileId();
    if (!this.dom.profilesGrid) return;

    if (profiles.length === 0) {
      this.dom.profilesGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-secondary);">Nenhum perfil cadastrado.</div>`;
    } else {
      this.dom.profilesGrid.innerHTML = profiles.map(p => {
        const isActive = p.id === activeId;
        return `
          <div class="profile-card ${isActive ? 'active-profile' : ''}" data-profile-id="${this.escapeHtml(p.id)}" tabindex="0">
            <div class="profile-card-icon">👤</div>
            <div class="profile-card-details">
              <div class="profile-card-title">
                <span class="profile-card-name" title="${this.escapeHtml(p.name)}">${this.escapeHtml(p.name)}</span>
                ${isActive ? `<span class="profile-tag-active">${this.escapeHtml(i18n.get('profileActiveBadge'))}</span>` : ''}
              </div>
              <div class="profile-card-sub">${this.escapeHtml(p.sourceInfo || '')}</div>
            </div>
            <div class="profile-card-actions">
              <button class="btn-icon btn-profile-info" data-info-id="${this.escapeHtml(p.id)}" title="${this.escapeHtml(i18n.get('btnAccountInfo'))}">ℹ</button>
              <button class="btn-icon btn-profile-edit" data-edit-id="${this.escapeHtml(p.id)}" title="${this.escapeHtml(i18n.get('btnEditProfile'))}">✎</button>
              <button class="btn-icon btn-profile-del" data-del-id="${this.escapeHtml(p.id)}" title="${this.escapeHtml(i18n.get('btnDeleteProfile'))}" style="color: var(--error-red);">✕</button>
            </div>
          </div>
        `;
      }).join('');

      this.dom.profilesGrid.querySelectorAll('.profile-card').forEach(card => {
        card.addEventListener('click', async (e) => {
          if (e.target.closest('.profile-card-actions')) return;
          await this.switchProfile(card.getAttribute('data-profile-id'));
        });
      });
      this.dom.profilesGrid.querySelectorAll('.btn-profile-info').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const p = profiles.find(x => x.id === btn.getAttribute('data-info-id'));
          this.closeModal(this.dom.modalProfiles);
          this.openAccountModal(p);
        });
      });
      this.dom.profilesGrid.querySelectorAll('.btn-profile-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeModal(this.dom.modalProfiles);
          this.openEditProfileModal(btn.getAttribute('data-edit-id'));
        });
      });
      this.dom.profilesGrid.querySelectorAll('.btn-profile-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(i18n.get('confirmDeleteProfile'))) {
            await storage.deleteProfile(btn.getAttribute('data-del-id'));
            const remaining = storage.getProfiles();
            if (remaining.length > 0) await this.switchProfile(remaining[0].id);
            else {
              this.stopPlayback();
              this.playlist = { items: [], summary: { total: 0, live: 0, movies: 0, series: 0 }, name: '' };
              this.navigateToScreen('empty');
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
    if (this.dom.headerProfileName) this.dom.headerProfileName.textContent = prof?.name || 'Perfil';

    const saved = await storage.loadPlaylist(profileId);
    if (saved && saved.items) {
      M3UParser.ensureUniqueItemIds(saved.items);
      this.playlist = saved;
      const rawEpg = await storage.loadEpg(profileId);
      if (rawEpg) this.epg.parse(rawEpg);
      else {
        this.epg.channels.clear();
        this.epg.programmes.clear();
      }
    } else {
      this.playlist = { items: [], summary: { total: 0, live: 0, movies: 0, series: 0 }, name: '' };
    }

    this.closeModal(this.dom.modalProfiles);
    this.parentalUnlocked = false;
    this.navigateToScreen(this.playlist.items.length > 0 ? 'home' : 'empty');
  }

  openEditProfileModal(profileId) {
    const profiles = storage.getProfiles();
    const prof = profiles.find(p => p.id === profileId) || storage.getActiveProfile();
    if (!prof || !this.dom.modalEditProfile) return;

    this.dom.editProfileId.value = prof.id;
    this.dom.editProfileType.value = prof.type || 'm3u_file';
    this.dom.inputEditProfileName.value = prof.name || '';

    if (prof.type === 'xtream') {
      this.dom.editSectionXtream?.classList.remove('hidden');
      this.dom.editSectionM3uUrl?.classList.add('hidden');
      this.dom.inputEditXtreamServer.value = prof.url || prof.serverUrl || prof.xtreamServer || prof.accountInfo?.serverUrl || '';
      this.dom.inputEditXtreamUser.value = prof.username || prof.xtreamUser || prof.accountInfo?.username || '';
      this.dom.inputEditXtreamPass.value = prof.password || prof.xtreamPass || prof.accountInfo?.password || '';
      if (this.dom.btnReloadEditProfile) this.dom.btnReloadEditProfile.style.display = 'inline-flex';
    } else if (prof.type === 'm3u_url') {
      this.dom.editSectionXtream?.classList.add('hidden');
      this.dom.editSectionM3uUrl?.classList.remove('hidden');
      this.dom.inputEditM3uUrl.value = prof.url || prof.m3uUrl || '';
      if (this.dom.btnReloadEditProfile) this.dom.btnReloadEditProfile.style.display = 'inline-flex';
    } else {
      this.dom.editSectionXtream?.classList.add('hidden');
      this.dom.editSectionM3uUrl?.classList.add('hidden');
      if (this.dom.btnReloadEditProfile) this.dom.btnReloadEditProfile.style.display = 'none';
    }

    this.dom.inputEditExternalEpg.value = prof.epgUrl || '';
    this.dom.selectEditStreamMode.value = prof.streamMode || 'auto';
    this.dom.selectEditPlayerEngine.value = prof.playerEngine || 'hls';
    if (this.dom.editProfileAdvancedDetails) this.dom.editProfileAdvancedDetails.open = false;
    this.dom.inputEditCorsProxy.value = prof.corsProxy || '';
    this.dom.editProfileStatus.textContent = '';

    this.openModal(this.dom.modalEditProfile);
  }

  async handleSaveProfileEdit(reloadContent = false) {
    const profId = this.dom.editProfileId?.value;
    if (!profId) return;
    const prof = storage.getProfiles().find(p => p.id === profId);
    if (!prof) return;

    prof.name = this.dom.inputEditProfileName?.value.trim() || prof.name;
    const newEpgUrl = this.dom.inputEditExternalEpg?.value.trim() || null;
    prof.epgUrl = newEpgUrl;
    prof.streamMode = this.dom.selectEditStreamMode?.value || 'auto';
    prof.playerEngine = this.dom.selectEditPlayerEngine?.value || 'hls';
    prof.corsProxy = this.dom.inputEditCorsProxy?.value.trim() || '';

    let sourceChanged = false;
    if (prof.type === 'xtream') {
      const s = this.dom.inputEditXtreamServer?.value.trim() || '';
      const u = this.dom.inputEditXtreamUser?.value.trim() || '';
      const p = this.dom.inputEditXtreamPass?.value.trim() || '';
      if (s !== (prof.url || prof.xtreamServer) || u !== (prof.username || prof.xtreamUser) || p !== (prof.password || prof.xtreamPass)) {
        sourceChanged = true;
      }
      prof.url = s;
      prof.serverUrl = s;
      prof.xtreamServer = s;
      prof.username = u;
      prof.xtreamUser = u;
      prof.password = p;
      prof.xtreamPass = p;
      prof.sourceInfo = `Username : ${u}`;
      if (!prof.accountInfo) prof.accountInfo = {};
      prof.accountInfo.username = u;
      prof.accountInfo.serverUrl = s;
    } else if (prof.type === 'm3u_url') {
      const u = this.dom.inputEditM3uUrl?.value.trim() || '';
      if (u !== (prof.url || prof.m3uUrl)) sourceChanged = true;
      prof.url = u;
      prof.m3uUrl = u;
      prof.sourceInfo = `URL : ${u}`;
    }

    storage.saveProfile(prof);
    if (prof.id === storage.getActiveProfileId()) {
      if (this.dom.headerProfileName) this.dom.headerProfileName.textContent = prof.name;
      if (this.dom.streamModeSelect) this.dom.streamModeSelect.value = prof.streamMode;
      if (this.dom.playerEngineSelect) this.dom.playerEngineSelect.value = prof.playerEngine;
    }

    if ((reloadContent || sourceChanged) && (prof.type === 'xtream' || prof.type === 'm3u_url')) {
      if (this.dom.editProfileStatus) this.dom.editProfileStatus.textContent = i18n.get('statusParsingM3u');
      try {
        await this.reloadRemoteProfileData(prof);
      } catch (err) {
        this.addAppNotification('error', i18n.get('errorNetwork'), err.message);
      }
    } else if (newEpgUrl && newEpgUrl !== this.playlist?.epgUrl) {
      this.fetchAndParseEpg(newEpgUrl, prof.id);
    }

    this.closeModal(this.dom.modalEditProfile);
    this.openProfilesModal();
  }

  async reloadRemoteProfileData(prof, silent = false) {
    if (!prof) return;
    if (prof.type === 'xtream') {
      const cfg = storage.getSettings();
      const server = prof.url || prof.serverUrl || prof.xtreamServer || '';
      const user = prof.username || prof.xtreamUser || '';
      const pass = prof.password || prof.xtreamPass || '';
      const xtream = new XtreamApi(server, user, pass, prof.corsProxy || cfg.corsProxy);
      const m3uContent = await fetchRemoteText(xtream.getM3uUrl());
      const epgUrl = prof.epgUrl || xtream.getEpgUrl();
      await this.processLoadedM3u(m3uContent, prof.name, null, epgUrl, prof);
    } else if (prof.type === 'm3u_url') {
      const m3uContent = await fetchRemoteText(prof.url || prof.m3uUrl);
      await this.processLoadedM3u(m3uContent, prof.name, null, prof.epgUrl, prof);
    }
    if (!silent) this.renderHomeHub();
  }

  // =====================================================
  // SERIES MODAL & PLAYBACK
  // =====================================================
  openSeriesDetailModal(series) {
    if (!series) return;
    this.activeSeries = series;
    const seasonKeys = Object.keys(series.seasons).map(k => parseInt(k, 10)).sort((a, b) => a - b);
    this.selectedSeason = seasonKeys[0] || 1;

    if (this.dom.seriesPoster) this.dom.seriesPoster.src = series.logo || 'assets/logo.svg';
    if (this.dom.seriesTitle) this.dom.seriesTitle.textContent = series.seriesTitle;
    if (this.dom.seriesGenre) this.dom.seriesGenre.textContent = series.group || 'Série';
    if (this.dom.seriesStats) {
      this.dom.seriesStats.textContent = `${i18n.get('seasonsCount', { count: series.totalSeasons })} • ${i18n.get('episodesCount', { count: series.totalEpisodes })}`;
    }
    if (this.dom.seriesDesc) {
      this.dom.seriesDesc.textContent = series.sampleItem?.desc || series.sampleItem?.rawTitle || '';
    }
    this.updateSeasonButton();
    this.renderSeasonEpisodes(this.selectedSeason);
    this.openModal(this.dom.modalSeries);
  }

  updateSeasonButton() {
    if (this.dom.btnSeriesSeasonSelect) this.dom.btnSeriesSeasonSelect.textContent = `SEASON - ${this.selectedSeason} ▾`;
  }

  openSeasonsPopup() {
    if (!this.activeSeries || !this.dom.seasonsPopupList) return;
    const seasonKeys = Object.keys(this.activeSeries.seasons).map(k => parseInt(k, 10)).sort((a, b) => a - b);
    this.dom.seasonsPopupList.innerHTML = seasonKeys.map(sNum => `
      <button class="season-select-item ${sNum === this.selectedSeason ? 'active' : ''}" data-season="${sNum}">Season - ${sNum}</button>
    `).join('');
    this.dom.seasonsPopupList.querySelectorAll('.season-select-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedSeason = parseInt(btn.getAttribute('data-season'), 10);
        this.updateSeasonButton();
        this.renderSeasonEpisodes(this.selectedSeason);
        this.dom.seasonsPopup?.classList.add('hidden');
      });
    });
    this.dom.seasonsPopup?.classList.remove('hidden');
  }

  renderSeasonEpisodes(seasonNum) {
    if (!this.activeSeries || !this.dom.seriesEpisodesContainer) return;
    const episodes = this.activeSeries.seasons[seasonNum] || [];
    this.dom.seriesEpisodesContainer.innerHTML = episodes.map((ep, idx) => {
      const epNum = ep.episode || (idx + 1);
      const epTitle = `${this.activeSeries.seriesTitle} - S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')} - ${i18n.get('episodeNumber', { num: epNum })}`;
      const durText = ep.duration > 0 ? this.formatDuration(ep.duration) : '00:45:00';
      const thumb = ep.logo || this.activeSeries.logo || 'assets/logo.svg';
      return `
        <div class="episode-item-row" data-ep-id="${this.escapeHtml(ep.id)}" tabindex="0" role="button">
          <div class="episode-thumb-box"><img src="${thumb}" alt="" loading="lazy" /></div>
          <div class="episode-row-info">
            <div class="episode-row-title">${this.escapeHtml(epTitle)}</div>
            <div class="episode-row-duration">⏱ ${durText}</div>
          </div>
          <div class="episode-play-icon">▶</div>
        </div>
      `;
    }).join('');

    this.dom.seriesEpisodesContainer.querySelectorAll('.episode-item-row').forEach(row => {
      const playEp = () => {
        const ep = episodes.find(x => x.id === row.getAttribute('data-ep-id'));
        if (ep) {
          this.closeModal(this.dom.modalSeries);
          this.playChannel(ep);
        }
      };
      row.addEventListener('click', playEp);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playEp(); }
      });
    });
  }

  playChannel(item, opts = {}) {
    this.currentPlayingItem = item;
    if (item.type === ItemType.LIVE) {
      if (!opts.preserveEpgMode) this.browseEpgMode = 'channel';
    } else {
      this.browseEpgMode = 'all';
    }
    this._lastExtendedEpgSig = '';
    storage.addRecent(item);

    const cfg = storage.getSettings();
    const activeStreamMode = this.dom.streamModeSelect?.value || cfg.streamMode || 'auto';
    const activeEngine = this.dom.playerEngineSelect?.value || cfg.playerEngine || (window.chrome?.webview ? 'vlc' : 'hls');

    this.player.playStream(item, cfg.corsProxy, activeStreamMode, activeEngine);
    this.dom.playerCenterHit?.classList.toggle('hidden', activeEngine === 'vlc' && Boolean(window.chrome?.webview));
    this.syncVolumeUi();

    if (this.dom.currentChannelName) this.dom.currentChannelName.textContent = item.name;
    if (this.dom.currentChannelGroup) this.dom.currentChannelGroup.textContent = item.group || '';
    if (this.dom.currentChannelLogo) {
      if (item.logo) {
        this.dom.currentChannelLogo.src = item.logo;
        this.dom.currentChannelLogo.classList.remove('hidden');
      } else {
        this.dom.currentChannelLogo.classList.add('hidden');
      }
    }

    document.querySelectorAll('.sidebar-item-row').forEach(row => {
      row.classList.toggle('playing', String(row.getAttribute('data-id')) === String(item.id));
    });

    if (this.activeScreen === 'browse') {
      this.syncBrowseViewLayout();
    } else {
      this.updateCurrentEpgDisplay();
    }
  }

  stopPlayback() {
    if (this.player) {
      this.player.stop();
      this.player.setOverlayVisible(false);
    }
    this.currentPlayingItem = null;
    this.browseEpgMode = 'all';
    this._lastExtendedEpgSig = '';
    this.updatePlayPauseUi(false);
    this.dom.playerCenterHit?.classList.add('hidden');
    this.dom.playerCenterHit?.classList.remove('is-paused');
    this.dom.playerIdleOverlay?.classList.remove('hidden');
    if (this.dom.currentChannelName) this.dom.currentChannelName.textContent = i18n.get('appName');
    if (this.dom.currentChannelGroup) this.dom.currentChannelGroup.textContent = '';
    if (this.dom.currentChannelLogo) this.dom.currentChannelLogo.classList.add('hidden');
    if (this.dom.currentProgramTitle) this.dom.currentProgramTitle.textContent = i18n.get('noEpgAvailable');
    if (this.dom.currentProgramTime) { this.dom.currentProgramTime.textContent = ''; this.dom.currentProgramTime.classList.add('hidden'); }
    if (this.dom.currentProgramRemaining) this.dom.currentProgramRemaining.textContent = '';
    if (this.dom.currentProgramProgress) this.dom.currentProgramProgress.style.width = '0%';
    if (this.dom.progressThumb) this.dom.progressThumb.style.left = '0%';
    document.querySelectorAll('.sidebar-item-row.playing').forEach(r => r.classList.remove('playing'));
    this.updateCurrentEpgDisplay();
  }

  closePlayerAndReset() {
    this.stopPlayback();
  }

  navigateChannel(delta) {
    const liveItems = (this.currentFilteredItems.length > 0 ? this.currentFilteredItems : this.playlist.items).filter(x => x.type === ItemType.LIVE);
    if (liveItems.length === 0) return;
    let nextIndex = 0;
    if (this.currentPlayingItem) {
      const curIdx = liveItems.findIndex(x => x.id === this.currentPlayingItem.id);
      if (curIdx !== -1) nextIndex = (curIdx + delta + liveItems.length) % liveItems.length;
    }
    this.playChannel(liveItems[nextIndex]);
  }

  seekRelative(secondsDelta) {
    if (!this.player) return;
    const cur = this.dom.video?.currentTime || 0;
    const dur = this.currentDuration || this.dom.video?.duration || 0;
    if (dur > 0) {
      const targetSec = Math.max(0, Math.min(dur, cur + secondsDelta));
      this.player.seek(targetSec / dur, targetSec);
    }
  }

  handlePlayerState(state, details = null) {
    if (!this.dom.playerLoadingOverlay || !this.dom.playerErrorOverlay) return;
    const hideCorsErrorHint = () => {
      if (this.dom.playerErrorHint) { this.dom.playerErrorHint.textContent = ''; this.dom.playerErrorHint.classList.add('hidden'); }
      this.dom.btnPlayerOpenSettings?.classList.add('hidden');
    };

    switch (state) {
      case 'loading':
      case 'buffering':
        this.dom.playerLoadingOverlay.classList.remove('hidden');
        this.dom.playerErrorOverlay.classList.add('hidden');
        hideCorsErrorHint();
        if (this.dom.playerLoadingText) {
          this.dom.playerLoadingText.textContent = state === 'buffering' ? 'Buffering...' : i18n.get('playerLoading');
        }
        break;
      case 'playing':
        this.dom.playerLoadingOverlay.classList.add('hidden');
        this.dom.playerErrorOverlay.classList.add('hidden');
        hideCorsErrorHint();
        this.updatePlayPauseUi(true);
        break;
      case 'paused':
      case 'idle':
      case 'ready':
        this.dom.playerLoadingOverlay.classList.add('hidden');
        this.dom.playerErrorOverlay.classList.add('hidden');
        hideCorsErrorHint();
        this.updatePlayPauseUi(false);
        break;
      case 'error':
        this.dom.playerLoadingOverlay.classList.add('hidden');
        this.dom.playerErrorOverlay.classList.remove('hidden');
        this.updatePlayPauseUi(false);
        const detailStr = details?.details || details?.type || '';
        if (this.dom.playerErrorMsg) this.dom.playerErrorMsg.textContent = `${i18n.get('playerErrorPlayback')} ${detailStr}`;
        this.addAppNotification('error', i18n.get('playerErrorPlayback'), `${this.currentPlayingItem?.name || ''} ${detailStr}`.trim());
        if (!this.isNativeApp() && details?.isCorsOrMixedContent) {
          if (this.dom.playerErrorHint) {
            this.dom.playerErrorHint.textContent = i18n.get('playerErrorCorsHint');
            this.dom.playerErrorHint.classList.remove('hidden');
          }
          this.dom.btnPlayerOpenSettings?.classList.remove('hidden');
        } else {
          hideCorsErrorHint();
        }
        break;
    }
  }

  updatePlayPauseUi(isPlaying) {
    if (!this.dom.iconPlayerPause || !this.dom.iconPlayerPlay) return;
    this.dom.iconPlayerPlay.classList.toggle('hidden', isPlaying);
    this.dom.iconPlayerPause.classList.toggle('hidden', !isPlaying);
    if (this.dom.iconCenterPlay && this.dom.iconCenterPause) {
      this.dom.iconCenterPlay.classList.toggle('hidden', isPlaying);
      this.dom.iconCenterPause.classList.toggle('hidden', !isPlaying);
    }
    this.dom.playerCenterHit?.classList.toggle('is-paused', Boolean(this.currentPlayingItem) && !isPlaying);
  }

  updateTimelineDisplay(currentTime, duration, position, isSeekable) {
    const isVod = Boolean(this.currentPlayingItem && this.currentPlayingItem.type !== ItemType.LIVE);
    const showDuration = isVod || (isSeekable && duration > 0);
    if (showDuration) {
      this.dom.playerTimelineRow?.classList.remove('hidden');
      if (this.dom.timeCurrent) { this.dom.timeCurrent.textContent = this.formatDuration(currentTime); this.dom.timeCurrent.classList.remove('hidden'); }
      if (this.dom.timeTotal) { this.dom.timeTotal.textContent = this.formatDuration(duration); this.dom.timeTotal.classList.remove('hidden'); }
      if (this.dom.currentProgramProgress) this.dom.currentProgramProgress.style.width = `${Math.min(100, Math.max(0, position * 100))}%`;
      if (this.dom.progressThumb) this.dom.progressThumb.style.left = `${Math.min(100, Math.max(0, position * 100))}%`;
      if (this.dom.currentProgramRemaining) this.dom.currentProgramRemaining.textContent = '';
    } else {
      this.dom.timeCurrent?.classList.add('hidden');
      this.dom.timeTotal?.classList.add('hidden');
      this.updateCurrentEpgDisplay();
    }
  }

  updateCurrentEpgDisplay() {
    const hasPlayingLive = Boolean(this.currentPlayingItem && this.currentPlayingItem.type === ItemType.LIVE);
    const shouldShowEpg = this.currentPlayingItem
      ? (this.currentPlayingItem.type === ItemType.LIVE)
      : (this.currentView === ItemType.LIVE);

    if (!shouldShowEpg) {
      // Filmes e Séries: não exibir nada de EPG abaixo do player
      this._lastExtendedEpgSig = '';
      if (!this.currentPlayingItem) this.dom.playerTimelineRow?.classList.add('hidden');
      this.dom.playerEpgCard?.classList.add('hidden');
      this.dom.browseEpgLoadMoreWrap?.classList.add('hidden');
      if (this.dom.playerEpgExtendedList) this.dom.playerEpgExtendedList.innerHTML = '';
      if (this.dom.playerEpgExtendedCount) this.dom.playerEpgExtendedCount.textContent = '';
      return;
    }

    this.dom.playerEpgCard?.classList.remove('hidden');

    const mode = (hasPlayingLive && this.browseEpgMode === 'channel') ? 'channel' : 'all';
    this.dom.btnEpgModeChannel?.classList.toggle('hidden', !hasPlayingLive);
    this.dom.btnEpgModeChannel?.classList.toggle('active', mode === 'channel');
    this.dom.btnEpgModeAll?.classList.toggle('active', mode === 'all');
    this.dom.inputBrowseEpgSearch?.classList.toggle('hidden', mode !== 'all');

    let prog = null;
    if (hasPlayingLive) {
      prog = this.epg.getCurrentProgram(this.currentPlayingItem.tvgId, this.currentPlayingItem.name);
      if (prog) {
        this.dom.playerTimelineRow?.classList.remove('hidden');
        this.dom.currentProgramTitle.textContent = prog.title;
        if (this.dom.currentProgramTime) {
          this.dom.currentProgramTime.textContent = `${prog.formattedStart} - ${prog.formattedStop}`;
          this.dom.currentProgramTime.classList.remove('hidden');
        }
        if (this.dom.currentProgramRemaining) this.dom.currentProgramRemaining.textContent = `${prog.remainingMinutes} min ${i18n.get('epgTimeRemaining')}`;
        if (this.dom.currentProgramProgress) this.dom.currentProgramProgress.style.width = `${prog.progress}%`;
        if (this.dom.progressThumb) this.dom.progressThumb.style.left = `${prog.progress}%`;
      } else {
        this.dom.playerTimelineRow?.classList.add('hidden');
        this.dom.currentProgramTitle.textContent = i18n.get('noEpgAvailable');
        this.dom.currentProgramTime?.classList.add('hidden');
        if (this.dom.currentProgramRemaining) this.dom.currentProgramRemaining.textContent = '';
        if (this.dom.currentProgramProgress) this.dom.currentProgramProgress.style.width = '0%';
        if (this.dom.progressThumb) this.dom.progressThumb.style.left = '0%';
      }
    } else {
      this.dom.playerTimelineRow?.classList.add('hidden');
      this.dom.currentProgramTime?.classList.add('hidden');
      if (this.dom.currentProgramRemaining) this.dom.currentProgramRemaining.textContent = '';
      if (this.dom.currentProgramProgress) this.dom.currentProgramProgress.style.width = '0%';
      if (this.dom.progressThumb) this.dom.progressThumb.style.left = '0%';
    }

    if (!this.dom.playerEpgExtendedList) return;

    if (mode === 'channel') {
      this.dom.browseEpgLoadMoreWrap?.classList.add('hidden');
      const allProgs = this.epg.getChannelPrograms(this.currentPlayingItem.tvgId, this.currentPlayingItem.name);
      const nowMs = Date.now();
      const schedule = allProgs.filter(p => p.stop.getTime() >= nowMs - 300000);
      const list = schedule.length > 0 ? schedule : allProgs;
      const sig = `ch|${this.currentPlayingItem.id}|${this.epg.timeshiftHours}|${prog?.title || ''}|${list.length}|${this.epg.channels.size}`;
      if (sig === this._lastExtendedEpgSig) return;
      this._lastExtendedEpgSig = sig;

      if (this.dom.playerEpgExtendedCount) {
        this.dom.playerEpgExtendedCount.textContent = list.length > 0 ? `${list.length}` : '';
      }

      if (list.length === 0) {
        this.dom.playerEpgExtendedList.innerHTML = `<p class="help-text">${this.escapeHtml(i18n.get('noEpgAvailable'))}</p>`;
      } else {
        this.dom.playerEpgExtendedList.innerHTML = list.map(p => {
          const isNow = nowMs >= p.start.getTime() && nowMs < p.stop.getTime();
          const startStr = this.epg.formatTime(p.start);
          const stopStr = this.epg.formatTime(p.stop);
          return `
            <div class="player-epg-extended-item ${isNow ? 'is-now' : ''}">
              <span class="epg-ext-time">${isNow ? `${this.escapeHtml(i18n.get('epgTimelineNow'))} • ` : ''}${startStr} - ${stopStr}</span>
              <div class="epg-ext-body">
                <div class="epg-ext-title">${this.escapeHtml(p.title)}</div>
                ${p.desc ? `<div class="epg-ext-desc">${this.escapeHtml(p.desc)}</div>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
      return;
    }

    const q = (this.dom.inputBrowseEpgSearch?.value || '').trim();
    const limit = Math.max(60, this.browseEpgAllLimit || 60);
    const minBucket = Math.floor(Date.now() / 60000);
    const ordered = this._collectLiveEpgRows(q, 12);
    const visible = ordered.slice(0, limit);
    const sig = `all|${hasPlayingLive ? this.currentPlayingItem.id : ''}|${this.epg.timeshiftHours}|${q}|${visible.length}|${ordered.length}|${this.epg.channels.size}|${minBucket}`;
    if (sig === this._lastExtendedEpgSig) return;
    this._lastExtendedEpgSig = sig;

    if (this.dom.playerEpgExtendedCount) {
      this.dom.playerEpgExtendedCount.textContent = ordered.length > 0
        ? i18n.get('epgChannelsFound', { count: `${visible.length}/${ordered.length}` })
        : '';
    }

    if (visible.length === 0) {
      this.dom.playerEpgExtendedList.innerHTML = `<p class="help-text">${this.escapeHtml(i18n.get('epgNoData'))}</p>`;
      this.dom.browseEpgLoadMoreWrap?.classList.add('hidden');
      return;
    }

    this.dom.playerEpgExtendedList.innerHTML = this._buildLiveEpgChannelRowsHtml(
      visible,
      'data-browse-epg-play-id',
      hasPlayingLive ? this.currentPlayingItem.id : null
    );

    if (this.dom.browseEpgLoadMoreWrap && this.dom.btnBrowseEpgLoadMore) {
      const hasMore = visible.length < ordered.length;
      this.dom.browseEpgLoadMoreWrap.classList.toggle('hidden', !hasMore);
      if (hasMore) {
        this.dom.btnBrowseEpgLoadMore.textContent = i18n.get('btnLoadMore', { shown: visible.length, total: ordered.length });
      }
    }
  }

  updateTrackSelectors({ audioTracks, subtitleTracks, currentAudioTrack, currentSubtitleTrack }) {
    if (this.dom.selectPlayerAudio) {
      const sel = this.dom.selectPlayerAudio;
      sel.innerHTML = `<option value="-1">${this.escapeHtml(i18n.get('playerAudioDefault'))}</option>`;
      (audioTracks || []).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name ? `Áudio: ${t.name}` : `Faixa ${t.id}`;
        if (t.id === currentAudioTrack) opt.selected = true;
        sel.appendChild(opt);
      });
    }
    if (this.dom.selectPlayerSubtitles) {
      const sel = this.dom.selectPlayerSubtitles;
      sel.innerHTML = `<option value="-1">${this.escapeHtml(i18n.get('playerSubtitlesNone'))}</option>`;
      (subtitleTracks || []).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name ? `Legenda: ${t.name}` : `Legenda ${t.id}`;
        if (t.id === currentSubtitleTrack) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  }

  async checkAppUpdates(isManual = false) {
    if (isManual && this.dom.settingsUpdateStatus) {
      this.dom.settingsUpdateStatus.textContent = i18n.get('updateChecking');
    }
    const info = await UpdateChecker.checkForUpdates();
    const hasUpdate = Boolean(info?.available || info?.hasUpdate);
    if (hasUpdate) {
      const notifTitle = i18n.get('updateNotificationTitle');
      const notifBody = i18n.get('updateNotificationBody', { latest: info.latestVersion, current: info.currentVersion });
      this.addUpdateNotification(info);

      if (window.androidBridge?.notifyUpdateAvailable && info.apkDownloadUrl) {
        try {
          window.androidBridge.notifyUpdateAvailable(
            info.latestVersion, notifTitle, notifBody, info.releaseNotes || '',
            info.apkDownloadUrl, info.apkAssetName || '', info.sha256SumsUrl || '', info.releaseUrl || ''
          );
        } catch {}
      }

      if (isManual && this.dom.settingsUpdateStatus) {
        this.dom.settingsUpdateStatus.innerHTML = `
          <span>${this.escapeHtml(notifBody)}</span>
          <button type="button" class="btn-amber" id="btn-inline-settings-update" style="margin-left:0.5rem; font-size:0.74rem; padding:0.25rem 0.6rem;">${this.escapeHtml(i18n.get('btnUpdateNow'))}</button>
        `;
        document.getElementById('btn-inline-settings-update')?.addEventListener('click', () => this.triggerAppUpdate(info));
      }
    } else if (isManual && this.dom.settingsUpdateStatus) {
      this.dom.settingsUpdateStatus.textContent = i18n.get('updateUpToDate');
    }
  }

  async detectLocalProxy() {
    if (this.isNativeApp()) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch('http://127.0.0.1:8787/health', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          if (this.dom.localProxyDetectStatus) {
            this.dom.localProxyDetectStatus.innerHTML = `<span style="color: var(--accent-green); font-weight: 600;">${this.escapeHtml(i18n.get('localBridgeActive'))}</span>`;
          }
          const cfg = storage.getSettings();
          if (!cfg.corsProxy) {
            cfg.corsProxy = 'http://127.0.0.1:8787/?';
            storage.saveSettings(cfg);
            if (this.dom.corsInput) this.dom.corsInput.value = cfg.corsProxy;
          }
        }
      }
    } catch {}
  }

  formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00:00';
    const total = Math.floor(seconds);
    return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
}

function startFluiStream() {
  if (!window.fluiStreamApp) {
    window.fluiStreamApp = new FluiStreamApp();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFluiStream);
  } else {
    startFluiStream();
  }
}
