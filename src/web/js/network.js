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

  // 3. Tentativa direta com fetch padrão (Web / PWA)
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

    // 4. Fallback com Proxy CORS se falhou no navegador
    const cfg = storage.getSettings();
    const proxy = cfg.corsProxy || 'https://api.allorigins.win/raw?url=';
    const proxiedUrl = proxy.endsWith('/') ? `${proxy}${encodeURIComponent(url)}` : `${proxy}/${encodeURIComponent(url)}`;

    try {
      const proxyRes = await fetch(proxiedUrl);
      if (proxyRes.ok) {
        return await decodeResponseText(proxyRes);
      }
      throw new Error(`HTTP ${proxyRes.status} via Proxy`);
    } catch (proxyErr) {
      throw new Error(err.message || 'Falha ao buscar dados remotos');
    }
  }
}

