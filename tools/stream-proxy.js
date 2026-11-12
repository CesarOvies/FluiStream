/**
 * FluiStream — Stream Bridge (Local & Serverless Streaming Proxy)
 * Contorna restrições de CORS, Mixed Content (HTTPS -> HTTP), 
 * redirects 302 com perda de cabeçalhos e reescreve manifests HLS/AES-128.
 * 
 * Uso local: node tools/stream-proxy.js [porta] (padrão 8787)
 */

import http from 'node:http';
import { URL } from 'node:url';

// Aceita certificados SSL de servidores IPTV com IPs puros ou autoassinados
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PORT = parseInt(process.env.PORT || process.argv[2] || '8787', 10);
const USER_AGENT = 'VLC/3.0.18 LibVLC/3.0.18';

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

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, X-Requested-With, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function rewriteM3U8(manifestText, targetBaseUrl, selfOrigin) {
  const lines = manifestText.split('\n');
  const base = new URL(targetBaseUrl);

  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Reescreve tags com URI (chaves de criptografia AES-128, inicialização, etc)
    if (trimmed.startsWith('#EXT-X-KEY:') || trimmed.startsWith('#EXT-X-MAP:')) {
      return trimmed.replace(/URI=["']([^"']+)["']/g, (match, uri) => {
        try {
          const absUri = new URL(uri, base).toString();
          return `URI="${selfOrigin}/?url=${encodeURIComponent(absUri)}"`;
        } catch {
          return match;
        }
      });
    }

    // Comentários e diretivas HLS permanecem intactos
    if (trimmed.startsWith('#')) return line;

    // Segmentos .ts / sub-playlists
    try {
      const absUrl = new URL(trimmed, base).toString();
      return `${selfOrigin}/?url=${encodeURIComponent(absUrl)}`;
    } catch {
      return line;
    }
  }).join('\n');
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Healthcheck para auto-detecção no FluiStream Web
  if (parsedUrl.pathname === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', name: 'FluiStream Stream Bridge', version: '1.0.0' }));
    return;
  }

  // Obter URL alvo (suporta ?url=, ?http..., ?/http..., ?/https%3A...)
  const targetUrl = extractTargetUrl(req.url);

  if (!targetUrl) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('FluiStream Stream Bridge ativo. Passe ?url=http://... para transmitir.');
    return;
  }

  try {
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstreamRes = await fetch(targetUrl, {
      headers,
      redirect: 'follow'
    });

    res.statusCode = upstreamRes.status;
    const contentType = upstreamRes.headers.get('content-type') || '';
    
    // Repassar cabeçalhos úteis
    if (upstreamRes.headers.has('content-type')) res.setHeader('Content-Type', contentType);
    if (upstreamRes.headers.has('content-length')) res.setHeader('Content-Length', upstreamRes.headers.get('content-length'));
    if (upstreamRes.headers.has('accept-ranges')) res.setHeader('Accept-Ranges', upstreamRes.headers.get('accept-ranges'));
    if (upstreamRes.headers.has('content-range')) res.setHeader('Content-Range', upstreamRes.headers.get('content-range'));

    const isM3U8 = contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL') || targetUrl.includes('.m3u8') || upstreamRes.url.includes('.m3u8');

    // Se for manifesto HLS, reescreve links relativos de segmentos e chave AES
    if (isM3U8 && upstreamRes.status === 200) {
      const manifestText = await upstreamRes.text();
      const selfOrigin = `http://${req.headers.host || `localhost:${PORT}`}`;
      const rewritten = rewriteM3U8(manifestText, upstreamRes.url, selfOrigin);
      const buf = Buffer.from(rewritten, 'utf-8');
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(buf);
      return;
    }

    // Se for vídeo binário (MP4, TS, MKV, chunk), transmite via stream sem carregar na memória
    if (upstreamRes.body) {
      const { Readable } = await import('node:stream');
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Erro no proxy para:', targetUrl, err.message);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Falha ao buscar stream upstream', details: err.message }));
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 FluiStream Stream Bridge iniciado em:`);
  console.log(`   http://127.0.0.1:${PORT}`);
  console.log(`   Healthcheck: http://127.0.0.1:${PORT}/health`);
  console.log(`   Configure no FluiStream Web: http://127.0.0.1:${PORT}/?`);
  console.log(`======================================================\n`);
});
