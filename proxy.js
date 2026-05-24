// ダイナマイト野球 オンラインプロキシ
// 役割:
//   1. 自前ビルドの dya_online.html を http://localhost:8080/ で配信
//   2. /__proxy/<host>/<path...> を https://<host>/<path...> に中継（HTTP）
//   3. WebSocket Upgrade も同経路で wss://<host>/<path...> に中継
// 起動: node proxy.js

const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ONLINE_HTML_PATH = path.join(__dirname, 'dya_online.html');
const OFFLINE_HTML_PATH = path.join(__dirname, 'dya_offline.html');
const EDITOR_ROOT = path.join(__dirname, 'team_editor');
const EDITOR_HTML_PATH = path.join(EDITOR_ROOT, 'static', 'index.html');
const EDITOR_CSS_PATH = path.join(EDITOR_ROOT, 'static', 'editor.css');
const EDITOR_JS_PATH = path.join(EDITOR_ROOT, 'static', 'editor.js');
const EDITOR_DEFAULTS_PATH = path.join(EDITOR_ROOT, 'default_teams.json');
const PROXY_PREFIX = '/__proxy/';

// Render 経由だと毎リクエストで TLS ハンドシェイクが発生 → 上流（dya.jp 等）が
// ときどき ECONNRESET / socket hang up を返して 502 が出る。keep-alive プールを
// 使い回すことでハンドシェイク回数と transient 失敗を激減させる。
const UPSTREAM_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30 * 1000,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60 * 1000,
});

// 上流リクエスト全体のタイムアウト（秒）。これより長く返答が来なければ destroy。
const UPSTREAM_TIMEOUT_MS = 30 * 1000;
// 一過性エラー時のリトライ対象コード。GET のみリトライする（POST はサーバ側 mytm 等の
// 副作用が二重に走る恐れがあるためリトライしない）。
const RETRY_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);

// ===== PIN 認証 =====
// PIN は `PROXY_AUTH_PIN` 環境変数で上書き可能。未指定なら下のデフォルト ("231125") を使用。
// Render / Fly.io にデプロイする場合は dashboard の env vars で同じ値（または別 PIN）を設定。
const AUTH_PIN = process.env.PROXY_AUTH_PIN || '231125';
const AUTH_REQUIRED = AUTH_PIN.length > 0;
const AUTH_COOKIE_NAME = 'dya_auth';
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;   // 30 日

function isHttps(req) {
  // Fly.io 等のリバースプロキシは X-Forwarded-Proto: https を付ける。
  return (req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
      || (req.connection && req.connection.encrypted);
}
function getCookie(req, name) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function isAuthed(req) {
  if (!AUTH_REQUIRED) return true;
  return getCookie(req, AUTH_COOKIE_NAME) === AUTH_PIN;
}
function setAuthCookie(req, res) {
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(AUTH_PIN)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${AUTH_COOKIE_MAX_AGE}`);
}

// 認証画面（画面テンキー / スマホ最適化済 / Safe-area 対応）
function renderAuthHtml(failed) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<title>暗証番号</title>
<style>
  :root{ color-scheme: dark; }
  html,body{margin:0;padding:0;height:100%;background:#0a0a14;color:#fff;font-family:sans-serif;-webkit-text-size-adjust:100%;-webkit-user-select:none;user-select:none;}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    box-sizing:border-box;}
  h1{font-size:clamp(20px, 6vmin, 28px);margin:0 0 6px;letter-spacing:.05em;}
  .sub{font-size:clamp(12px, 3.5vmin, 14px);color:#aaa;margin-bottom:18px;text-align:center;}
  form{width:100%;max-width:340px;display:flex;flex-direction:column;align-items:stretch;gap:14px;}
  .display{
    width:100%;box-sizing:border-box;
    padding:clamp(14px, 4vmin, 20px) clamp(14px, 4vmin, 18px);
    font-size:clamp(22px, 7vmin, 32px);font-family:monospace;text-align:center;letter-spacing:.45em;
    background:#1a1a26;color:#fff;border:2px solid #444;border-radius:12px;
    min-height:1.4em;line-height:1.4;
  }
  .display.has{border-color:#7a7aff;color:#9cb;}
  .keypad{
    display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px, 2.5vmin, 12px);
    width:100%;
  }
  .key{
    box-sizing:border-box;
    padding:clamp(14px, 4.5vmin, 22px) 0;
    font-size:clamp(22px, 6.5vmin, 30px);font-weight:bold;font-family:inherit;
    background:#23252e;color:#fff;
    border:2px solid #444;border-radius:14px;cursor:pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition:background .08s, transform .05s;
    min-height:56px;
  }
  .key:active{background:#3a3d4a;transform:scale(0.96);}
  .key.act-clear{background:#3a2828;color:#ffb0b0;}
  .key.act-back{background:#2a3338;color:#a0d8ff;font-size:clamp(20px, 5.5vmin, 26px);}
  .key.act-clear:active{background:#5a3838;}
  .key.act-back:active{background:#3a4858;}
  .submit{
    width:100%;box-sizing:border-box;
    padding:clamp(14px, 4vmin, 18px) clamp(20px, 5vmin, 28px);
    font-size:clamp(18px, 5vmin, 22px);font-weight:bold;
    background:linear-gradient(180deg,#3a8ec8,#1c4a78);color:#fff;
    border:2px solid #fff;border-radius:14px;cursor:pointer;
    -webkit-tap-highlight-color: transparent;
    min-height:56px;
  }
  .submit:active{transform:translateY(1px);}
  .err{color:#ff8a8a;font-size:clamp(12px, 3.5vmin, 14px);margin-top:6px;text-align:center;${failed ? '' : 'display:none;'}}
  .note{font-size:clamp(10px, 3vmin, 12px);color:#666;margin-top:24px;text-align:center;line-height:1.6;max-width:280px;}
</style>
</head>
<body>
  <h1>🔒 暗証番号</h1>
  <div class="sub">アクセスには暗証番号が必要です</div>
  <form method="POST" action="/auth" id="pinform">
    <div class="display" id="disp">　</div>
    <input type="hidden" name="pin" id="pin">
    <div class="keypad" id="pad">
      <button type="button" class="key" data-k="1">1</button>
      <button type="button" class="key" data-k="2">2</button>
      <button type="button" class="key" data-k="3">3</button>
      <button type="button" class="key" data-k="4">4</button>
      <button type="button" class="key" data-k="5">5</button>
      <button type="button" class="key" data-k="6">6</button>
      <button type="button" class="key" data-k="7">7</button>
      <button type="button" class="key" data-k="8">8</button>
      <button type="button" class="key" data-k="9">9</button>
      <button type="button" class="key act-clear" data-k="C">C</button>
      <button type="button" class="key" data-k="0">0</button>
      <button type="button" class="key act-back" data-k="B">⌫</button>
    </div>
    <button type="submit" class="submit">入る</button>
    <div class="err">暗証番号が違います</div>
  </form>
  <div class="note">※ 数字をタップで入力。物理キーボードからの数字 / Backspace / Enter も使えます。<br>※ 認証は cookie で 30 日保存されます。</div>
<script>
(function(){
  var pin = '';
  var max = 32;
  var inp = document.getElementById('pin');
  var disp = document.getElementById('disp');
  var form = document.getElementById('pinform');
  function render(){
    inp.value = pin;
    if(pin.length === 0){
      disp.textContent = '\\u3000';
      disp.classList.remove('has');
    } else {
      var s = '';
      for(var i=0;i<pin.length;i++) s += '\\u25CF';
      disp.textContent = s;
      disp.classList.add('has');
    }
  }
  function input(k){
    if(k === 'C'){ pin = ''; }
    else if(k === 'B'){ pin = pin.slice(0, -1); }
    else if(/^[0-9]$/.test(k)){ if(pin.length < max) pin += k; }
    render();
  }
  document.getElementById('pad').addEventListener('click', function(e){
    var b = e.target.closest('[data-k]');
    if(!b) return;
    input(b.getAttribute('data-k'));
  });
  // 物理キーボード対応
  document.addEventListener('keydown', function(e){
    if(/^[0-9]$/.test(e.key)){ input(e.key); e.preventDefault(); return; }
    if(e.key === 'Backspace'){ input('B'); e.preventDefault(); return; }
    if(e.key === 'Delete' || (e.key === 'Escape')){ input('C'); e.preventDefault(); return; }
    if(e.key === 'Enter'){ if(pin.length > 0) form.submit(); e.preventDefault(); return; }
  });
  form.addEventListener('submit', function(e){
    if(pin.length === 0){ e.preventDefault(); }
  });
  render();
})();
</script>
</body>
</html>`;
}

function serveAuthForm(req, res, id, failed) {
  const html = renderAuthHtml(failed);
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(failed ? 401 : 200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': buf.length,
  });
  res.end(buf);
  log('AUTH', id, `${failed ? '✗' : '→'} auth form  ip=${clientIp(req)}`);
}

function handleAuthPost(req, res, id) {
  let body = '';
  let aborted = false;
  req.on('data', (c) => {
    body += c.toString('utf8');
    if (body.length > 1024) { aborted = true; req.destroy(); }
  });
  req.on('end', () => {
    if (aborted) return;
    let pin = '';
    try { pin = new URLSearchParams(body).get('pin') || ''; } catch (_) {}
    const ip = clientIp(req);
    if (pin === AUTH_PIN) {
      setAuthCookie(req, res);
      res.writeHead(303, { 'Location': '/' });
      res.end();
      log('AUTH', id, `✓ login success  ip=${ip}`);
    } else {
      // brute force 防止に短く待つ
      setTimeout(() => serveAuthForm(req, res, id, true), 500);
      log('AUTH', id, `✗ login fail  ip=${ip}  pin_len=${pin.length}`);
    }
  });
}

// ===== ランチャー（/） =====
// 毎回 オンライン/オフライン × 通常/チート を選ばせる。選択後、対応する HTML へ遷移。
// localStorage には保存しない（毎回選び直す要件のため）。
const LAUNCHER_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<title>ダイナマイト野球（起動モード選択）</title>
<style>
  :root{ color-scheme: dark; }
  html,body{margin:0;padding:0;min-height:100%;background:#0a0a14;color:#fff;font-family:sans-serif;-webkit-text-size-adjust:100%;}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;
    padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    box-sizing:border-box;}
  h1{font-size:clamp(20px, 6vmin, 26px);margin:0 0 6px;letter-spacing:.05em;text-align:center;}
  .sub{font-size:clamp(12px, 3.5vmin, 14px);color:#aaa;margin-bottom:24px;text-align:center;}
  .grid{display:grid;grid-template-columns:repeat(2, minmax(0,1fr));gap:clamp(12px, 3vmin, 20px);max-width:760px;width:100%;}
  a.card{display:block;padding:clamp(16px, 4vmin, 22px) clamp(18px, 4.5vmin, 24px);border-radius:14px;text-decoration:none;color:#fff;text-align:left;cursor:pointer;border:2px solid #888;transition:transform .08s ease, box-shadow .12s ease;-webkit-tap-highlight-color: transparent;}
  a.card:hover{transform:translateY(-2px);}
  a.card:active{transform:translateY(1px);}
  a.card .ttl{font-size:clamp(16px, 4.5vmin, 21px);font-weight:bold;margin-bottom:6px;}
  a.card .desc{font-size:clamp(11px, 3vmin, 13px);color:#cdd;line-height:1.5;}
  a.card.online-normal{background:linear-gradient(180deg,#3a8ec8,#1c4a78);}
  a.card.online-cheat{background:linear-gradient(180deg,#9d4cff,#5818b6);border-color:#fff;box-shadow:0 0 14px rgba(160,80,255,0.5);}
  a.card.offline-normal{background:linear-gradient(180deg,#5b6478,#2a2f3a);}
  a.card.offline-cheat{background:linear-gradient(180deg,#cc6644,#7a3018);border-color:#fff;box-shadow:0 0 14px rgba(255,120,80,0.4);}
  a.card.offline-saved{background:linear-gradient(180deg,#1ea27a,#0a4d3a);border-color:#fff;box-shadow:0 0 14px rgba(60,210,150,0.5);grid-column:1/-1;}
  a.card.offline-original{background:linear-gradient(180deg,#c8a83a,#7a5e10);border-color:#fff;box-shadow:0 0 14px rgba(220,180,80,0.5);grid-column:1/-1;}
  a.card.editor{background:linear-gradient(180deg,#9c5fc8,#4d2378);border-color:#fff;box-shadow:0 0 14px rgba(180,120,220,0.5);grid-column:1/-1;}
  .note{font-size:clamp(10px, 3vmin, 12px);color:#666;margin-top:24px;max-width:600px;text-align:center;line-height:1.6;}
  code{background:#222;padding:1px 5px;border-radius:4px;font-size:0.95em;}
  @media (max-width:560px){ .grid{grid-template-columns:1fr;} }
</style>
</head>
<body>
  <h1>ダイナマイト野球（プロキシ版）</h1>
  <div class="sub">起動モードを選んでください</div>
  <div class="grid">
    <a class="card online-normal" href="/online?cheat=0">
      <div class="ttl">🌐 オンライン × 通常</div>
      <div class="desc">本家サーバ接続。ログイン・マイチーム・対戦。本家と同じ挙動でプレイ。</div>
    </a>
    <a class="card online-cheat" href="/online?cheat=1">
      <div class="ttl">🌐🎯 オンライン × チート</div>
      <div class="desc">本家サーバ接続。来球プレビュー HUD ／ HR ボタン ／ BEST ボタン ／ 期限切れ無視 ／ 絶好調 3 人 など。</div>
    </a>
    <a class="card offline-normal" href="/offline?cheat=0">
      <div class="ttl">📴 オフライン × 通常</div>
      <div class="desc">CPU 専用。サーバ通信なし。本家と同じ CPU 戦挙動。</div>
    </a>
    <a class="card offline-cheat" href="/offline?cheat=1">
      <div class="ttl">📴🎯 オフライン × チート</div>
      <div class="desc">CPU 専用。チートフラグは ON だが、現状オフライン専用のチート機能は未実装（将来拡張用）。</div>
    </a>
    <a class="card offline-saved" href="/offline?saved=1&amp;cheat=1">
      <div class="ttl">💾 オフラインで保存データログイン</div>
      <div class="desc">過去にオンラインでログインしたユーザのデータをローカルから replay。ネット無しでログイン・マイチーム・打順・CPU 戦が可能。一度オンラインでログイン済みであることが前提。</div>
    </a>
    <a class="card offline-original" href="/offline?original=1&amp;cheat=1">
      <div class="ttl">🏟️ オリジナルチーム CPU対戦</div>
      <div class="desc">起動後にチーム編集ツールでダウンロードした JSON ファイル（<code>original_teams_*.json</code>）をアップロードして CPU 対戦。タブを閉じるまで再アップロード不要。</div>
    </a>
    <a class="card editor" href="/editor">
      <div class="ttl">🛠️ チーム編集ツール</div>
      <div class="desc">252 選手の能力・特殊能力・調子を編集 → 💾 JSON ダウンロード → 「🏟️ オリジナルチーム CPU対戦」でアップロードしてプレイ。同じ JSON を別端末で読み込めば編集も続行可能。</div>
    </a>
  </div>
  <div class="note">※ 毎回このランチャーから選び直せます。リロード時は <code>/</code> に戻すと再選択。<br>※ ブックマークから直接 <code>/online?cheat=1</code> 等にアクセスしても OK。<br>※ 「💾 保存データログイン」は同ブラウザの <code>localStorage</code> にプロフィールが保存されている場合のみ動作。</div>
</body>
</html>`;

// 中継許可 upstream ホスト（安全のため allowlist）
const ALLOWED_HOSTS = [
  'dya.jp', 'www.dya.jp', 'db.dya.jp',
  'play.splax.net', 'splax.net',
  'sv2.splaxserver.net', 'splaxserver.net',
];

function isAllowed(host) {
  const h = host.split(':')[0].toLowerCase();
  return ALLOWED_HOSTS.some(a => h === a || h.endsWith('.' + a));
}

// /__proxy/<host>/<path...>  -> { host, port, path }
function parseProxyUrl(reqUrl) {
  if (!reqUrl.startsWith(PROXY_PREFIX)) return null;
  const rest = reqUrl.slice(PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  const hostPart = slash < 0 ? rest : rest.slice(0, slash);
  const pathPart = slash < 0 ? '/' : rest.slice(slash);
  const [host, portStr] = hostPart.split(':');
  const port = portStr ? parseInt(portStr, 10) : 443;
  return { host, port, path: pathPart || '/' };
}

function rewriteRequestHeaders(headers, upstreamHost) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[k] = v;
  out['host'] = upstreamHost;
  if (out['origin']) out['origin'] = 'https://' + upstreamHost.replace(/:\d+$/, '');
  if (out['referer']) {
    // proxy 経由の Referer (http://<localhost or LAN IP>:PORT/__proxy/<host>/...) を
    // upstream 形式 (https://<host>/...) に書き戻す。LAN 端末からのアクセスにも対応。
    out['referer'] = out['referer']
      .replace(new RegExp('^https?://[^/]+' + PROXY_PREFIX + '([^/]+)'), 'https://$1');
  }
  // 後段の書換に備えて圧縮無効化
  out['accept-encoding'] = 'identity';
  return out;
}

function rewriteResponseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key === 'content-security-policy' ||
        key === 'content-security-policy-report-only' ||
        key === 'strict-transport-security' ||
        key === 'public-key-pins' ||
        key === 'public-key-pins-report-only' ||
        key === 'x-frame-options' ||
        key === 'cross-origin-opener-policy' ||
        key === 'cross-origin-embedder-policy' ||
        key === 'cross-origin-resource-policy') continue;

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
      // 上流の Location: https://host/path -> /__proxy/host/path
      const m = v.match(/^https?:\/\/([^/]+)(\/.*)?$/i);
      if (m && isAllowed(m[1])) {
        out[k] = PROXY_PREFIX + m[1] + (m[2] || '/');
        continue;
      }
    }

    if (key === 'access-control-allow-origin') {
      out[k] = '*';
      continue;
    }

    out[k] = v;
  }
  return out;
}

// === ログ helper ===
let reqCounter = 0;
function nextReqId() {
  reqCounter = (reqCounter + 1) % 100000;
  return reqCounter.toString().padStart(5, '0');
}
function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?B';
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1024 / 1024).toFixed(2) + 'MB';
}
function clientIp(req) {
  let ip = (req.socket && req.socket.remoteAddress) || '?';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);   // IPv4-mapped IPv6 を整形
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}
function shortStr(s, max) {
  if (!s) return '';
  s = String(s);
  return s.length <= max ? s : s.slice(0, max) + '…';
}
// レベル毎にラベル幅を揃えて grep しやすくする
function log(level, id, msg) {
  const lvl = level.padEnd(4, ' ');
  const idStr = id ? `#${id} ` : '';
  console.log(`${ts()} [${lvl}] ${idStr}${msg}`);
}

function serveLauncher(req, res, id) {
  const ip = clientIp(req);
  log('HTML', id, `→ GET / (launcher)  ip=${ip}`);
  const buf = Buffer.from(LAUNCHER_HTML, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': buf.length,
  });
  res.end(buf);
  log('HTML', id, `← 200  launcher  out=${fmtBytes(buf.length)}`);
}

// チーム編集ツール: index.html / editor.css / editor.js / default_teams.json を
// 読み込んで単一 HTML にバンドルし配信。クライアント完結（fetch なし）。
// ファイル更新を即反映できるよう毎回読み直す（小さいので I/O 負荷は無視）。
function serveEditor(req, res, id) {
  const ip = clientIp(req);
  log('HTML', id, `→ GET /editor  ip=${ip}`);
  const startedAt = Date.now();
  let html, css, js, defaults;
  try {
    html = fs.readFileSync(EDITOR_HTML_PATH, 'utf8');
    css = fs.readFileSync(EDITOR_CSS_PATH, 'utf8');
    js = fs.readFileSync(EDITOR_JS_PATH, 'utf8');
    defaults = fs.readFileSync(EDITOR_DEFAULTS_PATH, 'utf8');
  } catch (e) {
    log('ERR', id, `✗ editor asset read fail: ${e.message}`);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Editor asset load error: ' + e.message);
  }
  // </script> リテラルが defaults JSON 中に出ると HTML パースが崩れるのでエスケープ
  const safeDefaults = defaults.replace(/<\/script>/gi, '<\\/script>');
  const out = html
    .replace(/<link\s+rel="stylesheet"\s+href="\/static\/editor\.css"\s*>/i,
             `<style>\n${css}\n</style>`)
    .replace(/<script\s+src="\/static\/editor\.js"><\/script>/i,
             `<script>window.__EDITOR_DEFAULTS=${safeDefaults};</script>\n<script>\n${js}\n</script>`);
  const buf = Buffer.from(out, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': buf.length,
  });
  res.end(buf);
  const ms = Date.now() - startedAt;
  log('HTML', id, `← 200  editor  out=${fmtBytes(buf.length)}  ${ms}ms`);
}

// 注: かつて serveOriginalHtml で custom_teams.json を inline 注入していたが、
// オリジナルチーム対戦を「JSON アップロードのみ」に統一したため撤去。
// /offline?original=1 は serveHtml で素の dya_offline.html を返し、
// bootstrap がアップロード overlay を出す（sessionStorage キャッシュあり）。

function serveHtml(req, res, id, htmlPath, label, buildHint) {
  const ip = clientIp(req);
  const ua = shortStr(req.headers['user-agent'] || '', 80);
  log('HTML', id, `→ GET ${req.url}  (${label})  ip=${ip}  ua="${ua}"`);
  const startedAt = Date.now();
  fs.readFile(htmlPath, (err, buf) => {
    const ms = Date.now() - startedAt;
    if (err) {
      log('ERR', id, `✗ HTML read fail: ${err.message}  (${ms}ms)`);
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Failed to read ' + htmlPath + ': ' + err.message + '\nRun: ' + buildHint);
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': buf.length,
    });
    res.end(buf);
    log('HTML', id, `← 200  ${label}  out=${fmtBytes(buf.length)}  ${ms}ms`);
  });
}

// dya.js が送る telemetry/レポート系エンドポイント。
// これらは upstream で 500 を返してログを汚すだけでゲーム進行に無関係。
// 上流に投げず即座に 204 を返してログをクリーンに保つ。
const TELEMETRY_PATH_RE = /^\/gk\/oraaq\d+\.cgi(?:\?|$)/;

function handleProxy(req, res, parsed, id) {
  const ip = clientIp(req);
  const target = `${parsed.host}${parsed.path}`;
  const cl = req.headers['content-length'];
  const ref = shortStr(req.headers['referer'] || '', 80);

  if (!isAllowed(parsed.host)) {
    log('DENY', id, `✗ host not in allowlist: ${parsed.host}  ip=${ip}`);
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Host not in allowlist: ' + parsed.host);
    return;
  }
  if (TELEMETRY_PATH_RE.test(parsed.path)) {
    req.resume(); // body を読み捨てて upstreamReq 作成を回避
    res.writeHead(204, { 'access-control-allow-origin': '*' });
    res.end();
    log('STUB', id, `${req.method} ${target}  ← 204 (telemetry suppressed)  ip=${ip}`);
    return;
  }

  log('HTTP', id, `→ ${req.method} ${target}  ip=${ip}  cl=${cl||'-'}  ref="${ref}"`);

  let reqBytes = 0;
  let resBytes = 0;
  // POST 等の body をバッファして retry 時に再送できるようにする。
  // bodyless（GET/HEAD）は基本的にバッファ不要だが、Content-Length=0 でも req.on('data')
  // は来ないので空配列のまま retry 可能。
  // 注意: 大きすぎる upload は Render free の RAM (256MB) で詰まる可能性があるため上限を設ける。
  // ゲーム本家の通信は大きくて数 KB なので 1MB あれば十分。
  const BODY_BUFFER_LIMIT = 1024 * 1024;
  let bodyBuf = [];
  let bodyTooBig = false;
  req.on('data', (c) => {
    reqBytes += c.length;
    if (!bodyTooBig) {
      bodyBuf.push(c);
      const total = bodyBuf.reduce((a, b) => a + b.length, 0);
      if (total > BODY_BUFFER_LIMIT) { bodyTooBig = true; bodyBuf = null; }
    }
  });

  const isRetryableMethod = req.method === 'GET' || req.method === 'HEAD';
  let attempt = 0;
  const startedAt = Date.now();

  function sendOnce() {
    attempt++;
    const attemptStart = Date.now();
    const upstreamReq = https.request({
      hostname: parsed.host,
      port: parsed.port,
      path: parsed.path,
      method: req.method,
      headers: rewriteRequestHeaders(req.headers, parsed.host + (parsed.port !== 443 ? ':' + parsed.port : '')),
      agent: UPSTREAM_AGENT,
    }, (upstreamRes) => {
      const newHeaders = rewriteResponseHeaders(upstreamRes.headers);
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, newHeaders);
      upstreamRes.on('data', (c) => { resBytes += c.length; });
      upstreamRes.pipe(res);
      upstreamRes.on('end', () => {
        const ms = Date.now() - startedAt;
        const sc = upstreamRes.statusCode || 0;
        const lvl = sc >= 500 ? 'ERR' : sc >= 400 ? 'WARN' : 'HTTP';
        const retryTag = attempt > 1 ? ` (retry ${attempt-1})` : '';
        log(lvl, id, `← ${sc} ${upstreamRes.statusMessage||''}  ${target}${retryTag}  in=${fmtBytes(reqBytes)} out=${fmtBytes(resBytes)}  ${ms}ms`);
      });
      upstreamRes.on('aborted', () => {
        log('WARN', id, `↯ upstream response aborted mid-stream  ${target}  out=${fmtBytes(resBytes)}`);
      });
      upstreamRes.on('error', (err) => {
        log('ERR', id, `✗ upstream response stream error ${target}: ${err.code||''} ${err.message}`);
        // ヘッダ送信済なので socket を切るしかない
        if (!res.destroyed) res.destroy();
      });
    });

    upstreamReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      log('ERR', id, `✗ upstream timeout ${target}  (${UPSTREAM_TIMEOUT_MS}ms)`);
      upstreamReq.destroy(new Error('upstream timeout'));
    });

    upstreamReq.on('error', (err) => {
      const ms = Date.now() - attemptStart;
      const code = err.code || '';
      const isTransient = RETRY_ERROR_CODES.has(code);
      const canRetry = isRetryableMethod && isTransient && attempt === 1 && !res.headersSent;
      log('ERR', id, `✗ upstream ${target}: ${code} ${err.message}  (${ms}ms, attempt=${attempt}${canRetry ? ' will retry' : ''})`);
      if (canRetry) {
        // keep-alive socket が古くなって RST されたパターン。新しい socket で再送。
        sendOnce();
        return;
      }
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Upstream error: ' + err.message);
      }
    });

    // body の流し込み: 初回は req を pipe、retry 時はバッファから再送。
    if (attempt === 1) {
      req.pipe(upstreamReq);
    } else {
      if (bodyTooBig) {
        // 想定上 GET retry でしか来ないがガード。
        upstreamReq.end();
      } else {
        for (const chunk of bodyBuf) upstreamReq.write(chunk);
        upstreamReq.end();
      }
    }
  }

  req.on('error', (err) => {
    log('ERR', id, `✗ client req error  ${target}: ${err.message}`);
    // upstreamReq.destroy() は sendOnce 内で error として捕捉される
  });

  sendOnce();
  // 注: 以前ここに req.on('close', () => upstreamReq.destroy()) を入れていたが、
  // Node は GET リクエスト等で req body 読了直後に 'close' を発火することがあり、
  // upstream 応答到着前に destroy → 全リクエスト 502 になる回帰を起こしたため撤回。
}

const server = http.createServer((req, res) => {
  const id = nextReqId();
  const pathOnly = req.url.split('?')[0];

  // favicon は認証前に握る（ブラウザが大量に投げてくるためログを汚さない）
  if (pathOnly === '/favicon.ico') { res.writeHead(204); return res.end(); }

  // 認証ルート（GET=フォーム / POST=検証）
  if (pathOnly === '/auth') {
    if (req.method === 'POST') return handleAuthPost(req, res, id);
    return serveAuthForm(req, res, id, false);
  }

  // 認証ガード: 未認証なら /auth へ誘導
  if (!isAuthed(req)) {
    log('AUTH', id, `✗ unauth  ${req.method} ${pathOnly}  ip=${clientIp(req)}`);
    return serveAuthForm(req, res, id, false);
  }

  if (pathOnly === '/' || pathOnly === '/index.html') return serveLauncher(req, res, id);
  if (pathOnly === '/editor') return serveEditor(req, res, id);
  if (pathOnly === '/online')
    return serveHtml(req, res, id, ONLINE_HTML_PATH, 'online', 'node build.js online');
  if (pathOnly === '/offline') {
    // saved=1 のときは dya_online.html を配信（ローカル保存データから replay 起動）。
    // クエリは bootstrap が読み取り、saved=1 なら XHR/WebSocket を localStorage 経由に切替。
    const isSaved = /[?&]saved=1\b/.test(req.url);
    if (isSaved) {
      return serveHtml(req, res, id, ONLINE_HTML_PATH, 'offline-saved', 'node build.js online');
    }
    // original=1 のときも素の dya_offline.html。bootstrap がアップロード overlay を出して
    // ユーザに JSON 選択を要求する。
    const isOriginal = /[?&]original=1\b/.test(req.url);
    if (isOriginal) {
      return serveHtml(req, res, id, OFFLINE_HTML_PATH, 'offline-original', 'node build.js offline');
    }
    return serveHtml(req, res, id, OFFLINE_HTML_PATH, 'offline', 'node build.js offline');
  }

  const parsed = parseProxyUrl(req.url);
  if (parsed) return handleProxy(req, res, parsed, id);

  log('404', id, `${req.method} ${req.url}  ip=${clientIp(req)}`);
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found. Use /  /online?cheat=0|1  /offline?cheat=0|1  /__proxy/<host>/<path>.');
});

// === WebSocket / socket.io upgrade passthrough ===
server.on('upgrade', (req, clientSocket, head) => {
  const id = nextReqId();
  const ip = clientIp(req);
  if (!isAuthed(req)) {
    log('AUTH', id, `✗ ws unauth  ${req.url}  ip=${ip}`);
    clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return clientSocket.destroy();
  }
  const parsed = parseProxyUrl(req.url);
  if (!parsed) {
    log('WS', id, `✗ bad upgrade url: ${req.url}  ip=${ip}`);
    clientSocket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    return clientSocket.destroy();
  }
  if (!isAllowed(parsed.host)) {
    log('DENY', id, `✗ ws host not in allowlist: ${parsed.host}  ip=${ip}`);
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return clientSocket.destroy();
  }

  const target = `${parsed.host}${parsed.path}`;
  const startedAt = Date.now();
  let upBytes = 0;     // client -> upstream
  let downBytes = 0;   // upstream -> client
  let closed = false;

  log('WS+', id, `→ open ${target}  ip=${ip}`);

  // 上流に TLS 接続 → 生 HTTP で WebSocket Upgrade を送信 → 双方向 pipe
  const upstream = tls.connect({
    host: parsed.host,
    port: parsed.port,
    servername: parsed.host,
    ALPNProtocols: ['http/1.1'],
  }, () => {
    const tlsMs = Date.now() - startedAt;
    // ヘッダ書換: Host を upstream に
    const headers = { ...req.headers, host: parsed.host + (parsed.port !== 443 ? ':' + parsed.port : '') };
    if (headers.origin) headers.origin = 'https://' + parsed.host;
    let lines = `${req.method} ${parsed.path} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) {
      const vals = Array.isArray(v) ? v : [v];
      for (const vv of vals) lines += `${k}: ${vv}\r\n`;
    }
    lines += '\r\n';
    upstream.write(lines);
    if (head && head.length) upstream.write(head);
    log('WS', id, `  TLS connected to ${parsed.host}:${parsed.port}  (${tlsMs}ms)  upgrade sent`);
  });

  // 双方向中継 + バイト数計測。.pipe() と data リスナは並存可能。
  upstream.on('data', (c) => { downBytes += c.length; });
  clientSocket.on('data', (c) => { upBytes += c.length; });
  upstream.pipe(clientSocket);
  clientSocket.pipe(upstream);

  function closeOnce(reason) {
    if (closed) return;
    closed = true;
    const dur = Date.now() - startedAt;
    log('WS-', id, `← closed (${reason})  ${target}  dur=${dur}ms  up=${fmtBytes(upBytes)} down=${fmtBytes(downBytes)}`);
  }

  upstream.on('error', (err) => {
    log('ERR', id, `✗ ws upstream ${target}: ${err.code||''} ${err.message}`);
    closeOnce('upstream-error');
    clientSocket.destroy();
  });
  clientSocket.on('error', (err) => {
    log('ERR', id, `✗ ws client ${target}: ${err.code||''} ${err.message}`);
    closeOnce('client-error');
    upstream.destroy();
  });
  clientSocket.on('close', () => { closeOnce('client-close'); upstream.destroy(); });
  upstream.on('close', () => { closeOnce('upstream-close'); clientSocket.destroy(); });
});

function getLanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ name, address: ni.address });
    }
  }
  return out;
}

server.on('error', (err) => {
  log('SRV', '', `✗ server error: ${err.code||''} ${err.message}`);
});
server.on('clientError', (err, socket) => {
  log('SRV', '', `✗ client protocol error: ${err.code||''} ${err.message}`);
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) {}
});

function shutdown(signal) {
  log('SRV', '', `${signal} received, shutting down...`);
  server.close(() => {
    log('SRV', '', 'server closed cleanly. bye.');
    process.exit(0);
  });
  // 5 秒で強制終了（接続中の WS が残ってると close が返らない）
  setTimeout(() => {
    log('SRV', '', 'force exit (some sockets did not close in 5s)');
    process.exit(1);
  }, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log('FATL', '', `uncaughtException: ${err.stack||err.message}`);
});
process.on('unhandledRejection', (reason) => {
  log('FATL', '', `unhandledRejection: ${reason && reason.stack || reason}`);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('========================================================');
  console.log('  ダイナマイト野球 オンラインプロキシ 起動完了');
  console.log('========================================================');
  console.log(`  この PC から:  http://localhost:${PORT}/`);
  const lans = getLanAddresses();
  if (lans.length === 0) {
    console.log('  同一 LAN 内: (有効な IPv4 インターフェイスが見つかりません)');
  } else {
    console.log('  同一 LAN 内の他端末から:');
    for (const { name, address } of lans) {
      console.log(`    http://${address}:${PORT}/   [${name}]`);
    }
  }
  console.log('========================================================');
  console.log('  ルート:');
  console.log('    /                       -> 起動モード選択ランチャー');
  console.log('    /auth                   -> PIN 入力（認証有効時）');
  console.log('    /editor                 -> オリジナルチーム編集ツール');
  console.log('    /online?cheat=0|1       -> オンライン版（本家サーバ接続）');
  console.log('    /offline?cheat=0|1      -> オフライン版（CPU 専用）');
  console.log('    /offline?original=1     -> オリジナルチーム CPU 対戦（起動後に JSON アップロード）');
  console.log(`    ${PROXY_PREFIX}<host>/<path>  -> https://<host>/<path>  (HTTP+WS)`);
  console.log(`  allowlist: ${ALLOWED_HOSTS.join(', ')}`);
  if (AUTH_REQUIRED) {
    console.log(`  認証: 有効 (PROXY_AUTH_PIN 設定済 / pin_len=${AUTH_PIN.length})`);
  } else {
    console.log('  認証: 無効 (環境変数 PROXY_AUTH_PIN を設定すると有効化)');
  }
  console.log('  停止: Ctrl+C');
  console.log('');
  console.log('  ログ凡例:');
  console.log('    HTML = HTML 配信  /  HTTP = upstream 中継成功 (2xx/3xx)');
  console.log('    WARN = 4xx       /  ERR  = 5xx・上流 / クライアント例外');
  console.log('    STUB = 204 で握り潰した telemetry');
  console.log('    DENY = allowlist 外 host  /  404 = 未マッチ URL');
  console.log('    WS+  = WebSocket open / WS- = WebSocket close (転送量・継続時間付)');
  console.log('    SRV  = server 内イベント / FATL = uncaught/unhandled');
  console.log('  各行: <yyyy-mm-dd hh:mm:ss.SSS> [<level>] #<reqId> <message>');
  console.log('');
});
