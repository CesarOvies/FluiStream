/**
 * FluiStream — Video Player Controller
 * Gerencia reprodução HLS / MP4 / MKV, aspect ratio, PiP, fullscreen e atalhos
 */

export class VideoPlayerController {
  constructor(videoElement, containerElement) {
    this.video = videoElement;
    this.container = containerElement;
    this.hls = null;
    this.currentItem = null;
    this.aspectRatio = 'auto'; // 'auto' | '16:9' | '4:3' | 'fill'
    this.onChannelChange = null; // callback para trocar canal

    this.initEvents();
  }

  initEvents() {
    if (!this.video) return;

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
  }

  /**
   * Carrega e reproduz uma URL de mídia
   */
  async playStream(item, corsProxy = '') {
    if (!item || !item.url) return;
    this.currentItem = item;

    let finalUrl = item.url;
    if (corsProxy && !finalUrl.startsWith('blob:') && !finalUrl.startsWith('data:')) {
      const proxy = corsProxy.endsWith('/') ? corsProxy : `${corsProxy}/`;
      finalUrl = `${proxy}${encodeURIComponent(finalUrl)}`;
    }

    // Limpar instância HLS anterior
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    const isHlsStream = finalUrl.includes('.m3u8') || item.type === 'live' || finalUrl.includes('/live/');

    // 1. Suporte a HLS via Hls.js
    if (isHlsStream && typeof window !== 'undefined' && window.Hls && window.Hls.isSupported()) {
      this.hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60
      });

      this.hls.loadSource(finalUrl);
      this.hls.attachMedia(this.video);

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.video.play().catch(e => console.log('Autoplay blocked:', e));
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS Network error, attempting recovery...');
              this.hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media error, attempting recovery...');
              this.hls.recoverMediaError();
              break;
            default:
              console.error('HLS Fatal error:', data);
              this.hls.destroy();
              break;
          }
        }
      });
    } else {
      // 2. Reprodução nativa (Safari HLS nativo, MP4, WebM)
      this.video.src = finalUrl;
      this.video.load();
      this.video.play().catch(e => console.log('Autoplay blocked:', e));
    }

    // Media Session API para SO (Windows, Android, macOS)
    this.updateMediaSession(item);
  }

  updateMediaSession(item) {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && item) {
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
    if (!this.video) return;

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

  async togglePip() {
    if (!this.video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && this.video.requestPictureInPicture) {
        await this.video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
  }

  async toggleFullscreen() {
    const target = this.container || this.video;
    if (!target) return;

    try {
      if (!document.fullscreenElement) {
        if (target.requestFullscreen) await target.requestFullscreen();
        else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen error:', err);
    }
  }

  togglePlay() {
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
  }

  setVolume(vol) {
    if (!this.video) return;
    this.video.volume = Math.max(0, Math.min(1, vol));
    if (this.video.muted && this.video.volume > 0) {
      this.video.muted = false;
    }
  }
}
