/**
 * FluiStream — Video Player Controller
 * Gerencia reprodução HLS / MP4 / MKV, aspect ratio, PiP, fullscreen e atalhos
 */

import { applyCorsProxy } from './network.js';

export const IMAGE_BOOST_MODES = ['off', 'hd_plus', 'ultra_2k'];

export const IMAGE_BOOST_PRESETS = {
  off: {
    id: 'off',
    cssClass: 'boost-off',
    svgFilterId: null,
    cssFilter: 'none',
    sharpenSigma: 0,
    contrast: 1.0,
    saturation: 1.0,
    targetHeight: 0,
    webgl: {
      enabled: false,
      sharpness: 0,
      detailGain: 0,
      deblock: 0,
      contrast: 1.0,
      vibrance: 0,
      superScale: 1.0
    }
  },
  hd_plus: {
    id: 'hd_plus',
    cssClass: 'boost-hd-plus',
    svgFilterId: 'flui-boost-hd-plus',
    cssFilter: 'url(#flui-boost-hd-plus) contrast(1.04) saturate(1.05)',
    sharpenSigma: 0.18,
    contrast: 1.03,
    saturation: 1.05,
    targetHeight: 1080,
    webgl: {
      enabled: true,
      sharpness: 0.55,
      detailGain: 0.32,
      deblock: 0.20,
      contrast: 1.0,
      vibrance: 0.05,
      superScale: 1.5
    }
  },
  ultra_2k: {
    id: 'ultra_2k',
    cssClass: 'boost-ultra-2k',
    svgFilterId: 'flui-boost-ultra-2k',
    cssFilter: 'url(#flui-boost-ultra-2k) contrast(1.06) saturate(1.08)',
    sharpenSigma: 0.32,
    contrast: 1.05,
    saturation: 1.08,
    targetHeight: 1440,
    webgl: {
      enabled: true,
      sharpness: 0.88,
      detailGain: 0.54,
      deblock: 0.30,
      contrast: 1.0,
      vibrance: 0.08,
      superScale: 2.0
    }
  }
};

const UPSCALER_VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const UPSCALER_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform float u_sharpness;
uniform float u_detailGain;
uniform float u_deblock;
uniform float u_contrast;
uniform float u_vibrance;

varying vec2 v_texCoord;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 dx = vec2(u_texelSize.x, 0.0);
  vec2 dy = vec2(0.0, u_texelSize.y);

  vec3 a = texture2D(u_texture, v_texCoord - dx - dy).rgb;
  vec3 b = texture2D(u_texture, v_texCoord - dy).rgb;
  vec3 c = texture2D(u_texture, v_texCoord + dx - dy).rgb;
  vec3 d = texture2D(u_texture, v_texCoord - dx).rgb;
  vec3 e = texture2D(u_texture, v_texCoord).rgb;
  vec3 f = texture2D(u_texture, v_texCoord + dx).rgb;
  vec3 g = texture2D(u_texture, v_texCoord - dx + dy).rgb;
  vec3 h = texture2D(u_texture, v_texCoord + dy).rgb;
  vec3 i = texture2D(u_texture, v_texCoord + dx + dy).rgb;

  // Edge-preserving bilateral deblock (smooths H.264/HEVC flat macroblocks without blurring edges)
  float le = luma(e);
  float la = luma(a);
  float lb = luma(b);
  float lc = luma(c);
  float ld = luma(d);
  float lf = luma(f);
  float lg = luma(g);
  float lh = luma(h);
  float li = luma(i);

  float wb = exp(-abs(lb - le) * 20.0);
  float wd = exp(-abs(ld - le) * 20.0);
  float wf = exp(-abs(lf - le) * 20.0);
  float wh = exp(-abs(lh - le) * 20.0);
  float wSum = 1.0 + wb + wd + wf + wh;
  vec3 smoothBase = (e + b * wb + d * wd + f * wf + h * wh) / wSum;
  vec3 base = mix(e, smoothBase, clamp(u_deblock * 0.55, 0.0, 0.5));
  float lBase = luma(base);

  // Luminance-driven AMD FidelityFX CAS 9-tap + shadow noise guard
  float minL = min(min(ld, lf), min(lb, lh));
  minL = min(minL, lBase);
  float minL2 = min(minL, min(min(la, lc), min(lg, li)));
  minL = (minL + minL2) * 0.5;

  float maxL = max(max(ld, lf), max(lb, lh));
  maxL = max(maxL, lBase);
  float maxL2 = max(maxL, max(max(la, lc), max(lg, li)));
  maxL = (maxL + maxL2) * 0.5;

  float ampL = clamp(min(minL, max(2.0 - maxL, 0.0)) / max(maxL, 0.0001), 0.0, 1.0);
  ampL = sqrt(ampL);

  float peak = -1.0 / mix(8.5, 5.2, clamp(u_sharpness, 0.0, 1.0));
  float wL = max(ampL * peak, -0.19);
  float casLuma = clamp((lb * wL + ld * wL + lf * wL + lh * wL + lBase) / (1.0 + 4.0 * wL), 0.0, 1.0);

  // High-frequency detail reconstruction gated in dark shadows (zero black crush or block noise)
  float blurL = (lb + ld + lf + lh) * 0.25;
  float detailL = (lBase - blurL) * (u_detailGain * 0.65);
  float shadowGuard = smoothstep(0.015, 0.07, le);
  float targetLuma = clamp(lBase + ((casLuma - lBase) + detailL) * shadowGuard, minL, maxL);
  float deltaL = targetLuma - lBase;

  vec3 minRGB = min(min(d, f), min(b, h));
  minRGB = min(minRGB, base);
  vec3 maxRGB = max(max(d, f), max(b, h));
  maxRGB = max(maxRGB, base);
  vec3 color = clamp(base + vec3(deltaL), minRGB, maxRGB);

  // Subtle shadow-guarded adaptive vibrance (never clips black levels or skin hues)
  float maxC = max(color.r, max(color.g, color.b));
  float minC = min(color.r, min(color.g, color.b));
  float avgC = (color.r + color.g + color.b) * 0.3333333;
  float sat = maxC - minC;
  float vib = u_vibrance * shadowGuard * (1.0 - clamp(sat * 1.4, 0.0, 1.0));
  color = clamp(mix(vec3(avgC), color, 1.0 + vib), 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`;

export class WebGlVideoUpscaler {
  constructor(videoEl, canvasEl, containerEl = null, options = {}) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.container = containerEl;
    this.onFallback = typeof options?.onFallback === 'function' ? options.onFallback : null;
    this.gl = null;
    this.program = null;
    this.texture = null;
    this.uniforms = {};
    this.preset = IMAGE_BOOST_PRESETS.off;
    this.active = false;
    this.hasRenderedFrame = false;
    this._unsupported = false;
    this._tainted = false;
    this._frameErrors = 0;
    this._rafId = null;
    this._rvfcId = null;
    this._lastVideoTime = -1;
    this._lastRenderedPresetId = 'off';
    this._lastWidth = 0;
    this._lastHeight = 0;

    if (this.canvas && typeof this.canvas.addEventListener === 'function') {
      this.canvas.addEventListener('webglcontextlost', (e) => {
        e?.preventDefault?.();
        this._teardownGl();
        this.stop();
      });
      this.canvas.addEventListener('webglcontextrestored', () => {
        this._unsupported = false;
        if (this.preset?.webgl?.enabled) {
          this.setPreset(this.preset, true, true);
        }
      });
    }
  }

  _compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('WebGlVideoUpscaler shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  initGl() {
    if (this.gl && this.program && !this.gl.isContextLost?.()) return true;
    if (this._unsupported || !this.canvas || typeof this.canvas.getContext !== 'function') return false;

    try {
      const ctxOpts = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      };
      const gl = this.canvas.getContext('webgl', ctxOpts) || this.canvas.getContext('experimental-webgl', ctxOpts);
      if (!gl) {
        this._unsupported = true;
        return false;
      }

      const vs = this._compileShader(gl, gl.VERTEX_SHADER, UPSCALER_VERTEX_SHADER);
      const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, UPSCALER_FRAGMENT_SHADER);
      if (!vs || !fs) {
        this._unsupported = true;
        return false;
      }

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('WebGlVideoUpscaler link error:', gl.getProgramInfoLog(program));
        this._unsupported = true;
        return false;
      }

      gl.useProgram(program);

      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
      ]), gl.STATIC_DRAW);
      const posLoc = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      const texBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 0, 1,
        0, 1, 1, 0, 1, 1
      ]), gl.STATIC_DRAW);
      const texLoc = gl.getAttribLocation(program, 'a_texCoord');
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      this.gl = gl;
      this.program = program;
      this.texture = texture;
      this.uniforms = {
        texture: gl.getUniformLocation(program, 'u_texture'),
        texelSize: gl.getUniformLocation(program, 'u_texelSize'),
        sharpness: gl.getUniformLocation(program, 'u_sharpness'),
        detailGain: gl.getUniformLocation(program, 'u_detailGain'),
        deblock: gl.getUniformLocation(program, 'u_deblock'),
        contrast: gl.getUniformLocation(program, 'u_contrast'),
        vibrance: gl.getUniformLocation(program, 'u_vibrance')
      };
      return true;
    } catch (err) {
      console.warn('WebGlVideoUpscaler init failed:', err);
      this._unsupported = true;
      return false;
    }
  }

  _teardownGl() {
    this.gl = null;
    this.program = null;
    this.texture = null;
    this.uniforms = {};
    this._lastWidth = 0;
    this._lastHeight = 0;
  }

  _resizeCanvasIfNeeded(vw, vh) {
    if (!this.canvas || !this.gl || vw <= 0 || vh <= 0) return;
    const cfg = this.preset?.webgl || {};
    const superScale = cfg.superScale || 1.5;
    const isUltra = this.preset?.id === 'ultra_2k';
    const dpr = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2);
    const dispH = (this.canvas.clientHeight || this.container?.clientHeight || vh) * dpr;

    let targetH = Math.max(Math.round(vh * superScale), Math.round(dispH), isUltra ? 1440 : 1080);
    let targetW = Math.round((targetH * vw) / vh);

    let maxW = isUltra ? 3840 : 2560;
    let maxH = isUltra ? 2160 : 1440;
    try {
      const vpDims = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS);
      if (vpDims && vpDims.length >= 2) {
        maxW = Math.min(maxW, vpDims[0] || maxW);
        maxH = Math.min(maxH, vpDims[1] || maxH);
      }
    } catch {}

    if (targetW > maxW) {
      targetW = maxW;
      targetH = Math.max(2, Math.round((targetW * vh) / vw));
    }
    if (targetH > maxH) {
      targetH = maxH;
      targetW = Math.max(2, Math.round((targetH * vw) / vh));
    }

    targetW = Math.max(vw, targetW);
    targetH = Math.max(vh, targetH);

    if (this._lastWidth !== targetW || this._lastHeight !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this._lastWidth = targetW;
      this._lastHeight = targetH;
      this.gl.viewport(0, 0, targetW, targetH);
    }
  }

  setPreset(preset, shouldRun = true, forceRender = false) {
    this.preset = preset || IMAGE_BOOST_PRESETS.off;
    if (!shouldRun || !this.preset?.webgl?.enabled) {
      this.stop();
      return false;
    }

    if (!this.initGl()) {
      this.onFallback?.('WEBGL_UNSUPPORTED');
      this.stop();
      return false;
    }

    this._tainted = false;
    this._frameErrors = 0;
    this.active = true;

    if (forceRender) {
      this.renderFrame(true);
    }
    this._scheduleNextFrame();
    return true;
  }

  _cancelScheduledFrames() {
    if (this._rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._rvfcId !== null && this.video && typeof this.video.cancelVideoFrameCallback === 'function') {
      try { this.video.cancelVideoFrameCallback(this._rvfcId); } catch {}
      this._rvfcId = null;
    }
  }

  _scheduleNextFrame() {
    if (!this.active) return;
    this._cancelScheduledFrames();

    if (this.video && typeof this.video.requestVideoFrameCallback === 'function' && !this.video.paused) {
      this._rvfcId = this.video.requestVideoFrameCallback(() => {
        this._rvfcId = null;
        if (!this.active) return;
        this.renderFrame(false);
        this._scheduleNextFrame();
      });
    } else if (typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        if (!this.active) return;
        this.renderFrame(false);
        this._scheduleNextFrame();
      });
    }
  }

  renderFrame(force = false) {
    if (!this.active || !this.gl || !this.program || !this.video || !this.canvas) return false;
    const readyState = this.video.readyState || 0;
    const vw = this.video.videoWidth || 0;
    const vh = this.video.videoHeight || 0;
    if (readyState < 2 || vw <= 0 || vh <= 0) return false;

    const currentTime = this.video.currentTime || 0;
    if (!force && this.hasRenderedFrame && this.video.paused && currentTime === this._lastVideoTime && this._lastRenderedPresetId === this.preset.id) {
      return true;
    }

    try {
      const gl = this.gl;
      if (gl.isContextLost?.()) return false;

      this._resizeCanvasIfNeeded(vw, vh);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);

      const cfg = this.preset.webgl;
      gl.uniform1i(this.uniforms.texture, 0);
      gl.uniform2f(this.uniforms.texelSize, 1.0 / vw, 1.0 / vh);
      gl.uniform1f(this.uniforms.sharpness, cfg.sharpness);
      gl.uniform1f(this.uniforms.detailGain, cfg.detailGain);
      gl.uniform1f(this.uniforms.deblock, cfg.deblock);
      gl.uniform1f(this.uniforms.contrast, cfg.contrast);
      gl.uniform1f(this.uniforms.vibrance, cfg.vibrance);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!this.hasRenderedFrame) {
        this.hasRenderedFrame = true;
        this.canvas.classList?.remove('hidden');
        this.container?.classList?.add('webgl-upscale-active');
      }
      this._lastVideoTime = currentTime;
      this._lastRenderedPresetId = this.preset.id;
      this._frameErrors = 0;
      return true;
    } catch (err) {
      const errName = String(err?.name || '');
      const errMsg = String(err?.message || '');
      if (errName === 'SecurityError' || /tainted|cross-origin/i.test(errMsg)) {
        this._tainted = true;
        this.stop();
        this.onFallback?.('CORS_TAINTED', err);
        return false;
      }
      this._frameErrors++;
      if (this._frameErrors > 12) {
        this.stop();
        this.onFallback?.('WEBGL_FRAME_ERROR', err);
      }
      return false;
    }
  }

  stop() {
    this.active = false;
    this.hasRenderedFrame = false;
    this._cancelScheduledFrames();
    this.canvas?.classList?.add('hidden');
    this.container?.classList?.remove('webgl-upscale-active');
  }
}

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
  const isFullscreen = Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.body?.classList?.contains('desktop-fullscreen') ||
    stageEl?.classList?.contains('is-fullscreen')
  );
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
    this.upscaleCanvas = containerElement?.querySelector?.('#main-video-upscale-canvas')
      || (typeof document !== 'undefined' && containerElement ? document.getElementById?.('main-video-upscale-canvas') : null)
      || null;
    this.hls = null;
    this.mpegtsPlayer = null;
    this.currentItem = null;
    this.aspectRatio = 'auto'; // 'auto' | '16:9' | '4:3' | 'fill'
    this.imageBoost = 'off'; // 'off' | 'hd_plus' | 'ultra_2k'
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
    this._playbackSessionId = 0;
    this._activeAttempt = null;
    this._html5Attempts = [];
    this._html5AttemptIdx = 0;
    this._suppressVideoError = false;
    this._vlcFallbackTried = false;
    this._webglCorsBlocked = false;
    this.webglUpscaler = (this.video && this.upscaleCanvas)
      ? new WebGlVideoUpscaler(this.video, this.upscaleCanvas, this.container, {
          onFallback: (reason) => this._handleWebGlFallback(reason)
        })
      : null;

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
      if (!this.isStopped) {
        this._syncWebGlUpscaler(true);
        this.notifyState('playing');
      }
    });
    this.video.addEventListener('pause', () => { if (!this.isStopped) this.notifyState('paused'); });
    this.video.addEventListener('canplay', () => {
      if (!this.isStopped) {
        this._syncWebGlUpscaler(true);
        this.notifyState('ready');
      }
    });
    this.video.addEventListener('seeked', () => {
      if (!this.isStopped && this.webglUpscaler?.active) {
        this.webglUpscaler.renderFrame(true);
      }
    });
    this.video.addEventListener('timeupdate', () => {
      if (this.currentEngine === 'hls' && this.onTimeUpdate && !this.isStopped) {
        const cur = this.video.currentTime || 0;
        const dur = isFinite(this.video.duration) ? this.video.duration : 0;
        const pos = dur > 0 ? (cur / dur) : 0;
        this.onTimeUpdate({ currentTime: cur, duration: dur, position: pos, isSeekable: dur > 0 });
      }
    });
    this.video.addEventListener('error', (e) => {
      if (this.isStopped || !this.currentItem || this._suppressVideoError) return; // Não reportar erro se usuário clicou em Parar, Fechar ou troca de candidato
      const code = this.video.error ? this.video.error.code : 'UNKNOWN';
      const msg = this.video.error ? this.video.error.message : '';
      if (this._activeAttempt && this._activeAttempt.sessionId === this._playbackSessionId) {
        this._handleHtml5AttemptFailure(this._playbackSessionId, 'HTML5_VIDEO_ERROR', String(msg || code), { code, message: msg });
        return;
      }
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

    // Restaurar boost de imagem prévio
    try {
      const savedBoost = localStorage.getItem('fluistream_image_boost');
      if (savedBoost && IMAGE_BOOST_MODES.includes(savedBoost)) {
        this.imageBoost = savedBoost;
        this._applyVideoElementBoost(this.video, savedBoost);
      }
    } catch {
      // Ignore
    }

    // Duplo clique para alternar tela cheia no container (#player-wrapper)
    this.video.addEventListener('dblclick', (e) => {
      e.preventDefault?.();
      e.stopPropagation();
      this.toggleFullscreen();
    });

    // iOS/macOS Safari eventos de reprodução em tela cheia e PiP (webkitpresentationmode)
    if (this.video) {
      this.video.addEventListener('webkitbeginfullscreen', () => {
        this._inNativeFullscreen = true;
        this._resumeAfterFullscreen = !this.video.paused && !this.isStopped;
      });
      this.video.addEventListener('webkitendfullscreen', () => {
        this._inNativeFullscreen = false;
        this._resumePlaybackAfterFullscreenExit();
      });
      this.video.addEventListener('webkitpresentationmodechanged', () => {
        const mode = this.video.webkitPresentationMode;
        if (mode === 'picture-in-picture') {
          document.body?.classList?.add('desktop-mini-pip');
        } else if (mode === 'inline' && !this._isDesktopHostPip) {
          document.body?.classList?.remove('desktop-mini-pip');
        }
        this.reportLayout();
      });
    }

    if (typeof window !== 'undefined') {
      if (window.external?.receiveMessage) {
        window.external.receiveMessage((rawMsg) => {
          try {
            const data = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
            if (data?.type === 'WINDOW_STATE') {
              this._isDesktopHostPip = Boolean(data.isPip);
              if (data.isPip) {
                document.body?.classList?.add('desktop-mini-pip');
              } else {
                document.body?.classList?.remove('desktop-mini-pip');
              }
              // O fullscreen da janela do app NÃO força o player a entrar em tela cheia exclusiva.
              // Apenas se a janela saiu de tela cheia enquanto o player estava em modo exclusivo, sincronizamos a saída.
              if (data.isFullscreen === false && this._isDesktopFullscreen) {
                this._isDesktopFullscreen = false;
                document.body?.classList?.remove('desktop-fullscreen');
                this.container?.classList?.remove('is-fullscreen');
                this._resumePlaybackAfterFullscreenExit();
              }
              this.reportLayout();
            }
          } catch {}
        });
      }

      if (window.chrome?.webview?.addEventListener) {
        window.chrome.webview.addEventListener('message', (e) => {
          const data = e.data;
          if (data?.type === 'WINDOW_STATE') {
            this._isDesktopHostPip = Boolean(data.isPip);
            if (data.isPip) {
              document.body?.classList?.add('desktop-mini-pip');
            } else {
              document.body?.classList?.remove('desktop-mini-pip');
            }
            if (data.isFullscreen === false && this._isDesktopFullscreen) {
              this._isDesktopFullscreen = false;
              document.body?.classList?.remove('desktop-fullscreen');
              this.container?.classList?.remove('is-fullscreen');
              this._resumePlaybackAfterFullscreenExit();
            }
            this.reportLayout();
          }
        });
      }
    }

    if (typeof document !== 'undefined') {
      const onFullscreenChange = () => {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl && fsEl === this.video && this.container && this.container !== this.video && this.container.requestFullscreen) {
          Promise.resolve(document.exitFullscreen?.()).catch(() => {}).finally(() => {
            if (!this.isStopped) this.container.requestFullscreen().catch(() => {});
          });
          return;
        }
        const isFs = Boolean(fsEl);
        if (isFs) {
          this._isDesktopFullscreen = true;
          this._resumeAfterFullscreen = !this.video.paused && !this.isStopped;
          document.body?.classList?.add('desktop-fullscreen');
          this.container?.classList?.add('is-fullscreen');
        } else {
          this._isDesktopFullscreen = false;
          document.body?.classList?.remove('desktop-fullscreen');
          this.container?.classList?.remove('is-fullscreen');
          if (this.video && this.currentEngine !== 'vlc' && !(typeof window !== 'undefined' && window.androidBridge)) {
            this.video.style.display = 'block';
          }
          this.notifyDesktopHost('EXIT_FULLSCREEN');
          this._resumePlaybackAfterFullscreenExit();
          this.reportLayout();
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => this.reportLayout());
          }
          setTimeout(() => { if (!this.isStopped) this.reportLayout(); }, 120);
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
    if (typeof window === 'undefined' || !this.container) return;
    const hasAndroidLayout = typeof window.androidBridge?.updatePlayerLayout === 'function';
    const hasDesktopVlc = this.currentEngine === 'vlc' && Boolean(window.chrome?.webview);
    if (!hasAndroidLayout && !hasDesktopVlc) return;

    const layout = computeOverlayLayout(this.container, 1);
    const isVisible = !this.isStopped && layout.visible;

    if (hasAndroidLayout) {
      try {
        window.androidBridge.updatePlayerLayout(layout.x, layout.y, layout.width, layout.height, isVisible);
      } catch {}
    }

    if (hasDesktopVlc) {
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
  }

  setOverlayVisible(visible) {
    const hasAndroidLayout = typeof window !== 'undefined' && typeof window.androidBridge?.updatePlayerLayout === 'function';
    const hasDesktopVlc = this.currentEngine === 'vlc' && typeof window !== 'undefined' && Boolean(window.chrome?.webview);
    if (!hasAndroidLayout && !hasDesktopVlc) return;

    const layout = this.container ? computeOverlayLayout(this.container, 1) : { x: 0, y: 0, width: 0, height: 0, visible: false };
    const allowVisible = Boolean(visible) && !this.isStopped && layout.visible;

    if (hasAndroidLayout) {
      try {
        window.androidBridge.updatePlayerLayout(layout.x, layout.y, layout.width, layout.height, allowVisible);
      } catch {}
    }
    if (hasDesktopVlc) {
      this.notifyNativeVlc('SET_VISIBILITY', { visible: allowVisible });
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
   * Notifica host nativo (WebView2 C# ou Photino macOS/Linux) sobre comandos de janela e player
   */
  notifyDesktopHost(action, data = {}) {
    let sent = false;
    if (typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
      try {
        window.chrome.webview.postMessage({
          type: 'DESKTOP_COMMAND',
          action,
          ...data
        });
        sent = true;
      } catch {}
    }

    if (!sent && typeof window !== 'undefined' && window.external?.sendMessage) {
      try {
        window.external.sendMessage(JSON.stringify({
          type: 'DESKTOP_COMMAND',
          action,
          ...data
        }));
        sent = true;
      } catch {}
    } else if (!sent && typeof window !== 'undefined' && window.webkit?.messageHandlers?.photinointerop?.postMessage) {
      try {
        window.webkit.messageHandlers.photinointerop.postMessage(JSON.stringify({
          type: 'DESKTOP_COMMAND',
          action,
          ...data
        }));
        sent = true;
      } catch {}
    }

    if (!sent) {
      const localHostUrl = (typeof window !== 'undefined' && window.__fluiLocalProxyUrl)
        ? window.__fluiLocalProxyUrl
        : (typeof window !== 'undefined' && window.location?.origin?.startsWith('http://127.0.0.1') ? window.location.origin : '');

      if (localHostUrl && (
        action === 'TOGGLE_FULLSCREEN' || action === 'ENTER_FULLSCREEN' || action === 'EXIT_FULLSCREEN' ||
        action === 'TOGGLE_PIP' || action === 'ENTER_PIP' || action === 'EXIT_PIP' ||
        (action === 'OPEN_URL' && typeof data?.url === 'string' && data.url.length > 0)
      )) {
        const urlParam = typeof data?.url === 'string' && data.url.length > 0
          ? `&url=${encodeURIComponent(data.url)}`
          : '';
        fetch(`${localHostUrl.replace(/\/+$/, '')}/api/window?action=${encodeURIComponent(action)}${urlParam}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...data })
        }).catch(() => {});
      }
    }
  }

  /**
   * Notifica host nativo (WebView2 C#) sobre reprodução VLC se disponível
   */
  notifyNativeVlc(action, data = {}) {
    if (action === 'TOGGLE_FULLSCREEN' || action === 'TOGGLE_PIP' || action === 'EXIT_FULLSCREEN') {
      this.notifyDesktopHost(action, data);
    }
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
    const sessionId = ++this._playbackSessionId;
    this.isStopped = false;
    this.currentItem = item;
    this.currentStreamMode = streamMode;
    this.currentEngine = playerEngine;
    this._vlcFallbackTried = false;
    this._activeAttempt = null;
    this._lastHtml5Error = null;
    this._webglCorsBlocked = false;
    this.webglUpscaler?.stop?.();
    this.notifyState('loading');

    const candidates = this.buildStreamCandidates(item.url, item.type, streamMode);
    const streamUrl = candidates[0] || item.url;

    // Ponte Nativa Android (ExoPlayer / Media3 via @JavascriptInterface window.androidBridge)
    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    if (isAndroidApp) {
      this._destroyHtml5Engines(true);
      this._clearVideoSource(true);
      this.reportLayout();
      if (typeof window.androidBridge.setFallbackUrls === 'function') {
        window.androidBridge.setFallbackUrls(JSON.stringify(candidates.slice(1)));
      }
      if (typeof window.androidBridge.setImageBoost === 'function') {
        window.androidBridge.setImageBoost(this.imageBoost || 'off');
      }
      window.androidBridge.playStream(streamUrl, item.name || '', item.type || 'live', streamMode || 'auto');
      this.updateMediaSession(item);
      this.notifyState('playing');
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.reportLayout());
      }
      setTimeout(() => { if (!this.isStopped) this.reportLayout(); }, 150);
      return;
    }

    // Se motor for VLC e estiver rodando no app Desktop
    const isDesktopApp = typeof window !== 'undefined' && Boolean(window.chrome?.webview);
    if (playerEngine === 'vlc' && isDesktopApp) {
      this._destroyHtml5Engines(true);
      this._clearVideoSource(true);

      // Delegar ao LibVLC em C# (inclui URLs fallback caso .m3u8 dê 404)
      this.notifyNativeVlc('PLAY', {
        url: streamUrl,
        fallbackUrls: candidates.slice(1),
        title: item.name || '',
        itemType: item.type,
        aspectRatio: this.aspectRatio || 'auto',
        imageBoost: this.imageBoost || 'off'
      });

      this.updateMediaSession(item);
      requestAnimationFrame(() => this.reportLayout());
      setTimeout(() => this.reportLayout(), 150);
      setTimeout(() => this.notifyNativeVlc('GET_TRACKS'), 1200);
      return;
    }

    if (this.video) {
      this.video.style.display = 'block';
      this._applyVideoElementBoost(this.video, this.imageBoost);
      this._syncWebGlUpscaler(true);
    }
    if (isDesktopApp) {
      // Se estiver no Desktop mas escolheu HLS, desativa overlay do VLC e exibe vídeo HTML5
      this.notifyNativeVlc('STOP');
    }

    this._html5Attempts = this._buildHtml5AttemptQueue(candidates, item, corsProxy, streamMode, isDesktopApp);
    this._html5AttemptIdx = 0;
    this._runHtml5Attempt(sessionId);

    // Media Session API para SO (Windows, Android, macOS)
    this.updateMediaSession(item);
  }

  _isCorsFriendlyStreamUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:') || url.startsWith('data:')) return true;
    const rawProxyPrefix = (typeof window !== 'undefined' && typeof window.__fluiLocalProxyUrl === 'string')
      ? window.__fluiLocalProxyUrl.trim()
      : '';
    if (rawProxyPrefix && url.startsWith(rawProxyPrefix)) return true;
    if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/proxy\b/i.test(url)) return true;
    if (/\/proxy\?url=/i.test(url)) return true;
    return false;
  }

  _configureVideoCrossOrigin(url, corsProxied = false) {
    if (!this.video) return false;
    const canUseCors = Boolean(corsProxied || this._isCorsFriendlyStreamUrl(url));
    try {
      if (canUseCors) {
        this.video.crossOrigin = 'anonymous';
        this.video.setAttribute?.('crossorigin', 'anonymous');
      } else {
        this.video.crossOrigin = null;
        this.video.removeAttribute?.('crossorigin');
      }
    } catch {
      // Ignore mock elements
    }
    return canUseCors;
  }

  _buildHtml5AttemptQueue(candidates, item, corsProxy = '', streamMode = 'auto') {
    const queue = [];
    const seen = new Set();
    const rawProxyPrefix = (typeof window !== 'undefined' && typeof window.__fluiLocalProxyUrl === 'string')
      ? window.__fluiLocalProxyUrl.trim()
      : '';
    const localProxyPrefix = rawProxyPrefix ? (rawProxyPrefix.endsWith('/') ? rawProxyPrefix : `${rawProxyPrefix}/`) : '';
    const preferProxyForBoost = Boolean(this.imageBoost && this.imageBoost !== 'off');

    const pushAttempt = (kind, url, rawUrl, corsProxied = false) => {
      if (!url) return;
      const key = `${kind}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push({ kind, url, rawUrl, corsProxied, enableWorker: true });
    };

    for (const rawUrl of candidates) {
      const isExplicitMedia = /\.(?:mp4|mkv|avi|webm)(?:[?#]|$)/i.test(rawUrl);
      const isVodNonHls = (item.type === 'movie' || item.type === 'series') && !/\.(?:m3u8|ts)(?:[?#]|$)/i.test(rawUrl);
      const isVideoFile = isExplicitMedia || isVodNonHls;
      const isTs = !isVideoFile && (streamMode === 'ts' || /\.ts(?:[?#]|$)/i.test(rawUrl));
      const isHls = !isVideoFile && !isTs && (streamMode === 'hls' || /\.m3u8(?:[?#]|$)/i.test(rawUrl) || (streamMode === 'auto' && (item.type === 'live' || rawUrl.includes('/live/'))));
      const isRawLive = !isVideoFile && !isTs && !isHls && (item.type === 'live' || rawUrl.includes('/live/'));

      let urls;
      if (corsProxy) {
        urls = [applyCorsProxy(corsProxy, rawUrl)];
      } else if (localProxyPrefix && /^https?:\/\//i.test(rawUrl)) {
        const proxiedUrl = `${localProxyPrefix}proxy?url=${encodeURIComponent(rawUrl)}`;
        urls = (isVideoFile && !preferProxyForBoost) ? [rawUrl, proxiedUrl] : [proxiedUrl, rawUrl];
      } else {
        urls = [rawUrl];
      }

      for (const u of urls) {
        const isProxied = Boolean(corsProxy) || this._isCorsFriendlyStreamUrl(u);
        if (isHls) {
          pushAttempt('hls', u, rawUrl, isProxied);
        } else if (isTs) {
          pushAttempt('mpegts', u, rawUrl, isProxied);
        } else if (isRawLive) {
          pushAttempt('mpegts', u, rawUrl, isProxied);
          pushAttempt('hls', u, rawUrl, isProxied);
        } else {
          pushAttempt('native', u, rawUrl, isProxied);
        }
      }
    }

    return queue;
  }

  _runHtml5Attempt(sessionId) {
    if (this.isStopped || sessionId !== this._playbackSessionId) return;

    while (this._html5AttemptIdx < this._html5Attempts.length) {
      const candidate = this._html5Attempts[this._html5AttemptIdx];
      const hlsSupported = typeof window !== 'undefined' && Boolean(window.Hls && window.Hls.isSupported());
      const mpegtsSupported = typeof window !== 'undefined' && Boolean(window.mpegts?.isSupported());
      const safariNativeHls = Boolean(this.video?.canPlayType?.('application/vnd.apple.mpegurl'));

      let kind = candidate.kind;
      if (kind === 'hls' && !hlsSupported) {
        if (safariNativeHls) {
          kind = 'native';
        } else {
          this._html5AttemptIdx++;
          continue;
        }
      }
      if (kind === 'mpegts' && !mpegtsSupported) {
        this._html5AttemptIdx++;
        continue;
      }

      const attempt = { ...candidate, kind, sessionId };
      this._activeAttempt = attempt;
      this._destroyHtml5Engines(true);

      if (kind === 'hls') {
        this._startHlsAttempt(attempt, attempt.enableWorker);
      } else if (kind === 'mpegts') {
        this._startMpegtsAttempt(attempt);
      } else {
        this._startNativeAttempt(attempt);
      }
      return;
    }

    if (this._fallbackToDesktopVlc(this.currentItem, this.currentStreamMode)) {
      return;
    }

    this.notifyState('error', this._lastHtml5Error || { type: 'HTML5_VIDEO_ERROR', details: 'NO_SUPPORTED_STREAM' });
  }

  _startHlsAttempt(attempt, enableWorker = true) {
    const { sessionId, url } = attempt;
    this._configureVideoCrossOrigin(url, Boolean(attempt.corsProxied));
    try {
      this.hls = new window.Hls({
        enableWorker,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 1,
        fragLoadingTimeOut: 12000,
        fragLoadingMaxRetry: 1
      });
    } catch (err) {
      if (enableWorker) {
        this._startHlsAttempt(attempt, false);
      } else {
        this._handleHtml5AttemptFailure(sessionId, 'FATAL_ERROR', String(err?.message || err));
      }
      return;
    }

    if (this.imageBoost && this.imageBoost !== 'off') {
      this.hls.capLevelToPlayerSize = false;
    }

    this.hls.loadSource(url);
    this.hls.attachMedia(this.video);

    this.hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {
      if (sessionId !== this._playbackSessionId) return;
      this.extractHlsAudioTracks(data.audioTracks || this.hls.audioTracks);
    });

    this.hls.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, (event, data) => {
      if (sessionId !== this._playbackSessionId) return;
      this.currentAudioTrack = data.id;
      this.notifyTracks();
    });

    this.hls.on(window.Hls.Events.SUBTITLE_TRACKS_UPDATED, (event, data) => {
      if (sessionId !== this._playbackSessionId) return;
      this.extractHlsSubtitleTracks(data.subtitleTracks || this.hls.subtitleTracks);
    });

    this.hls.on(window.Hls.Events.SUBTITLE_TRACK_SWITCH, (event, data) => {
      if (sessionId !== this._playbackSessionId) return;
      this.currentSubtitleTrack = data.id;
      this.notifyTracks();
    });

    this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (this.isStopped || sessionId !== this._playbackSessionId) return;
      if (this.hls?.audioTracks && this.hls.audioTracks.length > 0) {
        this.extractHlsAudioTracks(this.hls.audioTracks);
      }
      if (this.hls?.subtitleTracks && this.hls.subtitleTracks.length > 0) {
        this.extractHlsSubtitleTracks(this.hls.subtitleTracks);
      }
      this.video.play().catch(e => {
        console.warn('Autoplay blocked:', e);
        if (e?.name === 'NotAllowedError') this.notifyState('ready');
      });
    });

    let networkRetries = 0;
    let mediaRecoveries = 0;
    this.hls.on(window.Hls.Events.ERROR, (event, data) => {
      if (this.isStopped || sessionId !== this._playbackSessionId || this._activeAttempt !== attempt) return;
      if (!data?.fatal) return;

      const isWeb = typeof window !== 'undefined' && !window.chrome?.webview && !window.androidBridge;
      switch (data.type) {
        case window.Hls.ErrorTypes.NETWORK_ERROR: {
          const isManifestErr = data.details === 'manifestLoadError' || data.details === 'manifestLoadTimeOut' || data.details === 'manifestParsingError';
          if (!isManifestErr && networkRetries < 1) {
            networkRetries++;
            this.hls?.startLoad();
            return;
          }
          this._handleHtml5AttemptFailure(sessionId, 'NETWORK_ERROR', String(data.details || 'NETWORK_ERROR'), { isCorsOrMixedContent: isWeb });
          break;
        }
        case window.Hls.ErrorTypes.MEDIA_ERROR:
          if (mediaRecoveries < 1 && this.hls) {
            mediaRecoveries++;
            this.hls.recoverMediaError();
            return;
          }
          this._handleHtml5AttemptFailure(sessionId, 'MEDIA_ERROR', String(data.details || 'MEDIA_ERROR'));
          break;
        default:
          if (data.details === 'internalException' && enableWorker) {
            this._destroyHtml5Engines(true);
            this._startHlsAttempt(attempt, false);
            return;
          }
          this._handleHtml5AttemptFailure(sessionId, 'FATAL_ERROR', String(data.details || 'FATAL_ERROR'));
          break;
      }
    });
  }

  _startMpegtsAttempt(attempt) {
    const { sessionId, url } = attempt;
    this._configureVideoCrossOrigin(url, Boolean(attempt.corsProxied));
    try {
      this.mpegtsPlayer = window.mpegts.createPlayer(
        { type: 'mpegts', isLive: this.currentItem?.type === 'live', url },
        { enableWorker: false, enableStashBuffer: true, liveBufferLatencyChasing: false }
      );
      this.mpegtsPlayer.attachMediaElement(this.video);
      this.mpegtsPlayer.load();
      this.mpegtsPlayer.play().catch(e => {
        console.warn('MPEG-TS autoplay blocked:', e);
        if (e?.name === 'NotAllowedError') this.notifyState('ready');
      });
      this.mpegtsPlayer.on(window.mpegts.Events.ERROR, (errType, errDetail) => {
        if (this.isStopped || sessionId !== this._playbackSessionId || this._activeAttempt !== attempt) return;
        this._handleHtml5AttemptFailure(sessionId, 'MPEGTS_ERROR', String(errDetail || errType || 'Exception'));
      });
    } catch (err) {
      this._handleHtml5AttemptFailure(sessionId, 'MPEGTS_ERROR', String(err?.message || err));
    }
  }

  _startNativeAttempt(attempt) {
    const { sessionId, url } = attempt;
    this._suppressVideoError = false;
    this._configureVideoCrossOrigin(url, Boolean(attempt.corsProxied));
    this.video.src = url;
    this.video.load();
    this.video.addEventListener('loadedmetadata', () => {
      if (this.isStopped || sessionId !== this._playbackSessionId) return;
      this.extractNativeTracks();
    }, { once: true });
    this.video.play().catch(e => {
      console.warn('Autoplay blocked:', e);
      if (e?.name === 'NotAllowedError') this.notifyState('ready');
    });
  }

  _handleHtml5AttemptFailure(sessionId, errorType, details, extra = {}) {
    if (this.isStopped || sessionId !== this._playbackSessionId || !this._activeAttempt) return;
    this._activeAttempt = null;
    this._lastHtml5Error = { type: errorType, details, ...extra };
    this._destroyHtml5Engines(true);
    this._clearVideoSource(false);

    if (this._html5AttemptIdx + 1 < this._html5Attempts.length) {
      this._html5AttemptIdx++;
      this._runHtml5Attempt(sessionId);
      return;
    }

    if (this._fallbackToDesktopVlc(this.currentItem, this.currentStreamMode)) {
      return;
    }

    this.notifyState('error', this._lastHtml5Error);
  }

  _fallbackToDesktopVlc(item, streamMode) {
    if (this._vlcFallbackTried || this.isStopped || !item?.url) return false;
    const isDesktopApp = typeof window !== 'undefined' && Boolean(window.chrome?.webview);
    if (!isDesktopApp) return false;

    this._vlcFallbackTried = true;
    this.currentEngine = 'vlc';
    this._activeAttempt = null;
    this._destroyHtml5Engines(true);
    this._clearVideoSource(true);

    const candidates = this.buildStreamCandidates(item.url, item.type, streamMode);
    const streamUrl = candidates[0] || item.url;
    console.warn('[FluiStream] HTML5 HLS falhou no Desktop; ativando fallback LibVLC:', streamUrl);

    this.notifyNativeVlc('PLAY', {
      url: streamUrl,
      fallbackUrls: candidates.slice(1),
      title: item.name || '',
      itemType: item.type,
      aspectRatio: this.aspectRatio || 'auto',
      imageBoost: this.imageBoost || 'off'
    });
    this.updateMediaSession(item);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.reportLayout());
    } else {
      this.reportLayout();
    }
    setTimeout(() => { if (!this.isStopped) this.reportLayout(); }, 150);
    setTimeout(() => { if (!this.isStopped) this.notifyNativeVlc('GET_TRACKS'); }, 1200);
    return true;
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

    const aspectTargets = [this.video, this.upscaleCanvas].filter(Boolean);
    for (const target of aspectTargets) {
      target.classList?.remove('aspect-auto', 'aspect-16-9', 'aspect-4-3', 'aspect-fill');

      switch (ratio) {
        case '16:9':
          target.classList?.add('aspect-16-9');
          if (target.style) target.style.objectFit = 'contain';
          break;
        case '4:3':
          target.classList?.add('aspect-4-3');
          if (target.style) target.style.objectFit = 'contain';
          break;
        case 'fill':
          target.classList?.add('aspect-fill');
          if (target.style) target.style.objectFit = 'fill';
          break;
        case 'auto':
        default:
          target.classList?.add('aspect-auto');
          if (target.style) target.style.objectFit = 'contain';
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

  _isSafariWebKitEngine() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
  }

  _applyVideoElementBoost(videoEl, mode) {
    const norm = IMAGE_BOOST_MODES.includes(mode) ? mode : 'off';
    const preset = IMAGE_BOOST_PRESETS[norm];
    if (this.container) {
      this.container.classList?.remove('boost-off', 'boost-hd-plus', 'boost-ultra-2k');
      this.container.classList?.add(preset.cssClass);
      this.container.setAttribute?.('data-image-boost', norm);
    }
    if (videoEl) {
      videoEl.classList?.remove('boost-off', 'boost-hd-plus', 'boost-ultra-2k');
      videoEl.classList?.add(preset.cssClass);
      videoEl.setAttribute?.('data-image-boost', norm);
      if (videoEl.style) {
        if (norm === 'off') {
          videoEl.style.filter = '';
        } else {
          // Safari/WKWebView ignores/drops SVG url(#...) filters on GPU <video> layers
          videoEl.style.filter = this._isSafariWebKitEngine()
            ? preset.cssFilter.replace(/url\([^)]+\)\s*/g, '').trim()
            : preset.cssFilter;
        }
      }
    }
  }

  _syncWebGlUpscaler(forceRender = false) {
    if (!this.webglUpscaler) return false;
    const isAndroid = typeof window !== 'undefined' && Boolean(window.androidBridge);
    const isVlc = this.currentEngine === 'vlc';
    const preset = IMAGE_BOOST_PRESETS[this.imageBoost] || IMAGE_BOOST_PRESETS.off;
    const shouldRun = Boolean(
      preset?.webgl?.enabled &&
      !this.isStopped &&
      !isAndroid &&
      !isVlc &&
      !this._webglCorsBlocked
    );
    if (!shouldRun) {
      this.webglUpscaler.stop();
      return false;
    }
    return this.webglUpscaler.setPreset(preset, true, forceRender);
  }

  _handleWebGlFallback(reason = '') {
    if (reason === 'CORS_TAINTED' || reason === 'WEBGL_UNSUPPORTED') {
      this._webglCorsBlocked = true;
    }
    this.webglUpscaler?.stop?.();
    this._applyVideoElementBoost(this.video, this.imageBoost);
  }

  setImageBoost(mode) {
    const norm = IMAGE_BOOST_MODES.includes(mode) ? mode : 'off';
    this.imageBoost = norm;
    try {
      localStorage.setItem('fluistream_image_boost', norm);
    } catch {
      // Ignore
    }
    this._applyVideoElementBoost(this.video, norm);
    this._syncWebGlUpscaler(true);

    if (this.hls && norm !== 'off') {
      this.hls.capLevelToPlayerSize = false;
    }

    if (typeof window !== 'undefined' && window.androidBridge) {
      window.androidBridge?.setImageBoost?.(norm);
    }

    if (this.currentEngine === 'vlc' || (typeof window !== 'undefined' && window.chrome?.webview)) {
      this.notifyNativeVlc('SET_IMAGE_BOOST', { mode: norm });
    }

    return norm;
  }

  cycleImageBoost() {
    const idx = IMAGE_BOOST_MODES.indexOf(this.imageBoost);
    const nextMode = IMAGE_BOOST_MODES[(idx + 1) % IMAGE_BOOST_MODES.length];
    return this.setImageBoost(nextMode);
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
    const now = Date.now();
    if (this._lastPipToggleTime && (now - this._lastPipToggleTime) < 350) return;
    this._lastPipToggleTime = now;

    if (this.currentEngine === 'vlc' && typeof window !== 'undefined' && window.chrome?.webview) {
      this.notifyNativeVlc('TOGGLE_PIP');
      return;
    }

    // Se estiver rodando como Desktop App (macOS Photino, Windows WebView2 ou proxy local ativo)
    const isDesktopApp = typeof window !== 'undefined' && Boolean(
      window.chrome?.webview ||
      window.external?.sendMessage ||
      window.webkit?.messageHandlers?.photinointerop ||
      (typeof window.__fluiLocalProxyUrl === 'string' && window.__fluiLocalProxyUrl.length > 0)
    );

    if (isDesktopApp) {
      const isCurrentlyPip = Boolean(document.body?.classList?.contains('desktop-mini-pip'));
      const targetAction = isCurrentlyPip ? 'EXIT_PIP' : 'ENTER_PIP';
      if (isCurrentlyPip) {
        document.body?.classList?.remove('desktop-mini-pip');
      } else {
        document.body?.classList?.add('desktop-mini-pip');
      }
      this.notifyDesktopHost(targetAction);
      this.reportLayout();
      return;
    }

    // Modo Web convencional (fora do app Desktop)
    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
        return;
      } catch (e) {
        console.warn('Erro ao sair do PiP:', e);
      }
    }

    if (this.video && typeof this.video.requestPictureInPicture === 'function') {
      try {
        await this.video.requestPictureInPicture();
        return;
      } catch (err) {
        console.warn('W3C requestPictureInPicture falhou:', err);
      }
    }

    if (this.video && typeof this.video.webkitSetPresentationMode === 'function' && this.video.webkitSupportsPresentationMode?.('picture-in-picture')) {
      try {
        const mode = this.video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        this.video.webkitSetPresentationMode(mode);
        return;
      } catch (e) {
        console.warn('WebKit PresentationMode PiP falhou:', e);
      }
    }

    if (document.body?.classList?.contains('desktop-mini-pip')) {
      document.body.classList.remove('desktop-mini-pip');
    } else {
      document.body?.classList?.add('desktop-mini-pip');
    }
    this.reportLayout();
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
    const now = Date.now();
    if (this._lastFsToggleTime && (now - this._lastFsToggleTime) < 350) return;
    this._lastFsToggleTime = now;

    if (this.currentEngine === 'vlc' && typeof window !== 'undefined' && window.chrome?.webview) {
      this._isDesktopFullscreen = !this._isDesktopFullscreen;
      this.notifyNativeVlc('TOGGLE_FULLSCREEN');
      return;
    }

    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    if (isAndroidApp) {
      if (typeof window.androidBridge.toggleFullscreen === 'function') {
        this._isDesktopFullscreen = !this._isDesktopFullscreen;
        window.androidBridge.toggleFullscreen();
        this.reportLayout();
        return;
      }
      if (typeof window.androidBridge.setFullscreen === 'function') {
        const nextFs = !this._isDesktopFullscreen;
        this._isDesktopFullscreen = nextFs;
        window.androidBridge.setFullscreen(nextFs);
        this.reportLayout();
        return;
      }
    }

    const target = this.container || this.video;
    if (!target) return;

    const isCurrentlyFs = Boolean(
      this._isDesktopFullscreen ||
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.body?.classList?.contains('desktop-fullscreen') ||
      target.classList?.contains('is-fullscreen')
    );

    if (isCurrentlyFs) {
      this._isDesktopFullscreen = false;
      let handled = false;
      if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); handled = true; } catch {}
      } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        try { await document.webkitExitFullscreen(); handled = true; } catch {}
      } else if (this.video?.webkitDisplayingFullscreen && typeof this.video.webkitExitFullscreen === 'function') {
        try { this.video.webkitExitFullscreen(); handled = true; } catch {}
      }
      document.body?.classList?.remove('desktop-fullscreen');
      target.classList?.remove('is-fullscreen');
      if (this.video && this.currentEngine !== 'vlc' && !isAndroidApp) {
        this.video.style.display = 'block';
      }
      this.notifyDesktopHost('EXIT_FULLSCREEN');
      this._resumePlaybackAfterFullscreenExit();
      this.reportLayout();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.reportLayout());
      }
      setTimeout(() => { if (!this.isStopped) this.reportLayout(); }, 120);
      return;
    }

    this._resumeAfterFullscreen = Boolean(this.video && !this.video.paused && !this.isStopped);
    this._isDesktopFullscreen = true;
    const isDesktopApp = typeof window !== 'undefined' && Boolean(
      window.chrome?.webview ||
      window.external?.sendMessage ||
      window.webkit?.messageHandlers?.photinointerop ||
      (typeof window.__fluiLocalProxyUrl === 'string' && window.__fluiLocalProxyUrl.length > 0)
    );

    if (!isDesktopApp) {
      if (target.requestFullscreen) {
        try {
          await target.requestFullscreen();
        } catch (err) {
          console.warn('target.requestFullscreen não permitido, usando fallback desktop:', err);
        }
      } else if (target.webkitRequestFullscreen) {
        try {
          await target.webkitRequestFullscreen();
        } catch (err) {
          console.warn('target.webkitRequestFullscreen não permitido, usando fallback desktop:', err);
        }
      } else if (this.video && typeof this.video.webkitEnterFullscreen === 'function') {
        try {
          this.video.webkitEnterFullscreen();
        } catch {}
      } else if (this.video && typeof this.video.webkitSetPresentationMode === 'function' && this.video.webkitSupportsPresentationMode?.('fullscreen')) {
        try {
          this.video.webkitSetPresentationMode('fullscreen');
        } catch {}
      }
    }

    document.body?.classList?.add('desktop-fullscreen');
    target.classList?.add('is-fullscreen');
    this.notifyDesktopHost('ENTER_FULLSCREEN');
    this.reportLayout();
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

  _clearVideoSource(hide = false) {
    if (!this.video) return;
    this._suppressVideoError = true;
    this.video.pause?.();
    this.video.removeAttribute?.('src');
    this.video.load?.();
    if (hide) this.video.style.display = 'none';
    setTimeout(() => { this._suppressVideoError = false; }, 0);
  }

  _destroyHtml5Engines(suppressError = false) {
    if (suppressError) this._suppressVideoError = true;
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
    if (suppressError) {
      setTimeout(() => { this._suppressVideoError = false; }, 0);
    }
  }

  stop() {
    const isAndroidApp = typeof window !== 'undefined' && Boolean(window.androidBridge);
    this._playbackSessionId++;
    this._activeAttempt = null;
    this._html5Attempts = [];
    this._html5AttemptIdx = 0;
    this.isStopped = true;
    this._isDesktopFullscreen = false;
    this.currentItem = null;
    this.audioTracks = [];
    this.subtitleTracks = [];
    this.currentAudioTrack = -1;
    this.currentSubtitleTrack = -1;
    this.notifyTracks();
    this._destroyHtml5Engines(true);
    this.webglUpscaler?.stop?.();
    this._webglCorsBlocked = false;
    if (this.video) {
      this._clearVideoSource(isAndroidApp);
      if (!isAndroidApp) this.video.style.display = 'block';
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
    this.imageBoost = 'off';
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

  setImageBoost(mode) {
    const norm = IMAGE_BOOST_MODES.includes(mode) ? mode : 'off';
    this.imageBoost = norm;
    for (const slot of this.slots.values()) {
      if (slot.video) {
        this.urlHelper._applyVideoElementBoost(slot.video, norm);
      }
    }
    if (typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
      window.chrome.webview.postMessage({
        type: 'VLC_PLAYER_COMMAND',
        action: 'SET_IMAGE_BOOST',
        mode: norm
      });
    }
    return norm;
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
        muted: slotIndex !== this.activeAudioSlot,
        imageBoost: this.imageBoost
      });
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.reportLayout());
      }
      setTimeout(() => this.reportLayout(), 120);
      return;
    }

    videoElement.style.display = 'block';
    videoElement.muted = slotIndex !== this.activeAudioSlot;
    this.urlHelper._applyVideoElementBoost(videoElement, this.imageBoost);
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


