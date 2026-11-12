/**
 * FluiStream — Cloudflare Worker Streaming Reverse Proxy
 * Deploy gratuito em 1 clique no Cloudflare Workers (https://workers.cloudflare.com)
 * Permite reproduzir listas IPTV na versão Web (GitHub Pages / PWA / Celular / Smart TV)
 * com suporte a HTTPS, bypass de CORS, Range requests e reescrita de manifests HLS/AES-128.
 */

const USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type'
  };
}

function rewriteM3U8(manifestText, targetBaseUrl, workerOrigin) {
  const lines = manifestText.split('\n');
  const base = new URL(targetBaseUrl);

  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#EXT-X-KEY:') || trimmed.startsWith('#EXT-X-MAP:')) {
      return trimmed.replace(/URI=["']([^"']+)["']/g, (match, uri) => {
        try {
          const absUri = new URL(uri, base).toString();
          return `URI="${workerOrigin}/?url=${encodeURIComponent(absUri)}"`;
        } catch {
          return match;
        }
      });
    }

    if (trimmed.startsWith('#')) return line;

    try {
      const absUrl = new URL(trimmed, base).toString();
      return `${workerOrigin}/?url=${encodeURIComponent(absUrl)}`;
    } catch {
      return line;
    }
  }).join('\n');
}

function extractTargetUrl(reqUrl) {
  try {
    const parsed = new URL(reqUrl, 'http://localhost');
    const param = parsed.searchParams.get('url');
    if (param) return decodeURIComponent(param);
  } catch {}

  let raw = reqUrl.replace(/^\/+(\?+\/*)?/, '');
  if (raw.startsWith('url=')) raw = raw.substring(4);
  
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded;
  } catch {}

  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;

  const encHttpsIdx = reqUrl.indexOf('https%3A');
  if (encHttpsIdx !== -1) return decodeURIComponent(reqUrl.substring(encHttpsIdx));
  const encHttpIdx = reqUrl.indexOf('http%3A');
  if (encHttpIdx !== -1) return decodeURIComponent(reqUrl.substring(encHttpIdx));
  const httpsIdx = reqUrl.indexOf('https://');
  if (httpsIdx !== -1) return reqUrl.substring(httpsIdx);
  const httpIdx = reqUrl.indexOf('http://');
  if (httpIdx !== -1) return reqUrl.substring(httpIdx);

  return null;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const reqUrl = new URL(request.url);

    if (reqUrl.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'FluiStream CF Worker' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    const targetUrl = extractTargetUrl(reqUrl.pathname + reqUrl.search);

    if (!targetUrl) {
      return new Response('FluiStream Cloudflare Worker ativo. Use ?url=http://...', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() }
      });
    }

    const headers = new Headers({
      'User-Agent': USER_AGENT,
      'Accept': '*/*'
    });

    const clientRange = request.headers.get('range');
    if (clientRange) {
      headers.set('Range', clientRange);
    }

    try {
      const upstreamRes = await fetch(targetUrl, {
        headers,
        redirect: 'follow'
      });

      const responseHeaders = new Headers(corsHeaders());
      for (const [key, value] of upstreamRes.headers.entries()) {
        if (!key.toLowerCase().startsWith('access-control-')) {
          responseHeaders.set(key, value);
        }
      }

      const contentType = upstreamRes.headers.get('content-type') || '';
      const isM3U8 = contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL') || targetUrl.includes('.m3u8') || upstreamRes.url.includes('.m3u8');

      if (isM3U8 && upstreamRes.status === 200) {
        const text = await upstreamRes.text();
        const rewritten = rewriteM3U8(text, upstreamRes.url, reqUrl.origin);
        responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
        responseHeaders.delete('content-length');
        return new Response(rewritten, {
          status: 200,
          headers: responseHeaders
        });
      }

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }
  }
};

