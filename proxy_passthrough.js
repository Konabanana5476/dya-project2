// ダイナマイト野球 オンラインプロキシ
// Phase 1: HTTP passthrough to https://dya.jp
//
// 起動: node proxy.js
// アクセス: http://localhost:8080/

const http = require('http');
const https = require('https');

const PORT = 8080;
const UPSTREAM_HOST = 'dya.jp';
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`;
const LOCAL_ORIGIN = `http://localhost:${PORT}`;

function rewriteRequestHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v;
  }
  out['host'] = UPSTREAM_HOST;
  if (out['origin'] && /localhost/i.test(out['origin'])) {
    out['origin'] = UPSTREAM_ORIGIN;
  }
  if (out['referer'] && /localhost/i.test(out['referer'])) {
    out['referer'] = out['referer'].replace(/^http:\/\/localhost:\d+/i, UPSTREAM_ORIGIN);
  }
  // Phase 2 以降のレスポンス本文書換に備えて圧縮を無効化
  out['accept-encoding'] = 'identity';
  return out;
}

function rewriteResponseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();

    // localhost で受け取れない / 注入を阻害するヘッダは除去
    if (key === 'content-security-policy' ||
        key === 'content-security-policy-report-only' ||
        key === 'strict-transport-security' ||
        key === 'public-key-pins' ||
        key === 'public-key-pins-report-only' ||
        key === 'x-frame-options' ||
        key === 'cross-origin-opener-policy' ||
        key === 'cross-origin-embedder-policy' ||
        key === 'cross-origin-resource-policy') {
      continue;
    }

    if (key === 'set-cookie') {
      const cookies = Array.isArray(v) ? v : [v];
      out[k] = cookies.map(c =>
        c.replace(/;\s*Domain=[^;]+/gi, '')
         .replace(/;\s*Secure/gi, '')
         .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
      );
      continue;
    }

    if (key === 'location' && typeof v === 'string') {
      out[k] = v
        .replace(/^https?:\/\/(?:www\.)?dya\.jp/i, LOCAL_ORIGIN)
        .replace(/^\/\/(?:www\.)?dya\.jp/i, LOCAL_ORIGIN);
      continue;
    }

    if (key === 'access-control-allow-origin') {
      out[k] = LOCAL_ORIGIN;
      continue;
    }

    out[k] = v;
  }
  return out;
}

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  const upstreamReq = https.request({
    hostname: UPSTREAM_HOST,
    port: 443,
    path: req.url,
    method: req.method,
    headers: rewriteRequestHeaders(req.headers),
  }, (upstreamRes) => {
    const newHeaders = rewriteResponseHeaders(upstreamRes.headers);
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, newHeaders);
    upstreamRes.pipe(res);
    upstreamRes.on('end', () => {
      console.log(`[${upstreamRes.statusCode}] ${req.method} ${req.url}  (${Date.now()-startedAt}ms)`);
    });
  });

  upstreamReq.on('error', (err) => {
    console.error(`[ERR] ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('Upstream error: ' + err.message);
  });

  req.pipe(upstreamReq);
  req.on('error', () => upstreamReq.destroy());
});

server.on('upgrade', (req, socket /*, head */) => {
  // Phase 3 で実装。とりあえず拒否しておく。
  console.warn(`[upgrade] not implemented yet: ${req.url}`);
  socket.write('HTTP/1.1 501 Not Implemented\r\n\r\n');
  socket.destroy();
});

server.listen(PORT, () => {
  console.log(`[proxy] ${LOCAL_ORIGIN}/  ->  ${UPSTREAM_ORIGIN}/`);
  console.log('[proxy] Phase 1 (HTTP passthrough) ready. Open the URL in your browser.');
});
