/**
 * FluiStream — Video Player Controller
 * Gerencia reprodução HLS / MP4 / MKV, aspect ratio, PiP, fullscreen e atalhos
 */

import { applyCorsProxy } from './network.js';

export const BLOCKING_VIDEO_OVERLAY_SELECTOR = [
  '.modal-backdrop:not(.hidden)',
  '.modal:not(.hidden)',
  '.dialog-overlay:not(.hidden)',
  '[data-modal-open="true"]',
  '#split-sidebar.open-mobile',
  '#sidebar-backdrop:not(.hidden)'
].join(', ');

/**
 * Calcula retângulo e visibilidade de um stage de vídeo mantendo-o fixado ao fundo,
 * ocultando overlays nativos quando cobertos por modais, drawer de categorias ou cabeçalho fixo,
 * exceto em Picture-in-Picture ou tela cheia.
 */
export function computeOverlayLayout(stageEl, minDim = 1) {
  if (!stageEl || typeof document === 'undefined' || typeof window === 'undefined') {
    return { x: 0, y: 0, width: 0, height: 0, visible: false };
  }
  const isFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const isPip = Boolean(document.body?.classList?.contains('desktop-mini-pip') || document.pictureInPictureElement);
  const hasBlockingOverlay = !isFullscreen && !isPip && Boolean(
    document.querySelector(BLOCKING_VIDEO_OVERLAY_SELECTOR)
  );
  const inHiddenAncestor = typeof stageEl.closest === 'function' && Boolean(stageEl.closest('.hidden'));
  const rect = stageEl.getBoundingClientRect();
  let underStickyHeader = false;
  if (!isFullscreen && !isPip) {
    const header = document.getElementById('app-header');
    if (header && typeof window.getComputedStyle === 'function') {
      const pos = window.getComputedStyle(header).position;
      if (pos === 'sticky' || pos === 'fixed') {
        const headerRect = header.getBoundingClientRect();
        if (headerRect.height > 0 && rect.top < headerRect.bottom - 2) {
          underStickyHeader = true;
        }
      }
    }
  }
  const dpr = window.devicePixelRatio || 1;
  const minThreshold = minDim > 1 ? minDim : 0;
  const visible = !hasBlockingOverlay
    && !inHiddenAncestor
    && !underStickyHeader
    && rect.width > minThreshold
    && rect.height > minThreshold
    && rect.bottom > 20
    && rect.top < window.innerHeight;
  return {
    x: Math.round(rect.left * dpr),
    y: Math.round(rect.top * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
    visible
  };
}

export class VideoPlayerController {
  constructor(videoElement, containerElement) {
    this.video = videoElement;
    this.container = containerElement;
    this.hls = null;
    this.mpegtsPlayer = null;
    this.currentItem = null;
    this.aspectRatio = 'auto'; // 'auto' | '16:9' | '4:3' | 'fill'
    this.onChannelChange = null; // callback para trocar canal
    this.onStateChange = null; // callback para loading / playing / error
    this.onTimeUpdate = null; // callback para progresso e tempo do vídeo
    this.onTracksUpdated = null; // callback para faixas de áudio e legendas
    this.audioTracks = [];
    this.subtitleTracks = [];
    this.currentAudioTrack = -1;
    this.currentSubtitleTrack = -1;
    this.isStopped = true;
    this._inNativeFullscreen = false;
    this._resumeAfterFullscreen = false;
    this._fullscreenResumeTimer = null;

    this.initEvents();
  }

  initEvents() {
    if (!this.video) return;
    this.video.playsInline = true;
    this.video.setAttribute?.('playsinline', '');
    this.video.setAttribute?.('webkit-playsinline', '');

    // Eventos de estado de carregamento e buffer
    this.video.addEventListener('loadstart', () => { if (!this.isStopped) this.notifyState('loading'); });
    this.video.addEventListener('waiting', () => { if (!this.isStopped) this.notifyState('buffering'); });
    this.video.addEventListener('playing', () => {
      if (this._inNativeFullscreen) this._resumeAfterFullscreen = true;
      if (!this.isStopped) this.notifyState('playing');
    });
    this.video.addEventListener('pause', () => { if (!this.isStopped) this.notifyState('paused'); });
    this.video.addEventListener('canplay', () => { if (!this.isStopped) this.notifyState('ready'); });
    this.video.addEventListener('timeupdate', () => {
      if (this.currentEngine === 'hls' && this.onTimeUpdate && !this.isStopped) {
        const cur = this.video.currentTime || 0;
        const dur = isFinite(this.video.duration) ? this.video.duration : 0;
        const pos = dur > 0 ? (cur / dur) : 0;
        this.onTimeUpdate({ currentTime: cur, duration: dur, position: pos, isSeekable: dur > 0 });
      }
    });
    this.video.addEventListener('error', (e) => {
      if (this.isStopped || !this.currentItem) return; // Não reportar erro se usuário clicou em Parar ou Fechar
      const code = this.video.error ? this.video.error.code : 'UNKNOWN';
      const msg = this.video.error ? this.video.error.message : '';
      this.notifyState('error', { type: 'HTML5_VIDEO_ERROR', code, message: msg });
    });

    // Persistência de volume
    this.video.addEventListener('volumechange', () => {
      try {
        localStorage.setItem('fluistream_volume', this.video.volume);
        localStorage.setItem('fluistream_muted', this.video.muted);
      } catch {
        // Ignore
      }
    });

    // Restaurar volume prévio
    try {
      const savedVol = localStorage.getItem('fluistream_volume');
      if (savedVol !== null) this.video.volume = parseFloat(savedVol);
      const savedMuted = localStorage.getItem('fluistream_muted');
      if (savedMuted === 'true') this.video.muted = true;
    } catch {
      // Ignore
    }

    // Duplo clique para alternar tela cheia
    this.video.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });

    // iOS Safari pausa o <video> e pode deixar o frame preto ao sair do fullscreen nativo (webkitendfullscreen)
    this.video.addEventListener('webkitbeginfullscreen', () => {
      this._inNativeFullscreen = true;
      this._resumeAfterFullscreen = !this.video.paused && !this.isStopped;
    });
    this.video.addEventListener('webkitendfullscreen', () => {
      this._inNativeFullscreen = false;
      this._resumePlaybackAfterFullscreenExit();
    });

    if (typeof document !== 'undefined') {
      const onFullscreenChange = () => {
        const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
        if (isFs) {
          this._resumeAfterFullscreen = !this.video.paused && !this.isStopped;
        } else {
          this._resumePlaybackAfterFullscreenExit();
          this.reportLayout();
        }
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    }

    // Observar redimensionamento e scroll para sincronizar layout nativo do VLC
    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.containerObserver = new ResizeObserver(() => {
        this.reportLayout();
      });
      this.containerObserver.observe(this.container);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.reportLayout());
      window.addEventListener('scroll', () => this.reportLayout(), { passive: true });
    }
  }

  reportLayout() {
    if (this.currentEngine !== 'vlc' || typeof window === 'undefined' || !window.chrome?.webview || !this.container) return;
    const layout = computeOverlayLayout(this.container, 1);
    const isVisible = !this.isStopped && layout.visible;

    this.notifyNativeVlc('VLC_LAYOUT_UPDATE', {
      rect: {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        visible: isVisible
      }
    });
    this.notifyNativeVlc('SET_VISIBILITY', { visible: isVisible });
  }

  setOverlayVisible(visible) {
    if (this.currentEngine !== 'vlc') return;
    const allowVisible = Boolean(visible) && !this.isStopped && computeOverlayLayout(this.container, 1).visible;
    this.notifyNativeVlc('SET_VISIBILITY', { visible: allowVisible });
  }

  handleVlcTime(curSec, durSec, pos, isSeekable) {
    if (this.currentEngine === 'vlc' && this.onTimeUpdate && !this.isStopped) {
      this.onTimeUpdate({ currentTime: curSec, duration: durSec, position: pos, isSeekable: Boolean(isSeekable) });
    }
  }

  seek(positionPct, targetSeconds = null) {
    const clampedPct = Math.max(0, Math.min(1, positionPct));
    if (this.currentEngine === 'vlc') {
      this.notifyNativeVlc('SEEK', { position: clampedPct, time: targetSeconds });
    } else if (this.video) {
      if (targetSeconds !== null && isFinite(targetSeconds)) {
        this.video.currentTime = targetSeconds;
      } else if (isFinite(this.video.duration) && this.video.duration > 0) {
        this.video.currentTime = clampedPct * this.video.duration;
      }
    }
  }

  notifyState(state, details = null) {
    if (this.onStateChange) {
      this.onStateChange(state, details);
    }
  }

  /**
   * Converte URLs Xtream / live de acordo com o modo de transmissão selecionado:
   * - 'auto': Converte para HLS .m3u8 se for live Xtream (recomendado para web)
   * - 'hls': Força formato .m3u8
   * - 'ts': Força formato .ts
   * - 'direct': Mantém URL bruta sem alteração
   */
  resolveStreamUrl(url, itemType, streamMode = 'auto') {
    if (!url || typeof url !== 'string') return url;
    if (streamMode === 'direct') return url;

    // Se já tiver extensão explícita de vídeo, não altera a não ser que peça TS/HLS em live
    if (url.includes('.mp4') || url.includes('.mkv') || url.includes('.avi')) {
      return url;
    }

    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      // Padrão Xtream: [user, pass, streamId] ou ['live', user, pass, streamId]
      const lastPart = pathParts[pathParts.length - 1] || '';
      const streamIdMatch = lastPart.match(/^(\d+)(?:\.(?:m3u8|ts))?$/);

      if (streamIdMatch && pathParts.length >= 3) {
        const streamId = streamIdMatch[1];
        const isAlreadyLivePrefixed = pathParts[0] === 'live';
        const cleanParts = isAlreadyLivePrefixed ? pathParts.slice(1, -1) : pathParts.slice(0, -1);

        if (streamMode === 'ts') {
          // Formato Xtream TS: /live/user/pass/id.ts
          parsed.pathname = `/live/${cleanParts.join('/')}/${streamId}.ts`;
          return parsed.toString();
        }

        if (streamMode === 'hls' || (streamMode === 'auto' && itemType === 'live')) {
          // Formato Xtream HLS: /live/user/pass/id.m3u8
          parsed.pathname = `/live/${cleanParts.join('/')}/${streamId}.m3u8`;
          return parsed.toString();
        }
      }
    } catch {
      // Ignora erro de URL
    }

    return url;
  }

  /**
   * Constrói lista ordenada e deduplicada de URLs candidatas para fallback automático (.m3u8 <-> .ts <-> original).
   */
  buildStreamCandidates(url, itemType, streamMode = 'auto') {
    if (!url || typeof url !== 'string') return [];
    const primary = this.resolveStreamUrl(url, itemType, streamMode);
    const list = [primary];

    const isVodFile = url.includes('.mp4') || url.includes('.mkv') || url.includes('.avi') || url.includes('.webm');
    if (streamMode !== 'direct' && !isVodFile) {
      const m3u8Url = this.resolveStreamUrl(url, 'live', 'hls');
      const tsUrl = this.resolveStreamUrl(url, 'live', 'ts');
      const extras = streamMode === 'ts' ? [url, m3u8Url] : [tsUrl, url, m3u8Url];
      for (const cand of extras) {
        if (cand && !list.includes(cand)) list.push(cand);
      }
    } else if (!list.includes(url)) {
      list.push(url);
    }

    return list;
  }

  /**
   * Notifica host nativo (WebView2 C#) sobre reprodução VLC se disponível
   */
  notifyNativeVlc(action, data = {}) {
    if (typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
      if (action === 'VLC_LAYOUT_UPDATE') {
        window.chrome.webview.postMessage({
          type: 'VLC_LAYOUT_UPDATE',
          ...data
        });
      } else {
        window.chrome.webview.postMessage({
          type: 'VLC_PLAYER_COMMAND',
          action,
          ...data
        });
      }
      return true;
    }
    return false;
  }

  /**
   * Carrega e reproduz uma URL de mídia
   */
  async playStream(item, corsProxy = '', streamMode = 'auto', playerEngine = 'hls') {
    if (!item || !item.url) return;
    this.isStopped = false;
    this.currentItem = item;
    this.currentStreamMode = streamMode;
    this.currentEngine = playerEngine;
    this.notifyState('loading');

    const candidates = this.buildStreamCandidates(item.url, item.type, streamMode);
    const streamUrl = candidates[0] || item.url;

    // Ponte Nativa Android (ExoPlayer / Media3 via @JavascriptInterface window.androidBridge)
    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    if (isAndroidApp) {
      this._destroyHtml5Engines();
      if (this.video) {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this.video.style.display = 'none';
      }
      window.androidBridge.playStream(streamUrl, item.name || '', item.type || 'live', streamMode || 'auto');
      this.updateMediaSession(item);
      this.notifyState('playing');
      return;
    }

    // Se motor for VLC e estiver rodando no app Desktop
    const isDesktopApp = typeof window !== 'undefined' && Boolean(window.chrome?.webview);
    if (playerEngine === 'vlc' && isDesktopApp) {
      this._destroyHtml5Engines();
      if (this.video) {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this.video.style.display = 'none';
      }

      // Delegar ao LibVLC em C# (inclui URLs fallback caso .m3u8 dê 404)
      this.notifyNativeVlc('PLAY', {
        url: streamUrl,
        fallbackUrls: candidates.slice(1),
        title: item.name || '',
        itemType: item.type,
        aspectRatio: this.aspectRatio || 'auto'
      });

      this.updateMediaSession(item);
      requestAnimationFrame(() => this.reportLayout());
      setTimeout(() => this.reportLayout(), 150);
      setTimeout(() => this.notifyNativeVlc('GET_TRACKS'), 1200);
      return;
    }

    if (this.video) {
      this.video.style.display = 'block';
    }
    if (isDesktopApp) {
      // Se estiver no Desktop mas escolheu HLS, desativa overlay do VLC e exibe vídeo HTML5
      this.notifyNativeVlc('STOP');
    }

    const finalUrl = corsProxy ? applyCorsProxy(corsProxy, streamUrl) : streamUrl;

    // Limpar instâncias HTML5 anteriores
    this._destroyHtml5Engines();

    const isVideoFile = finalUrl.includes('.mp4') || finalUrl.includes('.mkv') || finalUrl.includes('.avi') || finalUrl.includes('.webm') || item.type === 'movie' || item.type === 'series';
    const isTsStream = !isVideoFile && (streamMode === 'ts' || /\.ts(?:[?#]|$)/i.test(streamUrl));
    const isHlsStream = !isVideoFile && !isTsStream && (streamMode === 'hls' || finalUrl.includes('.m3u8') || (streamMode === 'auto' && (item.type === 'live' || finalUrl.includes('/live/'))));

    // 1. Suporte a HLS via Hls.js
    if (isHlsStream && typeof window !== 'undefined' && window.Hls && window.Hls.isSupported()) {
      this.hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 2,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 2,
        fragLoadingTimeOut: 12000,
        fragLoadingMaxRetry: 2
      });

      this.hls.loadSource(finalUrl);
      this.hls.attachMedia(this.video);

      this.hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {
        this.extractHlsAudioTracks(data.audioTracks || this.hls.audioTracks);
      });

      this.hls.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, (event, data) => {
        this.currentAudioTrack = data.id;
        this.notifyTracks();
      });

      this.hls.on(window.Hls.Events.SUBTITLE_TRACKS_UPDATED, (event, data) => {
        this.extractHlsSubtitleTracks(data.subtitleTracks || this.hls.subtitleTracks);
      });

      this.hls.on(window.Hls.Events.SUBTITLE_TRACK_SWITCH, (event, data) => {
        this.currentSubtitleTrack = data.id;
        this.notifyTracks();
      });

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (this.hls.audioTracks && this.hls.audioTracks.length > 0) {
          this.extractHlsAudioTracks(this.hls.audioTracks);
        }
        if (this.hls.subtitleTracks && this.hls.subtitleTracks.length > 0) {
          this.extractHlsSubtitleTracks(this.hls.subtitleTracks);
        }
        this.video.play().catch(e => {
          console.warn('Autoplay blocked:', e);
          this.notifyState('ready');
        });
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS Network error, attempting recovery...');
              if (data.details === 'manifestLoadError' || data.details === 'manifestLoadTimeOut') {
                const isWeb = typeof window !== 'undefined' && !window.chrome?.webview && !window.androidBridge;
                this.notifyState('error', {
                  type: 'NETWORK_ERROR',
                  details: data.details,
                  isCorsOrMixedContent: isWeb
                });
                this.hls.destroy();
              } else {
                this.hls.startLoad();
              }
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media error, attempting recovery...');
              this.hls.recoverMediaError();
              break;
            default:
              console.error('HLS Fatal error:', data);
              this.notifyState('error', { type: 'FATAL_ERROR', details: data.details });
              this.hls.destroy();
              break;
          }
        }
      });
    } else if (isTsStream && typeof window !== 'undefined' && window.mpegts?.isSupported()) {
      // 2. Suporte MPEG-TS (.ts) via mpegts.js MSE
      this.mpegtsPlayer = window.mpegts.createPlayer(
        { type: 'mpegts', isLive: item.type === 'live', url: finalUrl },
        { enableWorker: false, enableStashBuffer: true, liveBufferLatencyChasing: false }
      );
      this.mpegtsPlayer.attachMediaElement(this.video);
      this.mpegtsPlayer.load();
      this.mpegtsPlayer.play().catch(e => {
        console.warn('MPEG-TS autoplay blocked:', e);
        this.notifyState('ready');
      });
      this.mpegtsPlayer.on(window.mpegts.Events.ERROR, (errType, errDetail) => {
        console.error('MPEG-TS error:', errType, errDetail);
        this.notifyState('error', { type: 'MPEGTS_ERROR', details: String(errDetail || errType) });
      });
    } else {
      // 3. Reprodução nativa (Safari HLS nativo, MP4, WebM)
      this.video.src = finalUrl;
      this.video.load();
      this.video.addEventListener('loadedmetadata', () => {
        this.extractNativeTracks();
      }, { once: true });
      this.video.play().catch(e => {
        console.warn('Autoplay blocked:', e);
        this.notifyState('ready');
      });
    }

    // Media Session API para SO (Windows, Android, macOS)
    this.updateMediaSession(item);
  }

  updateMediaSession(item) {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined' && item) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.name || 'FluiStream',
        artist: item.group || (item.type === 'live' ? 'Canal Ao Vivo' : 'FluiStream VOD'),
        album: item.seriesTitle || 'FluiStream Player',
        artwork: item.logo ? [{ src: item.logo, sizes: '512x512', type: 'image/png' }] : []
      });

      navigator.mediaSession.setActionHandler('play', () => this.video.play());
      navigator.mediaSession.setActionHandler('pause', () => this.video.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (this.onChannelChange) this.onChannelChange(-1);
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (this.onChannelChange) this.onChannelChange(1);
      });
    }
  }

  setAspectRatio(ratio) {
    this.aspectRatio = ratio;

    if (this.container) {
      this.container.classList.remove('aspect-auto', 'aspect-16-9', 'aspect-4-3', 'aspect-fill');
      if (ratio === '16:9') this.container.classList.add('aspect-16-9');
      else if (ratio === '4:3') this.container.classList.add('aspect-4-3');
      else if (ratio === 'fill') this.container.classList.add('aspect-fill');
      else this.container.classList.add('aspect-auto');
    }

    if (this.video) {
      this.video.classList.remove('aspect-auto', 'aspect-16-9', 'aspect-4-3', 'aspect-fill');

      switch (ratio) {
        case '16:9':
          this.video.classList.add('aspect-16-9');
          this.video.style.objectFit = 'contain';
          break;
        case '4:3':
          this.video.classList.add('aspect-4-3');
          this.video.style.objectFit = 'contain';
          break;
        case 'fill':
          this.video.classList.add('aspect-fill');
          this.video.style.objectFit = 'fill';
          break;
        case 'auto':
        default:
          this.video.classList.add('aspect-auto');
          this.video.style.objectFit = 'contain';
          break;
      }
    }

    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    if (isAndroidApp) {
      window.androidBridge?.setAspectRatio?.(ratio);
    }

    if (this.currentEngine === 'vlc') {
      this.notifyNativeVlc('SET_ASPECT_RATIO', { ratio });
      requestAnimationFrame(() => this.reportLayout());
    }
  }

  extractHlsAudioTracks(tracks) {
    if (!tracks) return;
    this.audioTracks = tracks.map((t, idx) => ({
      id: t.id !== undefined ? t.id : idx,
      name: t.name || t.lang || `Faixa ${idx + 1}`,
      lang: t.lang || ''
    }));
    this.currentAudioTrack = this.hls ? this.hls.audioTrack : -1;
    this.notifyTracks();
  }

  extractHlsSubtitleTracks(tracks) {
    if (!tracks) return;
    this.subtitleTracks = tracks.map((t, idx) => ({
      id: t.id !== undefined ? t.id : idx,
      name: t.name || t.lang || `Legenda ${idx + 1}`,
      lang: t.lang || ''
    }));
    this.currentSubtitleTrack = this.hls ? this.hls.subtitleTrack : -1;
    this.notifyTracks();
  }

  extractNativeTracks() {
    this.audioTracks = [];
    this.subtitleTracks = [];
    if (this.video && this.video.textTracks) {
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i];
        this.subtitleTracks.push({
          id: i,
          name: t.label || t.language || `Legenda ${i + 1}`,
          lang: t.language || ''
        });
        if (t.mode === 'showing') {
          this.currentSubtitleTrack = i;
        }
      }
    }
    this.notifyTracks();
  }

  notifyTracks() {
    if (this.onTracksUpdated) {
      this.onTracksUpdated({
        audioTracks: this.audioTracks,
        subtitleTracks: this.subtitleTracks,
        currentAudioTrack: this.currentAudioTrack,
        currentSubtitleTrack: this.currentSubtitleTrack
      });
    }
  }

  setAudioTrack(trackId) {
    this.currentAudioTrack = trackId;
    if (this.currentEngine === 'vlc') {
      this.notifyNativeVlc('SET_AUDIO_TRACK', { trackId });
    } else if (this.hls) {
      this.hls.audioTrack = trackId;
    }
  }

  setSubtitleTrack(trackId) {
    this.currentSubtitleTrack = trackId;
    if (this.currentEngine === 'vlc') {
      this.notifyNativeVlc('SET_SUBTITLE_TRACK', { trackId });
    } else if (this.hls) {
      this.hls.subtitleTrack = trackId;
    } else if (this.video && this.video.textTracks) {
      for (let i = 0; i < this.video.textTracks.length; i++) {
        this.video.textTracks[i].mode = (i === trackId) ? 'showing' : 'disabled';
      }
    }
  }

  async togglePip() {
    if (this.currentEngine === 'vlc' && typeof window !== 'undefined' && window.chrome?.webview) {
      this.notifyNativeVlc('TOGGLE_PIP');
      return;
    }

    if (!this.video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled || this.video.requestPictureInPicture) {
        await this.video.requestPictureInPicture();
      } else if (typeof window !== 'undefined' && window.chrome?.webview) {
        this.notifyNativeVlc('TOGGLE_PIP');
      }
    } catch (err) {
      console.warn('PiP error, attempting native fallback:', err);
      if (typeof window !== 'undefined' && window.chrome?.webview) {
        this.notifyNativeVlc('TOGGLE_PIP');
      }
    }
  }

  _resumePlaybackAfterFullscreenExit() {
    if (!this.video || this.isStopped || !this.currentItem || !this._resumeAfterFullscreen) return;
    this._resumeAfterFullscreen = false;

    const tryResume = () => {
      if (!this.video || this.isStopped || !this.currentItem) return;
      if (this.hls && this.video.readyState < 2) {
        try { this.hls.startLoad(); } catch { /* ignore */ }
      }
      if (this.video.paused) {
        this.video.play().catch(() => {});
      }
    };

    tryResume();
    clearTimeout(this._fullscreenResumeTimer);
    // iOS WebKit pode concluir a transição do AVPlayerViewController alguns ms após webkitendfullscreen
    this._fullscreenResumeTimer = setTimeout(tryResume, 120);
  }

  async toggleFullscreen() {
    if (this.currentEngine === 'vlc' && typeof window !== 'undefined' && window.chrome?.webview) {
      this.notifyNativeVlc('TOGGLE_FULLSCREEN');
      return;
    }

    const target = this.container || this.video;
    if (!target) return;

    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (target.requestFullscreen) {
          await target.requestFullscreen();
        } else if (target.webkitRequestFullscreen) {
          await target.webkitRequestFullscreen();
        } else if (this.video && this.video.webkitEnterFullscreen) {
          this.video.webkitEnterFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen error:', err);
      if (typeof window !== 'undefined' && window.chrome?.webview) {
        this.notifyNativeVlc('TOGGLE_FULLSCREEN');
      }
    }
  }

  togglePlay() {
    if (this.currentEngine === 'vlc' && typeof window !== 'undefined' && window.chrome?.webview) {
      this.notifyNativeVlc('TOGGLE_PAUSE');
      return;
    }
    if (!this.video) return;
    if (this.video.paused) {
      this.video.play().catch(() => {});
    } else {
      this.video.pause();
    }
  }

  toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    if (this.currentEngine === 'vlc') {
      this.notifyNativeVlc('SET_MUTE', { muted: this.video.muted });
    }
  }

  setVolume(vol) {
    if (!this.video) return;
    this.video.volume = Math.max(0, Math.min(1, vol));
    if (this.video.muted && this.video.volume > 0) {
      this.video.muted = false;
    }
    if (this.currentEngine === 'vlc') {
      this.notifyNativeVlc('SET_VOLUME', { volume: this.video.volume });
    }
  }

  _destroyHtml5Engines() {
    if (this.hls) {
      try { this.hls.destroy(); } catch {}
      this.hls = null;
    }
    if (this.mpegtsPlayer) {
      try {
        this.mpegtsPlayer.pause();
        this.mpegtsPlayer.unload();
        this.mpegtsPlayer.detachMediaElement();
        this.mpegtsPlayer.destroy();
      } catch {}
      this.mpegtsPlayer = null;
    }
  }

  stop() {
    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    this.isStopped = true;
    this.currentItem = null;
    this.audioTracks = [];
    this.subtitleTracks = [];
    this.currentAudioTrack = -1;
    this.currentSubtitleTrack = -1;
    this.notifyTracks();
    this._destroyHtml5Engines();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video.style.display = isAndroidApp ? 'none' : 'block';
    }
    if (isAndroidApp) {
      window.androidBridge?.stopStream?.();
    }
    this.notifyNativeVlc('STOP');
    this.notifyState('idle');
  }
}

/**
 * Multi-Screen Controller — até 4 slots simultâneos em Desktop LibVLC ou Web (HLS.js + mpegts.js + fallback automático).
 */
export class MultiScreenController {
  constructor() {
    this.slots = new Map(); // slotIdx -> slot state
    this.activeAudioSlot = 0;
    this.onSlotStateChange = null;
    this.urlHelper = new VideoPlayerController(null, null);
    if (typeof window !== 'undefined') {
      this._onViewportChange = () => this.reportLayout();
      window.addEventListener('resize', this._onViewportChange);
      window.addEventListener('scroll', this._onViewportChange, { passive: true });
    }
  }

  _notifySlotState(slotIndex, state, details = null) {
    if (this.onSlotStateChange) {
      this.onSlotStateChange(slotIndex, state, details);
    }
  }

  _destroySlotEngines(slot) {
    if (!slot) return;
    if (slot.hls) {
      try { slot.hls.destroy(); } catch {}
      slot.hls = null;
    }
    if (slot.mpegtsPlayer) {
      try {
        slot.mpegtsPlayer.pause();
        slot.mpegtsPlayer.unload();
        slot.mpegtsPlayer.detachMediaElement();
        slot.mpegtsPlayer.destroy();
      } catch {}
      slot.mpegtsPlayer = null;
    }
    if (slot.cleanupVideoListeners) {
      try { slot.cleanupVideoListeners(); } catch {}
      slot.cleanupVideoListeners = null;
    }
  }

  attachSlot(slotIndex, videoElement, item, corsProxy = '', streamMode = 'auto', playerEngine = 'hls', stageElement = null) {
    this.clearSlot(slotIndex);
    if (!videoElement || !item || !item.url) return;

    const candidates = this.urlHelper.buildStreamCandidates(item.url, item.type, streamMode);
    if (candidates.length === 0) return;

    const stage = stageElement || videoElement.parentElement;
    const isDesktopVlc = playerEngine === 'vlc' && typeof window !== 'undefined' && Boolean(window.chrome?.webview?.postMessage);
    const slot = {
      slotIndex,
      video: videoElement,
      stage,
      item,
      corsProxy,
      streamMode,
      engine: isDesktopVlc ? 'vlc' : 'html5',
      candidates,
      candidateIdx: 0,
      workerDisabledRetry: false,
      hls: null,
      mpegtsPlayer: null,
      ro: null,
      cleanupVideoListeners: null
    };

    if (typeof ResizeObserver !== 'undefined' && stage) {
      slot.ro = new ResizeObserver(() => this.reportLayout());
      slot.ro.observe(stage);
    }

    this.slots.set(slotIndex, slot);
    this._notifySlotState(slotIndex, 'loading');

    if (isDesktopVlc) {
      videoElement.style.display = 'none';
      this.reportLayout();
      window.chrome.webview.postMessage({
        type: 'VLC_PLAYER_COMMAND',
        action: 'MS_PLAY_SLOT',
        slotIndex,
        url: candidates[0],
        fallbackUrls: candidates.slice(1),
        muted: slotIndex !== this.activeAudioSlot
      });
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.reportLayout());
      }
      setTimeout(() => this.reportLayout(), 120);
      return;
    }

    videoElement.style.display = 'block';
    videoElement.muted = slotIndex !== this.activeAudioSlot;
    this._attachHtml5Candidate(slot);
  }

  _attachHtml5Candidate(slot) {
    if (!this.slots.has(slot.slotIndex)) return;
    this._destroySlotEngines(slot);

    const rawUrl = slot.candidates[slot.candidateIdx];
    if (!rawUrl) {
      this._notifySlotState(slot.slotIndex, 'error', { details: 'NO_VALID_STREAM' });
      return;
    }

    const finalUrl = slot.corsProxy ? applyCorsProxy(slot.corsProxy, rawUrl) : rawUrl;
    const videoEl = slot.video;
    const isVideoFile = /\.(mp4|mkv|avi|webm)(?:[?#]|$)/i.test(finalUrl) || slot.item.type === 'movie' || slot.item.type === 'series';
    const isExplicitTs = /\.ts(?:[?#]|$)/i.test(rawUrl) || (slot.streamMode === 'ts' && !rawUrl.includes('.m3u8'));
    const isHls = !isVideoFile && !isExplicitTs && (rawUrl.includes('.m3u8') || slot.streamMode === 'hls' || (slot.streamMode === 'auto' && (slot.item.type === 'live' || rawUrl.includes('/live/'))));

    const advanceOrFail = (reason) => {
      if (!this.slots.has(slot.slotIndex)) return;
      if (slot.candidateIdx + 1 < slot.candidates.length) {
        slot.candidateIdx += 1;
        this._attachHtml5Candidate(slot);
      } else {
        this._destroySlotEngines(slot);
        this._notifySlotState(slot.slotIndex, 'error', { details: reason || 'STREAM_FAILED' });
      }
    };

    const onPlaying = () => this._notifySlotState(slot.slotIndex, 'playing');
    const onWaiting = () => this._notifySlotState(slot.slotIndex, 'loading');
    const onVideoError = () => {
      const code = videoEl.error ? `MEDIA_ERR_${videoEl.error.code}` : 'VIDEO_ERROR';
      advanceOrFail(code);
    };

    videoEl.addEventListener('playing', onPlaying);
    videoEl.addEventListener('waiting', onWaiting);
    videoEl.addEventListener('error', onVideoError);
    slot.cleanupVideoListeners = () => {
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('waiting', onWaiting);
      videoEl.removeEventListener('error', onVideoError);
    };

    videoEl.muted = slot.slotIndex !== this.activeAudioSlot;

    if (isHls && typeof window !== 'undefined' && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: !slot.workerDisabledRetry,
        lowLatencyMode: true,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 1,
        fragLoadingTimeOut: 12000,
        fragLoadingMaxRetry: 1
      });
      slot.hls = hls;
      hls.loadSource(finalUrl);
      hls.attachMedia(videoEl);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data?.fatal || !this.slots.has(slot.slotIndex)) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !slot._mediaRecovered) {
          slot._mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }
        if (!slot.workerDisabledRetry && data.details && String(data.details).includes('worker')) {
          slot.workerDisabledRetry = true;
          this._attachHtml5Candidate(slot);
          return;
        }
        advanceOrFail(data.details || data.type);
      });
    } else if ((isExplicitTs || !isVideoFile) && typeof window !== 'undefined' && window.mpegts?.isSupported()) {
      const player = window.mpegts.createPlayer(
        { type: 'mpegts', isLive: slot.item.type === 'live', url: finalUrl },
        { enableWorker: false, enableStashBuffer: true, liveBufferLatencyChasing: false }
      );
      slot.mpegtsPlayer = player;
      player.attachMediaElement(videoEl);
      player.load();
      player.play().catch(() => {});
      player.on(window.mpegts.Events.ERROR, (errType, errDetail) => {
        advanceOrFail(String(errDetail || errType || 'MPEGTS_ERROR'));
      });
    } else {
      videoEl.src = finalUrl;
      videoEl.load();
      videoEl.play().catch(() => {});
    }
  }

  handleNativeSlotState(slotIndex, state, details = null) {
    if (!this.slots.has(slotIndex)) return;
    this._notifySlotState(slotIndex, state, details);
  }

  reportLayout() {
    if (typeof window === 'undefined' || !window.chrome?.webview?.postMessage) return;
    const rects = [];
    for (const [slotIndex, slot] of this.slots.entries()) {
      if (slot.engine !== 'vlc' || !slot.stage) continue;
      const layout = computeOverlayLayout(slot.stage, 10);
      rects.push({
        slotIndex,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        visible: layout.visible
      });
    }
    if (rects.length > 0) {
      window.chrome.webview.postMessage({
        type: 'MULTISCREEN_LAYOUT_UPDATE',
        slots: rects
      });
    }
  }

  setAudioSlot(slotIndex) {
    this.activeAudioSlot = slotIndex;
    let hasNativeVlc = false;
    for (const [idx, slot] of this.slots.entries()) {
      if (slot.video) {
        slot.video.muted = idx !== slotIndex;
      }
      if (slot.engine === 'vlc') hasNativeVlc = true;
    }
    if (hasNativeVlc && typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
      window.chrome.webview.postMessage({
        type: 'VLC_PLAYER_COMMAND',
        action: 'MS_SET_AUDIO_SLOT',
        slotIndex
      });
    }
  }

  clearSlot(slotIndex) {
    const slot = this.slots.get(slotIndex);
    if (!slot) return;
    this._destroySlotEngines(slot);
    if (slot.ro) {
      try { slot.ro.disconnect(); } catch {}
    }
    if (slot.video) {
      try {
        slot.video.pause();
        slot.video.removeAttribute('src');
        slot.video.load();
      } catch {}
    }
    if (slot.engine === 'vlc' && typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
      window.chrome.webview.postMessage({
        type: 'VLC_PLAYER_COMMAND',
        action: 'MS_CLEAR_SLOT',
        slotIndex
      });
    }
    this.slots.delete(slotIndex);
  }

  clearAll() {
    for (const idx of Array.from(this.slots.keys())) {
      this.clearSlot(idx);
    }
    if (typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
      window.chrome.webview.postMessage({
        type: 'VLC_PLAYER_COMMAND',
        action: 'MS_CLEAR_ALL'
      });
    }
  }
}


