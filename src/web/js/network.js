/**
 * FluiStream — Network / Remote Fetch Service
 * Realiza requisições HTTP/HTTPS com bypass nativo no Desktop (C# WebView2 bridge)
 * e fallback inteligente via CORS proxy no ambiente Web.
 */

import { storage } from './storage.js';

let nextFetchId = 1;
const pendingFetches = new Map();

// Configura listener global para respostas de NATIVE_FETCH via postMessage se necessário
if (typeof window !== 'undefined') {
  window.__onNativeFetchResult = (reqId, success, content, error) => {
    const p = pendingFetches.get(reqId);
    if (!p) return;
    pendingFetches.delete(reqId);
    if (success) {
      p.resolve(content);
    } else {
      p.reject(new Error(error || 'Erro na requisição nativa'));
    }
  };
}

async function decodeResponseText(res) {
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('gzip');
        const decompressedStream = new Response(buffer).body.pipeThrough(ds);
        return await new Response(decompressedStream).text();
      } catch (e) {
        console.warn('Falha no DecompressionStream gzip:', e);
      }
    }
  }
  return new TextDecoder('utf-8').decode(buffer);
}

export function applyCorsProxy(proxy, url) {
  if (!proxy || !url || url.startsWith('blob:') || url.startsWith('data:')) return url;
  const p = proxy.trim();
  if (!p) return url;
  if (url.includes('/proxy?url=') || url.includes('?url=')) return url;
  const enc = encodeURIComponent(url);
  if (p.endsWith('?') || p.endsWith('=')) return `${p}${enc}`;
  if (p.endsWith('/')) return `${p}${enc}`;
  return `${p}/${enc}`;
}

export async function fetchRemoteText(url, timeoutMs = 60000) {
  if (!url) throw new Error('URL inválida');

  // 1. Tentar Host Object nativo do WebView2 (Desktop C#)
  if (typeof window !== 'undefined' && window.chrome?.webview?.hostObjects?.nativeBridge) {
    try {
      const result = await window.chrome.webview.hostObjects.nativeBridge.FetchTextAsync(url);
      if (typeof result === 'string') {
        return result;
      }
    } catch (e) {
      console.warn('nativeBridge HostObject fetch falhou, tentando fallback postMessage:', e);
    }
  }

  // 2. Tentar Mensageria WebView2 postMessage (Desktop C#)
  if (typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
    try {
      const text = await new Promise((resolve, reject) => {
        const id = 'fetch_' + (nextFetchId++);
        const timer = setTimeout(() => {
          pendingFetches.delete(id);
          reject(new Error(`Timeout ao baixar URL nativamente (${Math.round(timeoutMs / 1000)}s)`));
        }, timeoutMs);

        pendingFetches.set(id, {
          resolve: (val) => { clearTimeout(timer); resolve(val); },
          reject: (err) => { clearTimeout(timer); reject(err); }
        });

        window.chrome.webview.postMessage({
          type: 'NATIVE_FETCH',
          id,
          url
        });
      });
      return text;
    } catch (msgErr) {
      console.warn('postMessage NATIVE_FETCH falhou, tentando fetch direto:', msgErr);
    }
  }

  // 3. Tentar Ponte Nativa Android (window.androidBridge)
  if (typeof window !== 'undefined' && window.androidBridge?.fetchText) {
    try {
      const result = await Promise.resolve(window.androidBridge.fetchText(url, timeoutMs));
      if (typeof result === 'string') {
        return result;
      }
    } catch (e) {
      const errMsg = e && typeof e === 'object' && 'message' in e ? e.message : String(e || '');
      throw new Error(errMsg || 'Falha ao baixar dados remotos');
    }
    throw new Error('Resposta inválida da ponte nativa Android');
  }

  // 3. Obter proxy local ativo (CrossPlatformHost no macOS/Linux ou bridge local)
  const localProxyPrefix = (typeof window !== 'undefined' && typeof window.__fluiLocalProxyUrl === 'string' && window.__fluiLocalProxyUrl.trim())
    ? (window.__fluiLocalProxyUrl.trim().endsWith('/') ? window.__fluiLocalProxyUrl.trim() : `${window.__fluiLocalProxyUrl.trim()}/`)
    : '';

  // 4. Tentativa direta com fetch padrão (Web / PWA)
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      signal: controller ? controller.signal : undefined,
      headers: {
        'Accept': '*/*'
      }
    });
    if (timeoutId) clearTimeout(timeoutId);
    if (res.ok) {
      return await decodeResponseText(res);
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);

    // 5. Fallback com Proxy CORS ou Bridge Local (CrossPlatformHost)
    const cfg = storage.getSettings();
    let proxy = (cfg.corsProxy || '').trim();
    if (!proxy && localProxyPrefix) {
      proxy = `${localProxyPrefix}proxy?url=`;
    }
    if (!proxy) {
      proxy = 'https://api.allorigins.win/raw?url=';
    }
    const proxiedUrl = applyCorsProxy(proxy, url);

    if (proxiedUrl !== url) {
      const proxyController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const proxyTimeoutId = proxyController ? setTimeout(() => proxyController.abort(), timeoutMs) : null;
      try {
        const proxyRes = await fetch(proxiedUrl, {
          signal: proxyController ? proxyController.signal : undefined,
          headers: { 'Accept': '*/*' }
        });
        if (proxyRes.ok) {
          return await decodeResponseText(proxyRes);
        }
        throw new Error(`HTTP ${proxyRes.status} via Proxy`);
      } catch (proxyErr) {
        throw new Error(err.message || proxyErr.message || 'Falha ao buscar dados remotos');
      } finally {
        if (proxyTimeoutId) clearTimeout(proxyTimeoutId);
      }
    }

    throw new Error(err.message || 'Falha ao buscar dados remotos');
  }
}

