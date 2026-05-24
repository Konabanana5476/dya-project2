// Recovery: rebuild C:\Users\中山天真\AppData\Local\Temp\dya_assets\ from dya_offline.html
// after Temp got wiped. Extracts scripts + asset blob, reverses all build.js patches
// applied to dya.js to restore the original, then exits so `node build.js online` can
// rebuild dya_online.html normally.

const fs = require('fs');
const path = require('path');

const SRC_HTML = path.resolve(__dirname, 'dya_offline.html');
const ASSETS_DIR = 'C:/Users/中山天真/AppData/Local/Temp/dya_assets';
const BUILD_JS = path.resolve(__dirname, 'build.js');

// === 1. Read offline HTML and build.js source ===
const html = fs.readFileSync(SRC_HTML, 'utf8');
const buildSrc = fs.readFileSync(BUILD_JS, 'utf8');

// === 2. Extract embedded script bodies ===
function extractAfterMarker(marker, terminator) {
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error('marker not found: ' + marker);
  const nl = html.indexOf('\n', idx);
  const end = html.indexOf(terminator, nl);
  return html.substring(nl + 1, end);
}

const threeJS = extractAfterMarker('===== three.min.js', '</script>');
const gltfJS = extractAfterMarker('===== GLTFLoader.js', '</script>');
const skelJS = extractAfterMarker('===== SkeletonUtils.js', '</script>');
const socketJS = extractAfterMarker('===== socket.io', '</script>');
let dyaJS = extractAfterMarker('===== dya.js', '</script>');

console.log('[recover] extracted: three=', threeJS.length, ', gltf=', gltfJS.length,
  ', skel=', skelJS.length, ', socket=', socketJS.length, ', dya(patched)=', dyaJS.length);

// === 3. Extract patch list from build.js source by evaluating it in a sandbox ===
// Stub readtxt/readb64 so the module can load without the missing assets dir; capture
// every `patch()` invocation into `appliedPatches`. Then run build.js with isOnline=false
// to learn exactly which patches were applied to the offline dya.js.

function collectOfflinePatches() {
  const patches = [];
  const sandbox = {
    require: (m) => {
      if (m === 'fs') {
        return {
          readFileSync: (p, enc) => {
            if (typeof p === 'string') {
              if (p.endsWith('three.min.js')) return threeJS;
              if (p.endsWith('GLTFLoader.js')) return gltfJS;
              if (p.endsWith('SkeletonUtils.js')) return skelJS;
              if (p.endsWith('socket.js')) return socketJS;
              if (p.endsWith('dya.js')) {
                // Return a clean placeholder: we just want to capture patch list.
                // dya.js is mutated in place via split/join; we don't care about the result.
                // Provide a long string so split/join don't crash.
                return ' '.repeat(700000);
              }
              if (p.indexOf('images/') >= 0 || p.endsWith('.glb') || p.endsWith('.png') ||
                  p.endsWith('.jpg') || p.endsWith('.mp3')) return Buffer.alloc(0);
            }
            return enc === 'utf8' ? '' : Buffer.alloc(0);
          },
          writeFileSync: () => {},  // no-op
        };
      }
      if (m === 'path') return require('path');
      throw new Error('require(' + m + ') unexpected');
    },
    process: { argv: ['node', 'build.js', 'offline'], exit: () => {} },
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
    Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Array, Object, String, Number, RegExp, Promise,
    URLSearchParams,
  };
  sandbox.global = sandbox;
  sandbox.__dirname = __dirname;
  sandbox.__filename = BUILD_JS;

  // Wrap build.js so we intercept `patch()` definition. The `patch` function is declared
  // as `function patch(label, from, to) { ... }`. We replace it pre-run by injecting
  // our own at top. Actually simpler: parse the build.js text, find `function patch`,
  // replace with hook that records args.
  const hookedSrc = buildSrc.replace(
    /function patch\(label, from, to\) \{[\s\S]*?\}/,
    'function patch(label, from, to){ __patches.push({label, from, to}); }'
  ).replace(
    'fs.writeFileSync(OUT, html);',
    '/* writeFileSync stripped */'
  );

  const vm = require('vm');
  const ctx = vm.createContext(sandbox);
  sandbox.__patches = patches;
  try {
    vm.runInContext(hookedSrc, ctx, { filename: 'build.js (sandboxed offline)' });
  } catch (e) {
    console.warn('[recover] sandbox error (offline):', e.message);
  }
  return patches;
}

const offlinePatches = collectOfflinePatches();
console.log('[recover] captured', offlinePatches.length, 'patches applied to offline dya.js');

// === 4. Reverse all those patches on the extracted dya.js to recover the original ===
// Apply patches in reverse order (last-applied first). For each, swap from/to.
const before = dyaJS.length;
let reversed = 0, missed = 0;
for (let i = offlinePatches.length - 1; i >= 0; i--) {
  const p = offlinePatches[i];
  if (!p.to || !p.from) continue;
  const next = dyaJS.split(p.to).join(p.from);
  if (next === dyaJS) {
    console.warn('[recover] reverse missed:', p.label);
    missed++;
  } else {
    reversed++;
  }
  dyaJS = next;
}
console.log('[recover] reversed', reversed, 'patches,', missed, 'missed (offline-extracted dya.js -> clean source). length',
  before, '->', dyaJS.length);

// === 5. Extract asset blob entries (path|mime|base64) and base64-decode each ===
const blobIdx = html.indexOf('<script id="__assets"');
const blobOpen = html.indexOf('>', blobIdx) + 1;
const blobClose = html.indexOf('</script>', blobOpen);
const blobBody = html.substring(blobOpen, blobClose).trim();
const blobEntries = blobBody.split('\n').filter(l => l.trim().length > 0);
console.log('[recover] asset blob entries:', blobEntries.length);

// === 6. Write everything to dya_assets ===
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDir(ASSETS_DIR);
ensureDir(path.join(ASSETS_DIR, 'images'));

fs.writeFileSync(path.join(ASSETS_DIR, 'three.min.js'), threeJS, 'utf8');
fs.writeFileSync(path.join(ASSETS_DIR, 'GLTFLoader.js'), gltfJS, 'utf8');
fs.writeFileSync(path.join(ASSETS_DIR, 'SkeletonUtils.js'), skelJS, 'utf8');
fs.writeFileSync(path.join(ASSETS_DIR, 'socket.js'), socketJS, 'utf8');
fs.writeFileSync(path.join(ASSETS_DIR, 'dya.js'), dyaJS, 'utf8');

let assetCount = 0;
for (const line of blobEntries) {
  const parts = line.split('|');
  if (parts.length < 3) continue;
  const relPath = parts[0];
  const b64 = parts.slice(2).join('|');
  const buf = Buffer.from(b64, 'base64');
  const outPath = path.join(ASSETS_DIR, relPath);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, buf);
  assetCount++;
}
console.log('[recover] wrote', assetCount, 'assets to', ASSETS_DIR);
console.log('[recover] done. Now run: node build.js online');
