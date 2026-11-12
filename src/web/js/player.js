/**
 * FluiStream — Video Player Controller
 * Gerencia reprodução HLS / MP4 / MKV, aspect ratio, PiP, fullscreen e atalhos
 */

import { applyCorsProxy } from './network.js';

export class VideoPlayerController {
  constructor(videoElement, containerElement) {
    this.video = videoElement;
    this.container = containerElement;
    this.hls = null;
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

    this.initEvents();
  }

  initEvents() {
    if (!this.video) return;

    // Eventos de estado de carregamento e buffer
    this.video.addEventListener('loadstart', () => { if (!this.isStopped) this.notifyState('loading'); });
    this.video.addEventListener('waiting', () => { if (!this.isStopped) this.notifyState('buffering'); });
    this.video.addEventListener('playing', () => { if (!this.isStopped) this.notifyState('playing'); });
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
    const hasOpenModal = Boolean(document.querySelector('.modal:not(.hidden), .dialog-overlay:not(.hidden), [data-modal-open="true"]'));
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const isVisible = !hasOpenModal && rect.width > 0 && rect.height > 0 && rect.bottom > 20 && rect.top < window.innerHeight;

    this.notifyNativeVlc('VLC_LAYOUT_UPDATE', {
      rect: {
        x: Math.round(rect.left * dpr),
        y: Math.round(rect.top * dpr),
        width: Math.round(rect.width * dpr),
        height: Math.round(rect.height * dpr),
        visible: isVisible
      }
    });
    this.notifyNativeVlc('SET_VISIBILITY', { visible: isVisible });
  }

  setOverlayVisible(visible) {
    if (this.currentEngine === 'vlc') {
      this.notifyNativeVlc('SET_VISIBILITY', { visible: Boolean(visible) });
    }
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

    const streamUrl = this.resolveStreamUrl(item.url, item.type, streamMode);

    // Ponte Nativa Android (ExoPlayer / Media3 via @JavascriptInterface window.androidBridge)
    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    if (isAndroidApp) {
      if (this.hls) {
        this.hls.destroy();
        this.hls = null;
      }
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
      // Limpar HLS e pausar e ocultar elemento HTML5 para não exibir controles vazios
      if (this.hls) {
        this.hls.destroy();
        this.hls = null;
      }
      if (this.video) {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this.video.style.display = 'none';
      }

      // Delegar ao LibVLC em C#
      this.notifyNativeVlc('PLAY', {
        url: streamUrl,
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

    // Limpar instância HLS anterior
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    const isVideoFile = finalUrl.includes('.mp4') || finalUrl.includes('.mkv') || finalUrl.includes('.avi') || finalUrl.includes('.webm') || item.type === 'movie' || item.type === 'series';
    const isHlsStream = !isVideoFile && (streamMode === 'hls' || finalUrl.includes('.m3u8') || (streamMode === 'auto' && (item.type === 'live' || finalUrl.includes('/live/'))));

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
    } else {
      // 2. Reprodução nativa (Safari HLS nativo, MP4, WebM)
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

  stop() {
    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    this.isStopped = true;
    this.currentItem = null;
    this.audioTracks = [];
    this.subtitleTracks = [];
    this.currentAudioTrack = -1;
    this.currentSubtitleTrack = -1;
    this.notifyTracks();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
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

