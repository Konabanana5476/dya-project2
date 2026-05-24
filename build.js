// Build single-file HTML for ダイナマイト野球
//   node build.js          -> dya_offline.html  (file:// で動くCPU専用版)
//   node build.js online   -> dya_online.html   (proxy.js 経由でログイン/オンライン対戦版)
const fs = require('fs');
const path = require('path');

const MODE = (process.argv[2] || 'offline').toLowerCase();
if (MODE !== 'offline' && MODE !== 'online') {
  console.error('usage: node build.js [offline|online]');
  process.exit(1);
}
const isOnline = MODE === 'online';

const SRC = 'C:/Users/中山天真/AppData/Local/Temp/dya_assets';
const OUT = path.resolve(__dirname, isOnline ? 'dya_online.html' : 'dya_offline.html');

function readb64(rel) { return fs.readFileSync(path.join(SRC, rel)).toString('base64'); }
function readtxt(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }

const ASSET_FILES = [
  'images/240904sound_dya.mp3',
  'images/close.png',
  'images/cs2_241212.jpg',
  'images/cs1_pc_260413.png',
  'images/cs1_mb_260413.png',
  'images/da_bg.jpg',
  'images/parts_skin_231221.png',
  'images/skin1_251205.png',
  'images/skin2_240130.jpg',
  'images/wait_bg.png',
  'images/player120.glb',
  'images/parts17.glb',
  'images/parts17_doom.glb',
  'images/parts17_doom_rm.glb',
  'images/parts17_dirt.glb',
];
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
};
const assetMapEntries = ASSET_FILES.map(p => {
  const ext = p.split('.').pop().toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  return [p, mime, readb64(p)];
});

const threeJS = readtxt('three.min.js');
const gltfJS = readtxt('GLTFLoader.js');
const skelJS = readtxt('SkeletonUtils.js');
const socketJS = readtxt('socket.js');
let dyaJS = readtxt('dya.js');

function patch(label, from, to) {
  const before = dyaJS;
  dyaJS = dyaJS.split(from).join(to);
  if (dyaJS === before) console.warn('[WARN] patch missed:', label);
  else console.log('[patch]', label);
}

// === 共通パッチ ===

// アセットURL関連（CSS背景画像をblob URLに）
patch('CSS bg da_bg.jpg',
  `"url('images/da_bg.jpg')"`,
  `("url('"+window.__resolveAsset('images/da_bg.jpg')+"')")`);
patch('CSS bg wait_bg.png',
  `"url('images/wait_bg.png')"`,
  `("url('"+window.__resolveAsset('images/wait_bg.png')+"')")`);

// dya.js は window.onunload と window.onbeforeunload を二重登録しているが、
// 中身は完全に同じ（オンライン時の socket disconnect）。Chrome は unload を deprecated
// 扱い（将来削除予定）でコンソールに警告を出すため、unload の方だけ削除して beforeunload
// に一本化。機能影響なし。
patch('drop deprecated window.onunload listener',
  "window.onunload=function(){if (typeof is_online !== 'undefined'){if(is_online==1 && cnct_status!=-1){vs_inning_tb=98;socket.disconnect()}}};",
  '');

// 広告 iframe → about:blank（オンラインでも localhost からは AdSense 表示できないため共通）
patch('ad iframe page02 -> about:blank',
  'iframeElement.src="https://dya.jp/page02.html"',
  'iframeElement.src="about:blank"');
patch('ad iframe page03 -> about:blank',
  'iframeElement.src="https://dya.jp/page03.html"',
  'iframeElement.src="about:blank"');

// マニュアルへの強制遷移を抑止（offline/online どちらも単体で動かしたい）
patch('case 777 manual (illustration)',
  'case 777:sndf(3,.1);top.location.href="https://dya.jp/manual/illustration.html";break;',
  'case 777:sndf(3,.1);run_mode=2;break;');
patch('case 777 manual (root)',
  'case 777:sndf(3,.1);if(document.domain=="dya.jp"){top.location.href="https://dya.jp/manual/"}else{run_mode=2};break;',
  'case 777:sndf(3,.1);run_mode=2;break;');

// document.domain ガードを外して広告フローを通す
patch('drop domain guard #2 (ad block A)',
  'if(document.domain=="dya.jp" && ntm-all_ap_tim>30000)',
  'if(ntm-all_ap_tim>30000)');
patch('drop domain guard #3 (adConfig onReady setup)',
  'if(document.domain=="dya.jp"){kkn_bck_cnt=1;adConfig',
  'if(true){kkn_bck_cnt=1;adConfig');
patch('drop domain guard #4 (ad block B)',
  'if(document.domain=="dya.jp"){all_ap_tim=ntm;all_gm_stop=1;test_brkrdy+="試"',
  'if(true){all_ap_tim=ntm;all_gm_stop=1;test_brkrdy+="試"');
patch('drop domain guard #6 (preroll/da_go(0))',
  'if(document.domain=="dya.jp"){if(nw_blk_ct>0){da_go(0)}',
  'if(true){if(nw_blk_ct>0){da_go(0)}');

// === 両モード共通チートパッチ（チート版モードのみ実効・通常版は元の挙動）===
// これらは試合本体（HR 判定 / 投球操作 / 既存チームの調子）に効くパッチで、
// オンライン特有の通信フローには依存しない。__cheat_enabled or _hrPending 等の
// ガード付きなので、通常版モードでは元の挙動が維持される。

// 既存チームの調子: チート時は各チーム 1〜3 人ランダムに「絶好調(0) or 好調(1)」、
// 残りは「普通(2)」固定。不調(3)/絶不調(4) は絶対出ない。通常時は元のランダム分布。
// 注: dya.js の調子値は「0=絶好調 / 1=好調 / 2=普通 / 3=不調 / 4=絶不調」(switch case 0:prm_pw++ etc.)。
// 直感の逆なので過去に「3/4 を割り当てて絶好調にしたつもりが絶不調を量産」のバグを起こした。
patch('force fixed condition: 1-3 koucho/zekkochou per team (cheat)',
  'total_condition="";var set_condition=0;var set_condition_i_test=0;for(var i=0;i<12*21;i++){set_condition=Math.floor(Math.random()*5);if(Math.random()>.4 || set_condition_i_test>16 || set_condition_i_test==8){set_condition=2};if(set_condition==0 && Math.random()>.6){set_condition=1};total_condition+=set_condition+"";set_condition_i_test++;if(set_condition_i_test>20){set_condition_i_test=0}};',
  'total_condition="";if(window.__cheat_enabled){for(var __t=0;__t<12;__t++){var __tc=[];for(var __p=0;__p<21;__p++){__tc.push("2")};var __n=1+Math.floor(Math.random()*3);var __pk={};while(Object.keys(__pk).length<__n){var __pi=Math.floor(Math.random()*21);if(!__pk[__pi]){__pk[__pi]=1;__tc[__pi]=(Math.random()<0.5?"0":"1")}}total_condition+=__tc.join("")}}else{var set_condition=0;var set_condition_i_test=0;for(var i=0;i<12*21;i++){set_condition=Math.floor(Math.random()*5);if(Math.random()>.4 || set_condition_i_test>16 || set_condition_i_test==8){set_condition=2};if(set_condition==0 && Math.random()>.6){set_condition=1};total_condition+=set_condition+"";set_condition_i_test++;if(set_condition_i_test>20){set_condition_i_test=0}}};');

// 試合開始時に HR チート使用フラグをリセット（1 試合 1 回）
patch('reset HR cheat usage on match_start (cheat)',
  'function match_start(){onl_pitch_cnt=0',
  'function match_start(){if(window.__cheat){window.__cheat._hrUsed=false;window.__cheat._hrPending=false}onl_pitch_cnt=0');

// HR チート: hit 判定式に _hrPending を OR 注入。pitch ごとに v_hitting=-1 リセットされるので
// ボタンクリック時の即時 v_hitting=4 では消えてしまう。条件式そのものに割り込む。
patch('HR cheat: inject _hrPending into hit decision (cheat)',
  'v_hitting==4 || (v_hitting==-1 && hit_Rds<5 && prm_pw>6 && strike_zorn_chk==1 && (prm_tk.indexOf("4|")>-1 || bat_angle!=0))',
  'v_hitting==4 || (window.__cheat&&window.__cheat._hrPending) || (v_hitting==-1 && hit_Rds<5 && prm_pw>6 && strike_zorn_chk==1 && (prm_tk.indexOf("4|")>-1 || bat_angle!=0))');

// 長打=10 強制: case 4 で ball_hit_pw=ht_pw[10]=3.4 に上書き
patch('HR cheat: force prm_pw=10 in case 4 (cheat)',
  'case 4:ball_hit_pw=ht_pw[prm_pw];if(ball_hit_pw<3.0)',
  'case 4:ball_hit_pw=ht_pw[(window.__cheat&&window.__cheat._hrPending)?10:prm_pw];if(ball_hit_pw<3.0)');

// HR チート: 球速ベクトルを直接 HR 軌道に上書き。bat-球完全一致だと collideBounceVector が
// 小さい値を返す問題への対処。同時に _hrPending を false に倒して 1 swing 限定化。
patch('HR cheat: override ball velocity for guaranteed HR (cheat)',
  'sx=newVelocityB.x*ball_hit_pw;sz=newVelocityB.z*ball_hit_pw;sy=newVelocityB.y*ball_hit_pw;',
  'sx=newVelocityB.x*ball_hit_pw;sz=newVelocityB.z*ball_hit_pw;sy=newVelocityB.y*ball_hit_pw;if(window.__cheat&&window.__cheat._hrPending){sx=0;sy=1.4;sz=-3.8;window.__cheat._hrPending=false};');

// BEST 確定チート: pitch_dc 冒頭で _bestPending を読んで pitch_opr_flg3_cnt2=41 強制。
// 直後の pitch_stop=Math.abs(cnt2-41) が 0 → pitch_pw=1 (BEST)。
patch('BEST cheat: override pitch_opr_flg3_cnt2 in pitch_dc (cheat)',
  'function pitch_dc(){pitch_opr_flg=7;pt_f={};pt_fi=0;pitch_stop=Math.abs(pitch_opr_flg3_cnt2-41)',
  'function pitch_dc(){if(window.__cheat&&window.__cheat._bestPending){pitch_opr_flg3_cnt2=41;window.__cheat._bestPending=false}pitch_opr_flg=7;pt_f={};pt_fi=0;pitch_stop=Math.abs(pitch_opr_flg3_cnt2-41)');

// 自分（バッター）の長打 +1 / ヒット +1 ブースト。
// 調子補正後の prm_pw が 7 以上（=長打 7 以上の能力に好調補正等を加味した最終値）のとき、
// 自分の打席 (opr_mode==1) で prm_pw/prm_ht を +1 する。
// 相手（投手側 opr_mode==2）の djn[inning_tb] は opponent の batter なので、必ず opr_mode==1
// に gate して自分の打席だけブーストする。サーバには結果の打球（sx/sy/sz/hit_md）が送信
// されるため、能力値そのものは送らない。「相手から見ると強い打球を打たれただけ」になる。
patch('long-hit boost: +1 long/+1 hit when prm_pw>=7 (cheat)',
  'switch (bt_pd[inning_tb][djn[inning_tb]][17]){case 0:prm_pw++;prm_ht++;break;case 1:prm_ht++;break;case 2:break;case 3:prm_ht--;break;case 4:prm_pw--;prm_ht--;break;default:};',
  'switch (bt_pd[inning_tb][djn[inning_tb]][17]){case 0:prm_pw++;prm_ht++;break;case 1:prm_ht++;break;case 2:break;case 3:prm_ht--;break;case 4:prm_pw--;prm_ht--;break;default:};if(window.__cheat_enabled&&opr_mode==1&&prm_pw>=7){prm_pw++;prm_ht++};');

// CPU 対戦の来球プレビュー HUD: CPU 投球 (is_online==0 path) で pitch_cpu/pitch_dec が呼ばれた
// 直後にフック。プレイヤーがバッター時 (opr_mode==1) のみ HUD 表示。
// オフライン版 / オンライン版どちらの CPU 対戦でも有効にするため common に置く。
// オンラインの対人戦は socket.on('v') 経由で別フック (1.5s 遅延付き) が走るので干渉しない。
patch('pitch preview HUD hook (CPU mode, cheat)',
  'if(is_online==0){pitch_cpu(0);pitch_dec()};swing_conf=0;all_pitch_cnt++;',
  'if(is_online==0){pitch_cpu(0);pitch_dec();if(window.__cheat_enabled&&opr_mode==1&&window.__cheat&&window.__cheat.onPitch){window.__cheat.onPitch()}};swing_conf=0;all_pitch_cnt++;');

// === CPU 難度シフト (cheat 限定) ===
// チート版でのみ全段階を 1 ランク上げ + 新最上位を導入。
//   練習(0) ← 旧ふつう(1) 相当 (練習ハンデ廃止)
//   ふつう(1) ← 旧つよい(2) 相当
//   つよい(2) ← 旧強すぎ(3) 相当
//   強すぎ(3) ← 新最上位 (常に BEST 投球 / 常時タイトコース / バッタータイミング 3% miss ±0-2 / Rd 極小)
// 通常版は元の挙動 (window.__cheat_enabled が false で全条件が原典通り)。

// Site A: 投球コントロール (pitch_stop)
//   - 練習ハンデ if(cpu_lv==0){pitch_stop=4} を cheat 時は無効化
//   - cpu_lv>1 / cpu_lv>2 を 1 ランクずつ下げて適用
//   - cpu_lv>=3 で pitch_stop=0 (BEST) 強制
patch('CPU diff shift: pitch_stop site (cheat)',
  'cpu_lv>1) || (cpu_lv>2 && Math.random()>.5)){pitch_stop=Math.floor(Math.random()*2)};if(cpu_lv==0){pitch_stop=4}',
  '(window.__cheat_enabled?cpu_lv>0:cpu_lv>1)) || ((window.__cheat_enabled?cpu_lv>1:cpu_lv>2) && Math.random()>.5)){pitch_stop=Math.floor(Math.random()*2)};if((window.__cheat_enabled?false:cpu_lv==0)){pitch_stop=4};if(window.__cheat_enabled&&cpu_lv>=3){pitch_stop=0}');

// Site B: 球種 / コース
//   - 練習ハンデ「50% でストレート強制」「常に散らす」を cheat 時は無効化
//   - cpu_lv>=3 (新強すぎ) は常にストライクゾーン内 (タイトコース) に固定
patch('CPU diff shift: pitch type/course site (cheat)',
  'if(cpu_lv==0 && Math.random()>.5){pitch_type=0};if(Math.random()>.4 || cpu_lv==0){schd_x=0+Math.random()*1.8-.9;schd_y=1.5+Math.random()*2-1}else{schd_x=-.66+Math.random()*.66*2;schd_y=.73+Math.random()*1.545}',
  'if((window.__cheat_enabled?false:cpu_lv==0) && Math.random()>.5){pitch_type=0};if(window.__cheat_enabled&&cpu_lv>=3){schd_x=-.66+Math.random()*.66*2;schd_y=.73+Math.random()*1.545}else if(Math.random()>.4 || (window.__cheat_enabled?false:cpu_lv==0)){schd_x=0+Math.random()*1.8-.9;schd_y=1.5+Math.random()*2-1}else{schd_x=-.66+Math.random()*.66*2;schd_y=.73+Math.random()*1.545}');

// Site C: バッタータイミング switch(cpu_lv)
//   - cheat 時は全 case を 1 ランク上にシフト + 新 case 3 (3% miss / ±0-2 frame)
patch('CPU diff shift: batter timing switch (cheat)',
  'switch(cpu_lv){case 0:if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*6)}else{cpu_bt_tim+=Math.floor(Math.random()*6)};break;case 1:if(Math.random()>.3){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;case 2:if(Math.random()>.6){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;case 3:if(Math.random()>.9){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;default:}',
  'if(window.__cheat_enabled){switch(cpu_lv){case 0:if(Math.random()>.3){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;case 1:if(Math.random()>.6){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;case 2:if(Math.random()>.9){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;case 3:if(Math.random()>.97){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*3)}else{cpu_bt_tim+=Math.floor(Math.random()*3)}};break;default:}}else{switch(cpu_lv){case 0:if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*6)}else{cpu_bt_tim+=Math.floor(Math.random()*6)};break;case 1:if(Math.random()>.3){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;case 2:if(Math.random()>.6){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;case 3:if(Math.random()>.9){if(pitch_type==0 || pitch_type==1 || pitch_type==5){cpu_bt_tim-=Math.floor(Math.random()*4)}else{cpu_bt_tim+=Math.floor(Math.random()*4)}};break;default:}}');

// Site D1: 攻撃方針 (hnt_batting_position)
//   - cpu_lv>1 / cpu_lv>2 を 1 ランクシフト + 新強すぎは常時積極
patch('CPU diff shift: aggressive batting site (cheat)',
  'cpu_lv>1) || (cpu_lv>2 && Math.random()>.1) ||pch_dat[inning_rv][10]>stamina_num[pch_dat[inning_rv][2]]){hnt_batting_position=cpu_batting_position-Math.random()*80}',
  '(window.__cheat_enabled?cpu_lv>0:cpu_lv>1)) || ((window.__cheat_enabled?cpu_lv>1:cpu_lv>2) && Math.random()>.1) ||pch_dat[inning_rv][10]>stamina_num[pch_dat[inning_rv][2]] || (window.__cheat_enabled&&cpu_lv>=3)){hnt_batting_position=cpu_batting_position-Math.random()*80}');

// Site D2: 接触精度 (Rd ばらつき)
//   - cpu_lv>1 / cpu_lv>2 (外側) を 1 ランクシフト
//   - cpu_lv>2 && Math.random()>.6 (内側、極小 Rd) も 1 ランクシフト
//   - 新強すぎは Rd を更に小さく上書き (Math.random()*1.5)
patch('CPU diff shift: contact precision site (cheat)',
  'cpu_lv>1) || (cpu_lv>2 && Math.random()>.1) ||pch_dat[inning_rv][10]>stamina_num[pch_dat[inning_rv][2]]){Rd/=Math.random()*2+1;if(cpu_lv>2 && Math.random()>.6){Rd=Math.random()*3}}',
  '(window.__cheat_enabled?cpu_lv>0:cpu_lv>1)) || ((window.__cheat_enabled?cpu_lv>1:cpu_lv>2) && Math.random()>.1) ||pch_dat[inning_rv][10]>stamina_num[pch_dat[inning_rv][2]] || (window.__cheat_enabled&&cpu_lv>=3)){Rd/=Math.random()*2+1;if((window.__cheat_enabled?cpu_lv>1:cpu_lv>2) && Math.random()>.6){Rd=Math.random()*3};if(window.__cheat_enabled&&cpu_lv>=3){Rd=Math.random()*1.5}}');

// Site E: 接触練習ハンデ (Rd +10 ばらつき)
//   - cheat 時は無効化
patch('CPU diff shift: drop practice Rd handicap (cheat)',
  'if(cpu_lv==0){Rd+=10*Math.random()*str_s}',
  'if((window.__cheat_enabled?false:cpu_lv==0)){Rd+=10*Math.random()*str_s}');

// === ORIGINAL TEAM mode hook ===
// team_data 関数の switch (i){...} 直前に分岐を挿入。
// /offline?original=1 の bootstrap がアップロード済み JSON を sessionStorage から読み、
// window.__orig_teams_data と window.__build_original_record を用意する。両方揃った時のみ
// 各 case のレコードを差し替える（揃わない通常起動では何も起きない）。
patch('ORIGINAL TEAM hook in team_data',
  'var set_plr_dat=new Array(20);var set_shibi_ps="";switch (i){',
  'var set_plr_dat=new Array(20);var set_shibi_ps="";if(window.__build_original_record&&window.__orig_teams_data&&window.__orig_teams_data.teams&&window.__orig_teams_data.teams[i]){var __ot=window.__orig_teams_data.teams[i];for(var __os=0;__os<21;__os++){set_plr_dat[__os]=window.__build_original_record(__ot.players[__os])};set_shibi_ps=(__ot.starting_order||[7,6,8,3,9,5,4,2,1]).join("")}else switch (i){');

// === モード別パッチ ===

if (!isOnline) {
  // --- OFFLINE: CPU 強制 / 広告系を完全シャットアウト / カメラリセット強制 ---
  patch('lgin_time=-2 (CPU-only)',
    'lgin_time=-1;announcement_msg_cnt=0',
    'lgin_time=-2;announcement_msg_cnt=0');
  patch('skip splax.net redirect',
    'if(top.location.host=="dya.jp"){cmajor9=1}else{top.location.href="https://splax.net"}',
    'cmajor9=1');
  patch('da_go shim',
    'function da_go(i){nw_blk_type=i;sndf(19,.06);test_brkrdy+="【新ブ】"',
    'function da_go(i){if(i===0)return;if(i===1){try{chg_adv()}catch(e){}return}nw_blk_type=i;sndf(19,.06);test_brkrdy+="【新ブ】"');
  patch('dminor9 force-on (post-play camera reset)',
    'dminor9=0;if(chsm==582){dminor9=1}',
    'dminor9=1;if(false){dminor9=1}');
} else {
  // --- ONLINE: 各種ホスト/ドメインチェックを通す + socket 接続先を proxy 経由に ---

  // top.location.host=="dya.jp" を全て true 化（splax.net redirect の if-else もこれで cmajor9=1 側に固定）
  patch('top.location.host==dya.jp -> true (online)',
    'top.location.host=="dya.jp"',
    'true');

  // socket.io 接続先を proxy 経由に書換。
  // 注意: socket.io 0.9 は相対URLを解決する際 document.domain を読むため、
  // ブートストラップで domain を 'dya.jp' に偽装している現状では `/__proxy/...` だと
  // `http://dya.jp:8080/socket.io/1/?...` が組まれて壊れる。
  // 絶対URL（location.host）+ resource override で host/port/path を完全指定する。
  patch('io.connect URL -> proxy (online)',
    "io.connect('https://sv2.splaxserver.net:443/chat', {reconnection: false,transports: ['websocket'],})",
    "io.connect((location.protocol==='https:'?'https://':'http://')+location.host+'/chat', {resource:'__proxy/sv2.splaxserver.net/socket.io',reconnection: false,transports: ['websocket'],})");

  // play.splax.net/dya/ip_chk2.php の応答による「オンライン対戦が中断されました」黄色バナー
  // と lgin_time=-2 強制を抑止。proxy 経由だと正の sv_ctch[0] が返ることがあり、その場合
  // オンライン機能が完全停止してしまう。proxy として必須なので両モード適用。
  patch('suppress ip_chk2 force-CPU + banner (online)',
    'if(Math.floor(sv_ctch[0])>0){;lgin_time=-2;announcement_msg="123";announcement_msg_cnt=600}',
    'if(false){;lgin_time=-2;announcement_msg="123";announcement_msg_cnt=600}');

  // マイチーム編成画面: 期限切れ選手がいるとチェックボタン（onflg=500時）が onflg=-99 で
  // 無効化される。期限切れキャラも試合に連れていけるよう、無効化条件を死コード化。
  // チート時のみ有効化、通常モードでは元の挙動。
  patch('allow expired players in team (cheat only)',
    'if(chk_kgn==1){onflg=-99;test_data_save5="期限切れチェック"}',
    'if(!window.__cheat_enabled&&chk_kgn==1){onflg=-99;test_data_save5="期限切れチェック"}');

  // 試合送信直後の plr_dat 破壊抑止。チート時のみ。
  patch('prevent expired player data corruption (cheat only)',
    'if(Math.floor(agr_data[4])<1){plr_dat[i_sb_chk]="-"+plr_dat[i_sb_chk]}',
    'if(!window.__cheat_enabled&&Math.floor(agr_data[4])<1){plr_dat[i_sb_chk]="-"+plr_dat[i_sb_chk]}');

  // 「対戦開始」ボタンを enable する条件 `shb_chk3==0` 維持。チート時のみ。
  patch('keep shb_chk3=0 ignoring expiration (cheat only)',
    'if(Math.floor(agr_data[4])<1){shb_chk3=1}',
    'if(!window.__cheat_enabled&&Math.floor(agr_data[4])<1){shb_chk3=1}');

  // 視覚的「期限切れ」表示の非表示。チート時のみ。
  patch('hide expiration visual warnings (cheat only)',
    'Math.floor(agr_data[4])<8',
    '(window.__cheat_enabled?false:Math.floor(agr_data[4])<8)');
  patch('replace remaining-days text with unlimited (cheat only)',
    '"残り"+agr_data[4]+"日"',
    '(window.__cheat_enabled?"無期限":"残り"+agr_data[4]+"日")');

  // === Tier A: 来球プレビュー HUD フック === (チート時のみ)
  // チート時: v_pitch_type 等を前倒し復号 → HUD 発火 → 1.5 秒遅延でボール開始。
  // 通常時: 元の挙動（pitch_cnt=29 即時セット）。
  patch('pitch preview HUD hook + 1.5s delay (cheat only)',
    'v_schd_y=((s_hrk(sd_bat.substr(2,2))-1000)/100);pitch_cpu(0);pitch_dec();pitch_cnt=29;pitting_flg=1;cnct_count++;',
    'v_schd_y=((s_hrk(sd_bat.substr(2,2))-1000)/100);if(window.__cheat_enabled){v_schd_z=((s_hrk(sd_bat.substr(4,2))-1000)/100);v_pitch_pw=((s_hrk(sd_bat.substr(6,2))-1000)/100);v_pitch_type=((s_hrk(sd_bat.substr(8,1))-10));}pitch_cpu(0);pitch_dec();if(window.__cheat_enabled){if(window.__cheat&&window.__cheat.onPitch)window.__cheat.onPitch();setTimeout(function(){pitch_cnt=29;pitting_flg=1;},1500);}else{pitch_cnt=29;pitting_flg=1;}cnct_count++;');

  // onl_hkk は telemetry 専用関数（"FPS不足_落ち"/"接続エラー"/"カバリングA" 等を
  // dya.jp/gk/oraaq2.cgi に送信）。プロキシ越しだと上流が 500 を返してコンソールが汚れるため
  // 関数本体を死コード化（試合進行には一切影響しない）。
  patch('disable onl_hkk telemetry (online)',
    "function onl_hkk(i){if(test_nn_send==0){xhsd=new XMLHttpRequest();xhsd.open('POST', 'https://dya.jp/gk/oraaq2.cgi'",
    "function onl_hkk(i){if(false){xhsd=new XMLHttpRequest();xhsd.open('POST', 'https://dya.jp/gk/oraaq2.cgi'");

  // 注: "svt" 応答（IP違いロックアウト画面）の改変は試したが、サーバ側の
  // 「同一IPで別ID制限」自体は client から解除不可と判明したため、ロック画面の
  // 改変は撤回。元の挙動（拒否時はロック画面 → タイトルに戻るボタン）が一番
  // 分かりやすい UX として残す。

  // マイチーム選択画面の 1/3 イニング対戦ボタン enable。チート時のみ。
  patch('enable 1-inning button in MyTeam mode (cheat only)',
    'spt_cs1(348,422,136+cnt_y_h,1,600)',
    '(window.__cheat_enabled?spt_cs1_button(142,422,136+cnt_y_h,1,600):spt_cs1(348,422,136+cnt_y_h,1,600))');
  patch('enable 3-inning button in MyTeam mode (cheat only)',
    'spt_cs1(348,422,280+cnt_y_h,1,601)',
    '(window.__cheat_enabled?spt_cs1_button(142,422,280+cnt_y_h,1,601):spt_cs1(348,422,280+cnt_y_h,1,601))');

  // dminor9 はオンラインでは document.domain spoof（bootstrap で実施）により chsm==582 が
  // 自然に成立するので、追加パッチ不要。
}

// === HTML テンプレート ===

const assetBlob = assetMapEntries.map(([p, m, b]) => `${p}|${m}|${b}`).join('\n');

// --- 共通アセット登録 + URL リゾルバ ---
const COMMON_BOOTSTRAP_HEAD = `
  // ===== 共通: アセットを blob URL に登録 =====
  var raw = document.getElementById('__assets').textContent.replace(/^\\s+/, '');
  var lines = raw.split('\\n');
  var blobUrls = Object.create(null);
  var blobMime = Object.create(null);
  function b64ToBytes(b64){
    var bin = atob(b64); var len = bin.length;
    var bytes = new Uint8Array(len);
    for(var i=0;i<len;i++) bytes[i]=bin.charCodeAt(i);
    return bytes;
  }
  for(var i=0;i<lines.length;i++){
    var ln = lines[i]; if(!ln) continue;
    var p1 = ln.indexOf('|'); var p2 = ln.indexOf('|', p1+1);
    if(p1<0||p2<0) continue;
    var key = ln.slice(0,p1);
    var mime = ln.slice(p1+1,p2);
    var b64 = ln.slice(p2+1);
    var blob = new Blob([b64ToBytes(b64)], {type: mime});
    var url = URL.createObjectURL(blob);
    blobUrls[key] = url;
    blobMime[key] = mime;
    blobUrls['./'+key] = url;
    blobUrls['/'+key] = url;
  }
  document.getElementById('__assets').textContent = '';

  function resolveAsset(u){
    if(typeof u !== 'string') return null;
    if(u.indexOf('blob:')===0 || u.indexOf('data:')===0) return null;
    if(blobUrls[u]) return blobUrls[u];
    var q = u.indexOf('?');
    var bare = q>=0 ? u.slice(0,q) : u;
    if(blobUrls[bare]) return blobUrls[bare];
    for(var key in blobUrls){
      if(bare === key || bare.endsWith('/'+key) || bare.endsWith(key)){
        return blobUrls[key];
      }
    }
    return null;
  }
  window.__resolveAsset = resolveAsset;

  // src setter (img/audio/video/source) を blob URL に振り替え
  function patchSrc(proto){
    var target = proto; var desc = null;
    while(target){ desc = Object.getOwnPropertyDescriptor(target, 'src'); if(desc) break; target = Object.getPrototypeOf(target); }
    if(!desc || !desc.set){ return; }
    Object.defineProperty(proto, 'src', {
      configurable: true, enumerable: desc.enumerable,
      get: function(){ return desc.get.call(this); },
      set: function(v){ var mapped = resolveAsset(v); return desc.set.call(this, mapped || v); }
    });
  }
  patchSrc(HTMLImageElement.prototype);
  patchSrc(HTMLMediaElement.prototype);
  patchSrc(HTMLSourceElement.prototype);
`;

// --- 共通チート UI ブートストラップ（両モードで __cheat_enabled なら有効化） ---
// HUD / ボール indicator / BEST ボタン / HR ボタン / onPitch ハンドラ。
// オンラインの来球は socket.on('v') case 0 から、オフラインの来球は CPU 投球の
// pitch_cpu/pitch_dec 直後（offline patch）から、それぞれ window.__cheat.onPitch() が
// 呼ばれる。両モードで同じ UI / 同じ判定式を共有。
const CHEAT_UI_BOOTSTRAP = `
  // ===== Tier A 来球プレビュー HUD =====
  var hud = document.createElement('div');
  hud.id = '__cheat_hud';
  // スマホ最適化: vmin で縮拡、safe-area 加味、画面端からはみ出さないよう max-width。
  Object.assign(hud.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(14% + env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.72)',
    color: '#fff',
    padding: 'clamp(6px, 1.8vmin, 10px) clamp(14px, 4vmin, 22px)',
    borderRadius: '8px',
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    fontSize: 'clamp(16px, 4.5vmin, 28px)',
    lineHeight: '1.15',
    zIndex: '10000',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.12s linear',
    letterSpacing: '0.04em',
    textShadow: '0 0 4px rgba(0,0,0,0.8)',
    whiteSpace: 'nowrap',
    maxWidth: '92vw',
    boxSizing: 'border-box',
  });
  document.body.appendChild(hud);

  // 着弾点に薄くボールを表示するための DOM 要素。ストレート/変化球どちらも表示する。
  // ストレートは aim と着弾点が一致するので、コースの目印として残す。
  // 大きさは試合中の実ボールに合わせる。
  var ballEl = document.createElement('div');
  ballEl.id = '__cheat_ball';
  Object.assign(ballEl.style, {
    position: 'fixed',
    width: 'clamp(20px, 5vmin, 32px)',
    height: 'clamp(20px, 5vmin, 32px)',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.55)',
    border: '2px solid rgba(220,40,40,0.85)',
    boxShadow: '0 0 14px rgba(255,140,140,0.9), inset 0 0 8px rgba(220,40,40,0.5)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: '9999',
    opacity: '0',
    transition: 'opacity 0.15s linear',
    left: '0px',
    top: '0px',
  });
  document.body.appendChild(ballEl);

  // ボール到達カウントダウンバー。S ゾーン上に水平表示で、HUD onPitch 発火から
  // ボール到達までの「残り時間」を視覚化（バーが右から左へ縮む）。
  // 1.5s 確認時間 + 約 1.0s ボール飛行 = 計 2.5s で 100% → 0% へ。
  var progBar = document.createElement('div');
  progBar.id = '__cheat_prog';
  Object.assign(progBar.style, {
    position: 'fixed',
    left: '50%', top: '40%',
    transform: 'translate(-50%, -50%)',
    width: 'clamp(120px, 24vmin, 220px)',
    height: 'clamp(8px, 1.6vmin, 12px)',
    background: 'rgba(0,0,0,0.55)',
    border: '1.5px solid rgba(255,255,255,0.7)',
    borderRadius: '6px',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '9998',
    opacity: '0',
    transition: 'opacity 0.18s linear',
    boxShadow: '0 0 8px rgba(0,0,0,0.5)',
    boxSizing: 'border-box',
  });
  var progFill = document.createElement('div');
  Object.assign(progFill.style, {
    width: '100%',
    height: '100%',
    background: 'linear-gradient(90deg, #ff5560 0%, #f8e25e 50%, #4be8a0 100%)',
    transformOrigin: 'right center',
    transform: 'scaleX(1)',
    willChange: 'transform',
  });
  progBar.appendChild(progFill);
  document.body.appendChild(progBar);

  // P サポート: BEST 確定ボタン。
  // 投球は単発タッチで「球種・場所・ゲージ」が同時進行する仕様。投球側 (opr_mode==2) で
  // 投球未発射 (flg!=4,5,7) のとき表示、tap でフラグだけ立てる方式。pitch_dc 冒頭の
  // パッチが _bestPending を読んで pitch_opr_flg3_cnt2=41 (BEST タイミング) を強制する。
  var pBtn = document.createElement('button');
  pBtn.id = '__cheat_p';
  pBtn.textContent = '★ BEST ★';
  // スマホ最適化: 親指届きやすい位置 (右下、safe-area 加味)、サイズも viewport に合わせる
  Object.assign(pBtn.style, {
    position: 'fixed',
    right: 'max(16px, env(safe-area-inset-right))',
    bottom: 'calc(22% + env(safe-area-inset-bottom))',
    background: 'linear-gradient(180deg,#3ad6ff,#1060c8)',
    color: '#fff',
    border: '3px solid #fff',
    borderRadius: '14px',
    padding: 'clamp(10px, 2.5vmin, 14px) clamp(18px, 5vmin, 28px)',
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    fontSize: 'clamp(16px, 4.2vmin, 24px)',
    cursor: 'pointer',
    zIndex: '10001',
    display: 'none',
    boxShadow: '0 0 16px rgba(60,180,255,0.8), inset 0 0 8px rgba(180,255,255,0.5)',
    letterSpacing: '0.12em',
    pointerEvents: 'auto',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    minWidth: '120px',
    minHeight: '44px',
  });
  document.body.appendChild(pBtn);

  // canvas (document.addEventListener('touchstart', tev1) 等) にイベントが伝播しないよう、
  // ボタン上の全 touch/mouse イベントを stopPropagation で吸収。
  ['touchstart','touchend','touchmove','touchcancel','mousedown','mouseup','pointerdown','pointerup'].forEach(function(evt){
    pBtn.addEventListener(evt, function(e){ e.stopPropagation(); }, false);
  });

  pBtn.addEventListener('click', function(e){
    e.preventDefault(); e.stopPropagation();
    if(window.opr_mode !== 2) return;
    window.__cheat._bestPending = true;
    pBtn.style.display = 'none';
  });

  // 投球状態を監視して表示切替: 投球側 (opr_mode==2) でまだ投球発射前 (flg!=4,5,7) なら表示。
  setInterval(function(){
    try {
      var flg = window.pitch_opr_flg;
      var show = (window.opr_mode === 2)
              && (typeof flg === 'number')
              && (flg !== 4 && flg !== 5 && flg !== 7);
      pBtn.style.display = show ? 'block' : 'none';
    } catch(e){}
  }, 100);

  // 1 試合 1 回限定の HR 確定ボタン。条件: ストライク かつ 長打>=7 かつ未使用。
  // 押すと _hrPending を立てて、ボール到達時に batting_dst(0) を強制発火。
  // hit decision の OR 注入で hit_md=4 (HR) ブランチに入る。
  var hrBtn = document.createElement('button');
  hrBtn.id = '__cheat_hr';
  hrBtn.textContent = '★ HR ★';
  // スマホ最適化: BEST ボタンと同位置（opr_mode で排他表示なので衝突しない）
  Object.assign(hrBtn.style, {
    position: 'fixed',
    right: 'max(16px, env(safe-area-inset-right))',
    bottom: 'calc(22% + env(safe-area-inset-bottom))',
    background: 'linear-gradient(180deg,#ff6b3a,#c81020)',
    color: '#fff',
    border: '3px solid #fff',
    borderRadius: '14px',
    padding: 'clamp(10px, 2.5vmin, 14px) clamp(18px, 5vmin, 28px)',
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    fontSize: 'clamp(16px, 4.2vmin, 24px)',
    cursor: 'pointer',
    zIndex: '10001',
    display: 'none',
    boxShadow: '0 0 16px rgba(255,80,40,0.8), inset 0 0 8px rgba(255,255,180,0.5)',
    letterSpacing: '0.12em',
    pointerEvents: 'auto',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    minWidth: '120px',
    minHeight: '44px',
  });
  document.body.appendChild(hrBtn);

  // 球種名は window.disp_type をそのまま使う（dya.js の strike zone 表示と同じ）。
  // 矢印は pitch_result_sv_x / pitch_result_sv_y（変化球 break 込みの実着弾点）から算出。
  // X_FLIP は世界座標 → バッター視点の左右反転。F12 で window.__cheat.X_FLIP を切替可能。
  function pitchArrow(x, y, xFlip){
    var X_TH = 0.35;
    var Y_MID = 1.5, Y_TH = 0.4;
    var fx = xFlip * x;
    var tx = Math.abs(fx) < X_TH ? 0 : (fx > 0 ? 1 : -1);
    var ty = Math.abs(y - Y_MID) < Y_TH ? 0 : (y > Y_MID ? 1 : -1);
    var map = {
      '-1,1':'↖','0,1':'↑','1,1':'↗',
      '-1,0':'←','0,0':'・','1,0':'→',
      '-1,-1':'↙','0,-1':'↓','1,-1':'↘'
    };
    return map[tx+','+ty] || '・';
  }

  // dya.js の strike zone 判定をそのまま再現:
  //   |pitch_result_sv_x| <= 0.66 かつ 0.73 <= pitch_result_sv_y <= 2.275 → ストライク
  function judgeSB(x, y){
    if(Math.abs(x) <= 0.66 && y >= 0.73 && y <= 2.275) return 'S';
    return 'B';
  }

  // 球種名を整える。ストレート + pitch_pw==1 + |20|/|21| フラグ持ちの投手のときは
  // 「ストレート（ノビ）」「ストレート（ホップ）」と注記する。
  function getDisplayName(){
    var name = window.disp_type || '?';
    if(window.pitch_type === 0 && window.pitch_pw === 1){
      var rv = (window.inning_rv|0);
      var pchRow = (window.pch_dat && window.pch_dat[rv]) || [];
      var flags = pchRow[13] || '';
      if(flags.indexOf('|21|') > -1) return 'ストレート（ホップ）';
      if(flags.indexOf('|20|') > -1) return 'ストレート（ノビ）';
    }
    return name;
  }

  // ワールド座標 (x, y, 174.2) を画面座標 (px, py) に投影。
  function worldToScreen(wx, wy){
    if(!window.THREE || !window.camera) return null;
    var canvas = document.getElementById('myCanvas');
    if(!canvas) return null;
    var v = new window.THREE.Vector3(wx, wy, 174.2);
    v.project(window.camera);
    var rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x + 1) / 2 * rect.width,
      y: rect.top  + (-v.y + 1) / 2 * rect.height,
    };
  }

  // 着弾点ボールはストレート/変化球どちらも表示する（aim と最終位置が一致するストレートでも
  // コースの目安として有用）。
  function showBallIndicator(px, py){
    var pos = worldToScreen(px, py);
    if(!pos){ ballEl.style.opacity = '0'; return; }
    ballEl.style.left = pos.x + 'px';
    ballEl.style.top  = pos.y + 'px';
    ballEl.style.opacity = '0.55';
  }

  // 投球到来カウントダウン: 1.5s 確認時間 + 約 1.0s 飛行 = 2.5s で 100% → 0% に縮む。
  // 残量に応じてバーが赤(残少) ← 黄 ← 緑(残多) の順で見える（左に縮む）。
  // bz が plate (>=173) を越えたら即終了させて余韻を残さない。
  function startCountdownBar(){
    progBar.style.opacity = '0.85';
    progFill.style.transition = 'none';
    progFill.style.transform = 'scaleX(1)';
    // 強制 reflow → transition 再有効化（次フレームから滑らかに縮小）
    void progFill.offsetWidth;
    progFill.style.transition = 'transform 60ms linear';
    var startT = Date.now();
    var TOTAL = 2500;
    if(window.__cheat._progTimer) clearInterval(window.__cheat._progTimer);
    window.__cheat._progTimer = setInterval(function(){
      try {
        var elapsed = Date.now() - startT;
        var bz = window.bz;
        var ratio = Math.max(0, Math.min(1, 1 - elapsed / TOTAL));
        // ボールが plate に到達済なら強制終了
        var arrived = (typeof bz === 'number' && bz >= 173);
        if(arrived){ ratio = 0; }
        progFill.style.transform = 'scaleX(' + ratio + ')';
        if(arrived || elapsed >= TOTAL + 200){
          clearInterval(window.__cheat._progTimer);
          window.__cheat._progTimer = null;
          progBar.style.opacity = '0';
        }
      } catch(e){
        clearInterval(window.__cheat._progTimer);
        window.__cheat._progTimer = null;
        progBar.style.opacity = '0';
      }
    }, 32);
  }

  window.__cheat._hudTimer = null;
  window.__cheat._ballTimer = null;
  window.__cheat._hrTimer = null;
  window.__cheat._progTimer = null;
  // _hrUsed: 1 試合 1 回の使用記録 (match_start パッチでリセット)
  // _hrPending: 押した瞬間に立て、hit_md=4 ブランチで自動的に倒される
  window.__cheat._hrUsed = false;
  window.__cheat._hrPending = false;
  // _bestPending: BEST ボタン押下時に立つ。次の pitch_dc 呼出で消費される。
  window.__cheat._bestPending = false;

  // X_FLIP: 1 = ワールド座標そのまま、-1 = 反転。
  // 逆になっていたら DevTools で window.__cheat.X_FLIP = -1 で即時切替可。
  window.__cheat.X_FLIP = 1;

  function hideHrBtn(){ hrBtn.style.display = 'none'; }

  // ボール到達時に「強制 hit 判定」を発火する。
  // batting_dst の outer if は swing_judge==0 && hit_Rds<hit_real_Rds && opr_mode==1 でも
  // fire するので、bat_x/y を予測着弾点に重ねて batting_dst(0) を直接呼べばスイングモーション
  // 無しで hit 判定に入る。_hrPending OR 注入で hit_md=4 (HR) ブランチへ。
  function fireHRWhenBallArrives(){
    var fired = false;
    var pollStart = Date.now();
    var poll = setInterval(function(){
      try {
        if(fired){ clearInterval(poll); return; }
        var bz = window.bz;
        if(typeof bz === 'number' && bz >= 170 && bz <= 176){
          if(typeof window.pitch_result_x === 'number' && window.pitch_result_x > 0){
            window.bat_x = window.pitch_result_x;
            window.bat_y = window.pitch_result_y;
          }
          window.swing_judge = 0;
          if(typeof window.batting_dst === 'function'){
            window.batting_dst(0);
          }
          fired = true;
          clearInterval(poll);
        }
        if(Date.now() - pollStart > 10000){ clearInterval(poll); }
      } catch(e){ clearInterval(poll); }
    }, 8);
  }

  ['touchstart','touchend','touchmove','touchcancel','mousedown','mouseup','pointerdown','pointerup'].forEach(function(evt){
    hrBtn.addEventListener(evt, function(e){ e.stopPropagation(); }, false);
  });

  hrBtn.addEventListener('click', function(e){
    e.preventDefault(); e.stopPropagation();
    if(window.__cheat._hrUsed) return;
    window.__cheat._hrPending = true;
    window.__cheat._hrUsed = true;
    hideHrBtn();
    fireHRWhenBallArrives();
  });

  window.__cheat.onPitch = function(){
    try {
      var name = getDisplayName();
      var sp = (typeof window.disp_sp === 'number' && window.disp_sp > 0) ? window.disp_sp : '--';
      var px = window.pitch_result_sv_x;
      var py = window.pitch_result_sv_y;
      if(typeof px !== 'number' || isNaN(px)) px = +window.v_schd_x || 0;
      if(typeof py !== 'number' || isNaN(py)) py = +window.v_schd_y || 0;
      var arrow = pitchArrow(px, py, window.__cheat.X_FLIP);
      var sb = judgeSB(px, py);
      var sbColor = (sb === 'S') ? '#ff5560' : '#6ec0ff';
      hud.innerHTML = '<span style="color:'+sbColor+';font-size:1.15em">[' + sb + ']</span> '
                    + name + ' ' + arrow + ' ' + sp + 'km/h';
      hud.style.opacity = '1';
      showBallIndicator(px, py);
      startCountdownBar();

      // HR ボタン表示判定: 未使用 + ストライク + 長打>=7
      var canHr = (!window.__cheat._hrUsed)
               && (sb === 'S')
               && ((window.prm_pw|0) >= 7);
      hrBtn.style.display = canHr ? 'block' : 'none';

      if(window.__cheat._hudTimer) clearTimeout(window.__cheat._hudTimer);
      if(window.__cheat._ballTimer) clearTimeout(window.__cheat._ballTimer);
      if(window.__cheat._hrTimer) clearTimeout(window.__cheat._hrTimer);
      // 確認時間 1.5s に合わせて HUD/ボールも長めに残す（合計 2.8s 表示）
      window.__cheat._hudTimer = setTimeout(function(){ hud.style.opacity = '0'; }, 2800);
      window.__cheat._ballTimer = setTimeout(function(){ ballEl.style.opacity = '0'; }, 2800);
      window.__cheat._hrTimer = setTimeout(hideHrBtn, 2800);
    } catch(e){ /* HUD 失敗してもゲーム続行 */ }
  };
`;

// --- ONLINE 専用: マイチームクールダウン挙動の調査ハーネス ---
// F12 コンソールから window.__cheat.lab.* を叩いてサーバの挙動を観察する。
// /__proxy/db.dya.jp/db/ にアクセスするのでオンライン版でのみ意味がある。
const ONLINE_LAB_HARNESS = `
  // === Gacha 実験ハーネス ===
  window.__cheat.lab = (function(){
    var BASE = location.origin + '/__proxy/db.dya.jp/db/';
    function _post(path, body){
      return fetch(BASE + path, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: body,
        credentials: 'include',
      }).then(function(r){ return r.text().then(function(t){ return {status:r.status, text:t}; }); });
    }
    function _params(obj){
      return Object.keys(obj).map(function(k){
        return encodeURIComponent(k)+'='+encodeURIComponent(obj[k]);
      }).join('&');
    }
    function gachaOnce(){
      return _post('dya_db_mytm_get_2025_07_17.php', _params({
        send_password: window.sv_psw,
        send_conf: window.sv_conf,
      }));
    }
    function race(n){
      n = n || 5;
      var promises = [];
      for(var i=0;i<n;i++) promises.push(gachaOnce());
      return Promise.all(promises).then(function(results){
        console.log('[lab.race] '+n+' parallel requests:');
        var summary = {success:0, error:0, raw:[]};
        results.forEach(function(r, i){
          var info = '['+i+'] HTTP '+r.status+' :: ';
          try {
            var j = JSON.parse(r.text);
            if(j.error_code != undefined && Math.floor(j.error_code) === 0){
              summary.success++;
              info += 'SUCCESS mytm_get='+ j.mytm_get;
            } else {
              summary.error++;
              info += 'ERROR error='+(j.error||'')+' code='+(j.error_code||'');
            }
            summary.raw.push(j);
          } catch(e){ info += 'PARSE_FAIL '+r.text.substr(0,80); summary.raw.push(null); }
          console.log(info);
        });
        console.log('[lab.race] success='+summary.success+' error='+summary.error);
        return summary;
      });
    }
    function probeAct(start, end){
      start = start||0; end = end||30;
      console.log('[lab.probeAct] '+start+' to '+end);
      var seq = Promise.resolve();
      var seen = {};
      for(var v=start; v<=end; v++){
        (function(act){
          seq = seq.then(function(){
            return _post('dya_db.php', _params({
              password: window.sv_psw, act: act, send_conf: window.sv_conf,
              send_data1: '', send_crt: 0,
            })).then(function(r){
              var txt = r.text.substr(0, 120);
              var key = r.status+'|'+(txt.length>40?txt.substr(0,40):txt);
              if(!seen[key]){
                seen[key]=true;
                console.log('[act='+act+'] HTTP '+r.status+' :: '+txt);
              }
            });
          });
        })(v);
      }
      return seq;
    }
    function probeParam(extraName, extraVal){
      var p = {send_password: window.sv_psw, send_conf: window.sv_conf};
      p[extraName] = extraVal;
      return _post('dya_db_mytm_get_2025_07_17.php', _params(p)).then(function(r){
        console.log('[probeParam '+extraName+'='+extraVal+'] HTTP '+r.status+' :: '+r.text.substr(0,200));
        return r;
      });
    }
    function probeParamBulk(){
      var names = ['send_player_id','send_admin','send_force','send_target','send_id',
                   'send_skip_cooldown','send_debug','send_test','send_no_limit',
                   'send_count','send_repeat','send_now','send_time'];
      var seq = Promise.resolve();
      names.forEach(function(n){
        seq = seq.then(function(){ return probeParam(n,'1'); });
      });
      return seq;
    }
    function destAndRetry(){
      console.log('[lab.destAndRetry] step1: gachaOnce');
      return gachaOnce().then(function(r1){
        console.log('[step1] '+r1.text.substr(0,200));
        console.log('[step2] dest');
        return _post('dya_db_mytm_dest.php', _params({
          send_password: window.sv_psw, send_conf: window.sv_conf,
          send_drop: '', send_order: '',
        }));
      }).then(function(r2){
        console.log('[step2] '+r2.text.substr(0,200));
        console.log('[step3] gachaOnce 再試行');
        return gachaOnce();
      }).then(function(r3){
        console.log('[step3] '+r3.text.substr(0,200));
      });
    }
    function info(){
      console.log('sv_psw=', window.sv_psw, ' sv_conf=', window.sv_conf, ' sv_id=', window.sv_id);
    }
    return { gachaOnce: gachaOnce, race: race, probeAct: probeAct,
             probeParam: probeParam, probeParamBulk: probeParamBulk,
             destAndRetry: destAndRetry, info: info };
  })();
  // (リロール機能はユーザ要望で削除済。期限切れキャラ視覚非表示パッチで代替。)
  window.__cheat._removed_reroll = true;
`;

// --- OFFLINE 専用ブートストラップ: 外部URLは599スタブ、io/AdBreakもスタブ ---
const OFFLINE_BOOTSTRAP_TAIL = `
  // ===== モード選択 =====
  // proxy.js のランチャー (/) から ?cheat=1 or ?cheat=0 で起動。
  // file:// 起動時はクエリ無し → 通常版扱い。
  window.__cheat_enabled = (function(){
    try { return new URLSearchParams(location.search).get('cheat') === '1'; }
    catch(e){ return false; }
  })();

  // ===== OFFLINE: fetch / XHR の外部URLは 599 スタブ =====
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init){
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var mapped = resolveAsset(url);
      if(mapped) return origFetch(mapped, init);
      if(/^https?:\\/\\//.test(url)){
        return Promise.resolve(new Response('', {status:599, statusText:'offline'}));
      }
    } catch(e){}
    return origFetch ? origFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url){
    var args = Array.prototype.slice.call(arguments);
    try {
      var mapped = resolveAsset(url);
      if(mapped){ this.__offlineRedirected = true; args[1] = mapped; return origOpen.apply(this, args); }
      if(/^https?:\\/\\//.test(url)){ this.__offlineExternal = true; }
    } catch(e){}
    return origOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function(body){
    if(this.__offlineExternal){
      var xhr = this;
      setTimeout(function(){
        try {
          Object.defineProperty(xhr, 'readyState', {value:4, configurable:true});
          Object.defineProperty(xhr, 'status', {value:0, configurable:true});
          Object.defineProperty(xhr, 'responseText', {value:'', configurable:true});
          if(typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
          if(typeof xhr.onerror === 'function') xhr.onerror({});
          xhr.dispatchEvent && xhr.dispatchEvent(new Event('error'));
        } catch(e){}
      }, 0);
      return;
    }
    return origSend.apply(this, arguments);
  };

  // io / socket スタブ
  if(typeof window.io === 'undefined'){
    var fakeSock = { on: function(){return this;}, socket: { options: {} }, json: { emit: function(){} }, emit: function(){}, disconnect: function(){} };
    window.io = { connect: function(){ return fakeSock; } };
  }

  // AdSense スタブ
  window.adsbygoogle = window.adsbygoogle || [];
  function adStub(o){
    if(!o || typeof o !== 'object') return;
    if(typeof o.onReady === 'function')        setTimeout(function(){ try{ o.onReady({}); }catch(e){} }, 20);
    if(typeof o.adBreakStarted === 'function') setTimeout(function(){ try{ o.adBreakStarted({}); }catch(e){} }, 30);
    if(typeof o.adViewed === 'function')       setTimeout(function(){ try{ o.adViewed({}); }catch(e){} }, 40);
    if(typeof o.adBreakDone === 'function')    setTimeout(function(){ try{ o.adBreakDone({breakStatus:'viewed'}); }catch(e){} }, 60);
  }
  window.adBreak = adStub;
  window.adConfig = adStub;

  // dya.js パッチが安全に参照できるよう、空オブジェクトだけは常に用意。
  window.__cheat = window.__cheat || {};

  // ===== ORIGINAL TEAM mode helper =====
  // データの取得経路（/offline?original=1 のとき）:
  //   sessionStorage['__orig_teams_data']  (アップロード後 reload 経由で渡される)
  //   無ければ全画面 overlay でユーザに JSON ファイルアップロードを要求。
  //
  // 永続的な localStorage は使わない（マルチアカウント・残留データ事故を避けるため）。
  // sessionStorage はタブを閉じれば消える。新規タブで起動すると再アップロードが必要。
  //
  // __build_original_record は JSON の 1 選手分を team_data 形式のレコード文字列に再構築する。
  // window.__orig_teams_data が揃った時のみ team_data の switch 直前パッチが分岐する。
  //
  // 重要: dya.js の team_data_set は 14-digit / 9-digit フィールドを **ASCII 直接** 読む
  //   (例: bt_pd[i3][i] = tmpd[1].split(''), pch_dat[i3][i4] = tmpd[2].substr(i4,1))
  // ので、base62 エンコードはせず生の数字文字列を出力する。
  (function(){
    var SESSION_KEY = '__orig_teams_data';
    var __overlayShown = false;     // ← 先頭で初期化（var ホイスティング事故を避ける）

    // 旧版が localStorage を使っていたので、残留があれば消しておく（マルチアカ事故防止）。
    try { localStorage.removeItem(SESSION_KEY); } catch(_) {}

    var __isOriginal = /[?&]original=1\b/.test(location.search);
    if (__isOriginal) {
      try {
        var __ss = sessionStorage.getItem(SESSION_KEY);
        if (__ss) {
          var __parsed = JSON.parse(__ss);
          if (__parsed && Array.isArray(__parsed.teams) && __parsed.teams.length === 12) {
            window.__orig_teams_data = __parsed;
            console.log('%c[ORIG TEAM] loaded from sessionStorage (' + __parsed.teams.length + ' teams)',
              'background:#1c4a78;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold');
          }
        }
      } catch (e) { console.warn('[ORIG TEAM] sessionStorage load failed:', e); }

      // データが無ければ全画面 overlay で upload を要求
      if (!window.__orig_teams_data) {
        document.addEventListener('DOMContentLoaded', __showOrigUploadOverlay);
        // DOMContentLoaded が既に発火済みのケース（'interactive' / 'complete'）
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
          __showOrigUploadOverlay();
        }
      }
    }

    function __showOrigUploadOverlay(){
      if (__overlayShown) return;
      __overlayShown = true;
      var ov = document.createElement('div');
      ov.id = '__orig_upload_overlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;'
        + 'background:rgba(8,12,22,0.97);display:flex;flex-direction:column;'
        + 'align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));'
        + 'color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Yu Gothic UI","Meiryo",sans-serif;'
        + 'box-sizing:border-box;text-align:center;';
      ov.innerHTML = ''
        + '<div style="font-size:clamp(20px,5.5vmin,28px);font-weight:700;margin-bottom:8px;">🏟️ オリジナルチーム CPU 対戦</div>'
        + '<div style="font-size:clamp(12px,3.2vmin,14px);color:#aac;margin-bottom:24px;line-height:1.6;max-width:480px;">'
        +   'チーム編集ツールでダウンロードした<br><code style="background:#222;padding:2px 6px;border-radius:4px;color:#fc8;">original_teams_*.json</code><br>'
        +   'を選択してください。'
        + '</div>'
        + '<label id="__orig_upload_btn" for="__orig_upload_input"'
        +   ' style="display:inline-block;padding:clamp(14px,4vmin,18px) clamp(28px,6vmin,40px);'
        +   ' background:linear-gradient(180deg,#d8a82a,#946610);color:#1c1f24;font-weight:700;'
        +   ' font-size:clamp(15px,4.5vmin,18px);border-radius:14px;cursor:pointer;border:2px solid #fff;'
        +   ' box-shadow:0 0 14px rgba(220,180,80,0.5);min-width:200px;-webkit-tap-highlight-color:transparent;">'
        +   '📂 JSON を選択</label>'
        + '<input type="file" id="__orig_upload_input" accept=".json,application/json" style="display:none;">'
        + '<div id="__orig_upload_msg" style="margin-top:14px;font-size:clamp(12px,3.2vmin,14px);min-height:1.4em;color:#fc8;"></div>'
        + '<div style="margin-top:32px;display:flex;flex-direction:column;gap:10px;align-items:center;">'
        +   '<a href="/editor" style="color:#9cb;font-size:clamp(11px,3vmin,13px);text-decoration:underline;">'
        +     '🛠️ JSON が無い? チーム編集ツールで作成</a>'
        +   '<a href="/" style="color:#789;font-size:clamp(11px,3vmin,13px);text-decoration:underline;">'
        +     '↩ ランチャーに戻る</a>'
        + '</div>';
      document.body.appendChild(ov);
      var inp = document.getElementById('__orig_upload_input');
      var msg = document.getElementById('__orig_upload_msg');
      inp.addEventListener('change', function(e){
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        msg.textContent = '読み込み中… ' + f.name;
        msg.style.color = '#9cb';
        var reader = new FileReader();
        reader.onload = function(){
          try {
            var parsed = JSON.parse(reader.result);
            if (!parsed || !Array.isArray(parsed.teams) || parsed.teams.length !== 12) {
              throw new Error('JSON 形式が不正です（teams 配列が 12 要素ではありません）');
            }
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
            msg.textContent = '✓ 読み込み成功 ('+ parsed.teams.length +' チーム) → ゲームを起動します…';
            msg.style.color = '#9fb';
            setTimeout(function(){ location.reload(); }, 400);
          } catch (err) {
            msg.textContent = '✗ ' + err.message;
            msg.style.color = '#f88';
            inp.value = '';
          }
        };
        reader.onerror = function(){ msg.textContent = '✗ ファイル読込エラー'; msg.style.color = '#f88'; };
        reader.readAsText(f, 'utf-8');
      });
    }

    function digit(v){
      // raw 1-10 を 1 桁 (0-9) に変換。10 → 0 にスワップ
      // (team_data_set が 0 → 10 に戻すため、内部 1-10 を外部 1-9+0 にマッピング)。
      if(typeof v !== 'number') v = parseInt(v) || 0;
      if(v === 10) v = 0;
      return Math.max(0, Math.min(9, v));
    }
    function rawDigit(v){
      // condition 等で 0-9 の値域そのまま使う場合（0→10 swap しない）。
      if(typeof v !== 'number') v = parseInt(v) || 0;
      return Math.max(0, Math.min(9, v));
    }
    function encodeBatter14(s){
      // bt_pd[][0..13] = 14 桁、各文字が 1 stat。
      //   [0]=power, [1]=contact, [2]=eye, [3]=speed,
      //   [4..12]=defense_unused_0..8,
      //   [13]=batting_hand (1=R, 2=L, 3=switch)
      // 旧フィールド名 'kd' / 'stat4'-'stat12' との互換フォールバック付き。
      var d = "";
      d += digit(s.power);
      d += digit(s.contact);
      d += digit(s.eye != null ? s.eye : s.kd);
      d += digit(s.speed);
      d += digit(s.defense_unused_0 != null ? s.defense_unused_0 : s.stat4);
      d += digit(s.defense_unused_1 != null ? s.defense_unused_1 : s.stat5);
      d += digit(s.defense_unused_2 != null ? s.defense_unused_2 : s.stat6);
      d += digit(s.defense_unused_3 != null ? s.defense_unused_3 : s.stat7);
      d += digit(s.defense_unused_4 != null ? s.defense_unused_4 : s.stat8);
      d += digit(s.defense_unused_5 != null ? s.defense_unused_5 : s.stat9);
      d += digit(s.defense_unused_6 != null ? s.defense_unused_6 : s.stat10);
      d += digit(s.defense_unused_7 != null ? s.defense_unused_7 : s.stat11);
      d += digit(s.defense_unused_8 != null ? s.defense_unused_8 : s.stat12);
      d += rawDigit(s.batting_hand);    // 1=R, 2=L, 3=switch
      return d;
    }
    function encodePitcher9(ps){
      // pch_dat[][0..8] = 9 桁、各文字が 1 stat。
      //   [0]=speed, [1]=control, [2]=stamina_rank,
      //   [3]=break_slider, [4]=break_curve, [5]=break_fork,
      //   [6]=break_screw, [7]=break_shoot, [8]=handedness (1=R, 2=L)
      var d = "";
      d += digit(ps.speed);
      d += digit(ps.control);
      d += digit(ps.stamina_rank);
      d += digit(ps.break_slider);
      d += digit(ps.break_curve);
      d += digit(ps.break_fork);
      d += digit(ps.break_screw);
      d += digit(ps.break_shoot);
      d += rawDigit(ps.handedness);
      return d;
    }
    function encodeDefense9(arr){
      // defensive_eligibility[0..8] = P/C/1B/2B/3B/SS/LF/CF/RF, 各 0-9
      var a = (arr || []).slice(0, 9);
      while(a.length < 9) a.push(1);
      return a.map(function(v){ return rawDigit(v); }).join('');
    }
    window.__build_original_record = function(p){
      if(!p) return "??#00000000000000#000000000*1*1*1*1*1*888888*0*0#";
      var bs = p.batter_stats || {};
      var raw14;
      try { raw14 = encodeBatter14(bs); }
      catch(e){ console.warn('[orig-team] batter encode error for', p.name, e); raw14 = "00000000000001"; }

      // 9-digit: pitcher の場合は pitcher_stats、それ以外は defensive_eligibility
      var raw9;
      try {
        if (p.is_pitcher && p.pitcher_stats) raw9 = encodePitcher9(p.pitcher_stats);
        else raw9 = encodeDefense9(p.defensive_eligibility);
      } catch(e){ console.warn('[orig-team] 9-digit encode error for', p.name, e); raw9 = "111111111"; }

      var dh = p.display_hint || {};
      var skinHex = (p.skin_color || '#434343').replace(/^#/, '');
      var stars = [
        raw9,
        dh.power    != null ? dh.power    : 50,
        dh.contact  != null ? dh.contact  : 10,
        dh.speed    != null ? dh.speed    : 20,
        dh.defense  != null ? dh.defense  : 5,
        dh.overall  != null ? dh.overall  : 50,
        skinHex,
        dh.pos_type != null ? dh.pos_type : (p.is_pitcher ? 1 : 0),
        p.secondary_ability != null ? p.secondary_ability : 0,
      ].join('*');
      var flags = (p.special_flags && p.special_flags.length > 0)
        ? '|' + p.special_flags.join('|') + '|'
        : '';
      var nm = String(p.name || '?').slice(0, 7);
      return nm + '#' + raw14 + '#' + stars + '#' + flags;
    };
    if (window.__orig_teams_data && window.__orig_teams_data.teams) {
      console.log('%c[ORIG TEAM] active - ' + window.__orig_teams_data.teams.length + ' teams loaded',
        'background:#7a5e10;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold');
    }
  })();

  // ===== ↓↓↓ ここからチート UI （チート版モードでのみ有効）↓↓↓ =====
  if (window.__cheat_enabled) {
${CHEAT_UI_BOOTSTRAP}
  } // ===== ↑↑↑ チート UI ここまで ↑↑↑ =====
`;

// --- ONLINE 専用ブートストラップ: 外部URLを /__proxy/<host>/<path> に書換、document.domain spoof ---
const ONLINE_BOOTSTRAP_TAIL = `
  // ビルドタイムスタンプ（HTML がキャッシュ済か新しい版かを console で即判定）。
  // F12 console に「色付き SV BUILD: <yyyy-mm-dd hh:mm>」が出れば最新版を読み込んでいる。
  console.warn('%c[SV BUILD ${new Date().toISOString().slice(0,16).replace('T',' ')}]', 'background:#0a4d3a;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold');

  // ===== モード選択 =====
  // proxy.js のランチャー (/) で選択し ?cheat=1 or ?cheat=0 を URL クエリで渡す。
  // localStorage は使わず毎回ランチャーから選び直す方式。直接 /online を開いた場合は
  // クエリ無し → 通常版扱い。
  window.__cheat_enabled = (function(){
    try { return new URLSearchParams(location.search).get('cheat') === '1'; }
    catch(e){ return false; }
  })();

  // ===== ONLINE: 外部 HTTPS/WSS を local proxy 経由に書換 =====
  var PROXY_PREFIX = '/__proxy/';
  var PROXY_HOSTS = /^(?:[a-z0-9-]+\\.)*(?:dya\\.jp|splax\\.net|splaxserver\\.net)$/i;

  function toProxyUrl(url){
    if(typeof url !== 'string') return url;
    var m = url.match(/^(https?|wss?):\\/\\/([^\\/?#]+)([^]*)$/i);
    if(!m) return url;
    var host = m[2].split(':')[0];
    if(!PROXY_HOSTS.test(host)) return url;  // 未知ホストは触らない
    var pageSecure = location.protocol === 'https:';
    var isWs = m[1].toLowerCase() === 'wss' || m[1].toLowerCase() === 'ws';
    var scheme = isWs ? (pageSecure ? 'wss' : 'ws') : (pageSecure ? 'https' : 'http');
    return scheme + '://' + location.host + PROXY_PREFIX + m[2] + m[3];
  }

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init){
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var mapped = resolveAsset(url);
      if(mapped) return origFetch(mapped, init);
      var rewritten = toProxyUrl(url);
      if(rewritten !== url){
        var opts = init || {};
        if(opts.credentials === undefined) opts.credentials = 'include';
        return origFetch(rewritten, opts);
      }
    } catch(e){}
    return origFetch ? origFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    var args = Array.prototype.slice.call(arguments);
    try {
      var mapped = resolveAsset(url);
      if(mapped){ args[1] = mapped; }
      else { args[1] = toProxyUrl(url); }
      this.withCredentials = true;
    } catch(e){}
    return origOpen.apply(this, args);
  };

  // WebSocket constructor の差し替え（socket.io 内部の new WebSocket もここを通る）
  if(typeof WebSocket !== 'undefined'){
    var OrigWS = WebSocket;
    function WSWrap(url, protocols){
      var rewritten = toProxyUrl(url);
      var ws = protocols !== undefined ? new OrigWS(rewritten, protocols) : new OrigWS(rewritten);
      return ws;
    }
    WSWrap.prototype = OrigWS.prototype;
    WSWrap.OPEN = OrigWS.OPEN; WSWrap.CLOSED = OrigWS.CLOSED;
    WSWrap.CONNECTING = OrigWS.CONNECTING; WSWrap.CLOSING = OrigWS.CLOSING;
    window.WebSocket = WSWrap;
  }

  // ===== Saved-data 層 (capture / replay) =====
  // 通常 online (saved=0): /__proxy/* 対象ホスト宛のレスポンスを localStorage にプロフィール別保存
  // /offline?saved=1: XHR を network に出さずキャッシュから合成 → ネット無しでログイン〜マイチーム可
  // プロフィールキー: sv_psw FNV-1a 8hex（パスワード平文は保存しない）
  var __sv_replay = (function(){
    try { return new URLSearchParams(location.search).get('saved') === '1'; }
    catch(e){ return false; }
  })();
  window.__saved_replay = __sv_replay;

  function __sv_fnv1a(str){
    var h = 0x811c9dc5 >>> 0;
    for(var i=0; i<str.length; i++){
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function __sv_bodyToString(body){
    if(body == null) return '';
    if(typeof body === 'string') return body;
    if(typeof FormData !== 'undefined' && body instanceof FormData){
      var parts = [];
      body.forEach(function(v,k){ parts.push(encodeURIComponent(k)+'='+encodeURIComponent(v)); });
      return parts.join('&');
    }
    if(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams){
      return body.toString();
    }
    if((typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) ||
       (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(body))){
      return '[binary]';
    }
    return String(body);
  }

  function __sv_isProxyTarget(url){
    if(typeof url !== 'string') return false;
    var m = url.match(/^https?:\\/\\/([^\\/?#]+)/i);
    if(!m) return false;
    var host = m[1].split(':')[0];
    return PROXY_HOSTS.test(host);
  }

  function __sv_shouldCache(url){
    if(!__sv_isProxyTarget(url)) return false;
    if(url.indexOf('/socket.io/') >= 0) return false;
    return true;
  }

  // 書込系エンドポイント判定（マイチーム編成変更系）。Phase 3a の URL-only fallback と
  // writes log のトリガに使う。
  function __sv_isWriteEndpoint(url){
    return /\\/dya_db_mytm_(?:dest|hold|order)\\.php/.test(url);
  }

  // ガチャエンドポイント判定。dya_db_mytm_get_<日付>.php は名前に反して
  // 「ガチャ抽選」専用の API（senddb_mytm() が唯一の呼び出し元、case 650 経由）。
  // replay モードではキャッシュ無視で擬似抽選レスポンスを合成する。
  function __sv_isGachaCall(url){
    return /\\/dya_db_mytm_get[_a-zA-Z0-9]*\\.php/.test(url);
  }

  // cache miss だが既知のフォーマットの URL は default success 応答を合成して返す。
  //  - ip_chk2.php: "0|0|0|0|0" (sv_ctch[0]=0 → ブロックされていない判定)
  //  - mytm_dest/hold/order.php (write endpoints):
  //      応答ハンドラは JSON.parse(text) → if(data.error) を見るだけで data.user_data は
  //      使わない。空 JSON "{}" を返せば else 枝に落ちて mytm_clb=1 / thbnt=2000 が
  //      セットされ、6秒タイムアウト (vs_inning_tb=82 「データベース接続に失敗」) を回避できる。
  //      ※キャッシュが無い書込は in-memory のみで反映され、リロードしても snapshot 経由で残る。
  // dya_db.php は意図的にスタブしない: login (act=1) で cache miss → "{}" を返すと message
  // 不一致で response handler の default → sv_cn=1 → 即 vs_inning_tb=82 という最悪のケースに
  // なる。本物のキャッシュが見つからなければ 599 で握り潰し、login screen の 15s タイムアウト
  // 経由で穏やかに失敗させる。
  function __sv_synthesizeFallback(url){
    if(/\\/ip_chk2\\.php/.test(url)) return '0|0|0|0|0';
    if(__sv_isWriteEndpoint(url)){
      console.log('[saved replay] synthesized {} for write endpoint:', url);
      return '{}';
    }
    return null;
  }

  // 擬似ガチャ: window.s_name + window.star_rank (dya.js ロード後に揃う) を読んで
  // 重み付き乱数で 1 体引く。レアリティ別重み:
  //   ★1=25% ★2=25% ★3=25% ★4=15% ★5=10% (オフライン用にやや甘め)
  // レスポンス形: {"error_code":0,"mytm_get":"<id>"} で十分（dya.js は mytm_get を
  // split("#") して get_pl_nm1[0] = picked ID, error_code==0 で成功扱い）。
  function __sv_synthesizeGacha(){
    try {
      var sName = window.s_name || '';
      var sRank = window.star_rank || '';
      if(!sName || !sRank){
        console.warn('[saved replay] gacha: s_name/star_rank not loaded yet');
        return null;
      }
      var sParts = sName.split('#');
      var ids = [];
      for(var i=0; i<sParts.length; i+=2){
        var id = sParts[i];
        if(id && id.length === 2) ids.push(id);
      }
      var srParts = sRank.split('#');
      var rarityById = {};
      for(var j=0; j<srParts.length-1; j+=2){
        var rid = srParts[j], rr = parseInt(srParts[j+1], 10);
        if(rid && rr) rarityById[rid] = rr;
      }
      var weights = [0, 25, 25, 25, 15, 10];   // index 0 unused, 1..5 = rarity
      var totalW = 100;
      var roll = Math.random() * totalW;
      var pickedR = 1, acc = 0;
      for(var r=1; r<=5; r++){
        acc += weights[r];
        if(roll < acc){ pickedR = r; break; }
      }
      var candidates = ids.filter(function(id){ return rarityById[id] === pickedR; });
      if(candidates.length === 0) candidates = ids;
      var pickedId = candidates[Math.floor(Math.random() * candidates.length)];
      var responseText = JSON.stringify({ error_code: 0, mytm_get: pickedId });
      console.log('[saved replay] gacha pull → ' + pickedId + ' (★' + pickedR + ', ' + candidates.length + ' candidates)');
      // window.__sv_writes にもガチャを記録（書込トレースと同じ buffer）
      window.__sv_writes = window.__sv_writes || [];
      window.__sv_writes.push({ ts: Date.now(), url: 'gacha', method: 'SYNTH', body: '★'+pickedR, result: pickedId });
      if(window.__sv_writes.length > 50) window.__sv_writes.shift();
      return responseText;
    } catch(e){
      console.error('[saved replay] gacha synthesis failed:', e);
      return null;
    }
  }

  // dya.js は psw を 3 種のフィールド名で送る:
  //   - "password="     senddb (login / heartbeat) 用 — 主 login 経路
  //   - "send_password=" senddb_mytm_* (dest/hold/order/gacha) 用
  //   - "sv_psw="       歴史的、現行 dya.js には無いが互換のため残す
  // ※ 並びは長いものから先（"send_password" を "password" より先にマッチさせる）。
  function __sv_extractPsw(bodyStr){
    var m = bodyStr.match(/(?:^|&)(?:send_password|sv_psw|password)=([^&]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // body から揮発フィールド (session token 等) を落として並べ替え → キーが安定
  // dya.js の send_conf がサーバセッショントークンで毎回変わる主因。これを残すと
  // 同じ意図の request が別キーに散る。time/t/_/ts/nonce も典型的な cache buster。
  // sv_conf は歴史的フィールド名で現行 dya.js には無いが互換のため残す。
  var __sv_VOLATILE_KEYS = { send_conf: 1, sv_conf: 1, time: 1, t: 1, '_': 1, ts: 1, nonce: 1, cache: 1 };
  function __sv_normalizeBody(body){
    var s = __sv_bodyToString(body);
    if(!s) return '';
    var pairs = s.split('&');
    var kept = [];
    for(var i=0; i<pairs.length; i++){
      var eq = pairs[i].indexOf('=');
      var k = eq < 0 ? pairs[i] : pairs[i].slice(0, eq);
      if(__sv_VOLATILE_KEYS[k]) continue;
      kept.push(pairs[i]);
    }
    kept.sort();
    return kept.join('&');
  }

  function __sv_makeKey(url, body){
    return __sv_fnv1a(url + '|' + __sv_normalizeBody(body));
  }

  // URL のみのキー（body 違いの fallback 用）。dest/hold/order は毎回 body が違うので
  // 完全一致では刺さらない。最後に観測した「同 URL の成功応答」を再利用する。
  function __sv_makeUrlKey(profile, url){
    return '__sv_' + profile + '_url_' + __sv_fnv1a(url);
  }

  function __sv_setActiveProfile(psw, name){
    if(!psw) return;
    var hash = __sv_fnv1a(psw);
    if(window.__saved_active_profile === hash) return;
    window.__saved_active_profile = hash;
    try {
      var idx = JSON.parse(localStorage.getItem('__sv_idx') || '{}');
      var prev = idx[hash] || {};
      idx[hash] = {
        name: name || prev.name || '',
        last_seen: Date.now(),
      };
      localStorage.setItem('__sv_idx', JSON.stringify(idx));
      // capture モードで profile lock-in した瞬間 = オンラインに戻った合図。
      // オフラインで蓄積した state snapshot は陳腐化しているので削除（次回 replay 時は
      // 上流由来のフレッシュなキャッシュから出発する）。replay モードでは触らない。
      if(!__sv_replay){
        if(localStorage.getItem('__sv_state_' + hash) !== null){
          localStorage.removeItem('__sv_state_' + hash);
          console.log('[saved] cleared offline snapshot for profile (back online)');
        }
      }
    } catch(e){}
    console.log('[saved] active profile:', hash, name || '');
    // Pending queue を drain — profile lock-in 前に来た capture を遡って保存
    if(window.__sv_pending && window.__sv_pending.length > 0){
      var n = window.__sv_pending.length;
      for(var i=0; i<n; i++){
        var p = window.__sv_pending[i];
        try { __sv_captureResponse(p.url, p.body, p.text); } catch(e){}
      }
      window.__sv_pending = [];
      console.log('[saved] drained ' + n + ' pending capture(s)');
    }
  }
  window.__sv_pending = window.__sv_pending || [];

  function __sv_queueOrCapture(url, body, text){
    // Profile が既知なら即保存。未知なら body から psw 抽出を試みる。
    // それでも未知ならキューに溜めて、polling で profile lock-in したら drain する。
    if(!window.__saved_active_profile){
      try {
        var bodyStr = __sv_bodyToString(body);
        var psw = __sv_extractPsw(bodyStr);
        if(psw) __sv_setActiveProfile(psw, '');
      } catch(e){}
    }
    if(window.__saved_active_profile){
      __sv_captureResponse(url, body, text);
    } else {
      window.__sv_pending.push({ url: url, body: body, text: text });
      console.log('[saved] queued (profile not yet known):', url, '(' + (text ? text.length : 0) + 'B)');
    }
  }

  // === Phase 3c: 書込永続化 (snapshot / restore) ===
  // 書込 (dest/hold/order) 成功時に window.plr_dat 全件を localStorage に保存。
  // 次回 replay 起動時に login 後 plr_dat が populated 状態を検知してから上書き復元。
  function __sv_snapshotState(){
    if(!__sv_replay) return;
    if(!window.__saved_active_profile) return;
    if(!window.plr_dat || !window.plr_dat.length) return;
    try {
      var state = {
        ts: Date.now(),
        plr_dat: Array.prototype.slice.call(window.plr_dat),
        mytm_clb: window.mytm_clb,
        shibi_ps: window.shibi_ps,
        shibi_ps_stock: window.shibi_ps_stock,
      };
      localStorage.setItem('__sv_state_' + window.__saved_active_profile, JSON.stringify(state));
      console.log('[saved replay] snapshot saved (' + state.plr_dat.length + ' entries)');
    } catch(e){
      console.warn('[saved replay] snapshot failed:', e && e.message);
    }
  }

  // replay 起動時の復元 watcher。dya.js ロード → login replay → plr_dat 構築の完了を待ち、
  // localStorage の snapshot があれば in-place 上書き（plr_dat 配列の参照は維持）。
  function __sv_installRestoreWatcher(){
    if(!__sv_replay) return;
    var applied = false;
    var t = setInterval(function(){
      if(applied) return;
      var profile = window.__saved_active_profile;
      if(!profile) return;
      if(!window.plr_dat || window.plr_dat.length === 0) return;
      try {
        var raw = localStorage.getItem('__sv_state_' + profile);
        if(!raw){
          applied = true; clearInterval(t);
          return;
        }
        var state = JSON.parse(raw);
        if(state && state.plr_dat && state.plr_dat.length > 0){
          var n = Math.min(state.plr_dat.length, window.plr_dat.length);
          for(var i=0; i<n; i++) window.plr_dat[i] = state.plr_dat[i];
          if(typeof state.mytm_clb !== 'undefined') window.mytm_clb = state.mytm_clb;
          if(typeof state.shibi_ps !== 'undefined') window.shibi_ps = state.shibi_ps;
          if(typeof state.shibi_ps_stock !== 'undefined') window.shibi_ps_stock = state.shibi_ps_stock;
          var age = ((Date.now() - state.ts) / 60000).toFixed(1);
          console.log('[saved replay] state restored: ' + n + ' entries, age=' + age + ' min');
        }
        applied = true; clearInterval(t);
      } catch(e){
        console.warn('[saved replay] restore failed:', e && e.message);
        applied = true; clearInterval(t);
      }
    }, 500);
  }
  __sv_installRestoreWatcher();

  function __sv_captureResponse(url, body, responseText){
    if(!window.__saved_active_profile){
      console.log('[saved] capture skipped (no profile yet):', url);
      return;
    }
    if(typeof responseText !== 'string') return;
    try {
      // 1) (URL + normalize body) キー
      var k = '__sv_' + window.__saved_active_profile + '_' + __sv_makeKey(url, body);
      localStorage.setItem(k, responseText);
      // 2) (URL のみ) キー — body 違い request の fallback 用、最新応答で上書き
      var ku = __sv_makeUrlKey(window.__saved_active_profile, url);
      localStorage.setItem(ku, responseText);
      console.log('[saved] captured:', url, '(' + responseText.length + 'B)');
    } catch(e){
      console.warn('[saved] store failed:', e && e.message);
    }
  }

  function __sv_tryLookupForProfile(profile, url, body){
    // Tier 1: 完全一致 (URL + 正規化 body)
    var k1 = '__sv_' + profile + '_' + __sv_makeKey(url, body);
    var v1 = localStorage.getItem(k1);
    if(v1 != null) return { hit: 'exact', value: v1 };
    // Tier 2: URL のみ fallback（dest/hold/order の都度違う body 用）
    var k2 = __sv_makeUrlKey(profile, url);
    var v2 = localStorage.getItem(k2);
    if(v2 != null) return { hit: 'url-only', value: v2 };
    return null;
  }

  function __sv_lookupResponse(url, body){
    if(window.__saved_active_profile){
      var r1 = __sv_tryLookupForProfile(window.__saved_active_profile, url, body);
      if(r1){
        if(r1.hit === 'url-only') console.log('[saved replay] URL-only fallback:', url);
        return r1.value;
      }
    }
    // ログイン flow: body から sv_psw を抽出してプロフィールを当てる
    var bodyStr = __sv_bodyToString(body);
    var psw = __sv_extractPsw(bodyStr);
    if(psw){
      var hash = __sv_fnv1a(psw);
      var r2 = __sv_tryLookupForProfile(hash, url, body);
      if(r2){
        window.__saved_active_profile = hash;
        if(r2.hit === 'url-only') console.log('[saved replay] URL-only fallback (psw-derived):', url);
        return r2.value;
      }
    }
    return null;
  }

  // XHR.open 再ラップ: 元 URL を this.__sv_url に控える（既存 wrap は内側、こちらが外側）
  var __sv_existingOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    this.__sv_method = method;
    this.__sv_url = url;
    return __sv_existingOpen.apply(this, arguments);
  };

  // XHR.send 再ラップ: capture / replay 分岐
  var __sv_existingSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body){
    var self = this;
    var url = self.__sv_url || '';
    if(!__sv_isProxyTarget(url)){
      return __sv_existingSend.apply(self, arguments);
    }
    if(__sv_replay){
      var cached;
      if(__sv_isGachaCall(url)){
        // ガチャは cache 無視で擬似抽選レスポンスを合成
        cached = __sv_synthesizeGacha();
        if(cached == null){
          cached = __sv_shouldCache(url) ? __sv_lookupResponse(url, body) : null;
        }
      } else {
        cached = __sv_shouldCache(url) ? __sv_lookupResponse(url, body) : null;
      }
      // cache miss でも既知 URL は default fallback で生かす
      if(cached == null) cached = __sv_synthesizeFallback(url);
      // 書込系トレース: dest/hold/order を window.__sv_writes に記録（最大50件）
      if(__sv_isWriteEndpoint(url)){
        var entry = {
          ts: Date.now(), url: url, method: self.__sv_method || 'POST',
          body: __sv_bodyToString(body).slice(0, 300),
          result: cached != null ? 'hit' : 'miss',
        };
        window.__sv_writes = window.__sv_writes || [];
        window.__sv_writes.push(entry);
        if(window.__sv_writes.length > 50) window.__sv_writes.shift();
        console.log('[saved replay] WRITE', entry.result, url, '\\n  body:', entry.body);
        // Phase 3c: 書込成功時に plr_dat スナップショット保存（次回 reload で復元）
        if(cached != null){
          setTimeout(function(){ __sv_snapshotState(); }, 0);
        }
      } else if(cached != null){
        console.log('[saved replay] hit (xhr):', url, '(' + cached.length + 'B)');
      }
      // ガチャ確定後の保持 (mytm_hold) も上で snapshot される。ガチャ呼出自体は
      // plr_dat 変更がない（保持画面に進むだけ）ので snapshot 不要。
      setTimeout(function(){
        try {
          Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(self, 'status', { value: cached != null ? 200 : 599, configurable: true });
          Object.defineProperty(self, 'statusText', { value: cached != null ? 'OK' : 'No cache', configurable: true });
          Object.defineProperty(self, 'responseText', { value: cached != null ? cached : '', configurable: true });
          Object.defineProperty(self, 'response', { value: cached != null ? cached : '', configurable: true });
          Object.defineProperty(self, 'responseURL', { value: url, configurable: true });
          if(typeof self.onreadystatechange === 'function'){ try { self.onreadystatechange(); } catch(e){} }
          try { self.dispatchEvent(new Event('readystatechange')); } catch(e){}
          if(cached != null){
            if(typeof self.onload === 'function'){ try { self.onload(); } catch(e){} }
            try { self.dispatchEvent(new Event('load')); } catch(e){}
          } else {
            console.warn('[saved replay] cache miss:', url);
            if(typeof self.onerror === 'function'){ try { self.onerror(); } catch(e){} }
            try { self.dispatchEvent(new Event('error')); } catch(e){}
          }
          try { self.dispatchEvent(new Event('loadend')); } catch(e){}
        } catch(e){
          console.error('[saved replay] dispatch failed:', e);
        }
      }, 0);
      return;
    }
    if(__sv_shouldCache(url)){
      self.addEventListener('load', function(){
        try {
          if(self.status >= 200 && self.status < 300){
            __sv_queueOrCapture(url, body, self.responseText);
          } else {
            console.log('[saved] xhr resp non-2xx:', url, 'status=' + self.status);
          }
        } catch(e){
          console.warn('[saved] queueOrCapture (xhr) error:', e && e.message);
        }
      });
      self.addEventListener('error', function(){
        console.warn('[saved] xhr network error:', url);
      });
    }
    return __sv_existingSend.apply(self, arguments);
  };

  // === fetch 再ラップ: capture / replay 層 ===
  // dya.js の login (dya_db.php) と mytm 系（dest/hold/order/get）は全て fetch を使うため、
  // XHR wrap だけでは intercept できない。既存 wrap (URL rewrite) の上にもう一段 wrap。
  var __sv_existingFetch = window.fetch;
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if(!__sv_isProxyTarget(url)){
      return __sv_existingFetch(input, init);
    }
    var body = init && init.body;
    if(__sv_replay){
      var cached;
      if(__sv_isGachaCall(url)){
        cached = __sv_synthesizeGacha();
        if(cached == null) cached = __sv_shouldCache(url) ? __sv_lookupResponse(url, body) : null;
      } else {
        cached = __sv_shouldCache(url) ? __sv_lookupResponse(url, body) : null;
      }
      if(cached == null) cached = __sv_synthesizeFallback(url);
      if(__sv_isWriteEndpoint(url)){
        var entry = {
          ts: Date.now(), url: url, method: (init && init.method) || 'POST',
          body: __sv_bodyToString(body).slice(0, 300),
          result: cached != null ? 'hit' : 'miss',
        };
        window.__sv_writes = window.__sv_writes || [];
        window.__sv_writes.push(entry);
        if(window.__sv_writes.length > 50) window.__sv_writes.shift();
        console.log('[saved replay] WRITE (fetch)', entry.result, url, '\\n  body:', entry.body);
        if(cached != null) setTimeout(function(){ __sv_snapshotState(); }, 0);
      } else if(cached != null){
        console.log('[saved replay] hit (fetch):', url, '(' + cached.length + 'B)');
      }
      if(cached == null){
        console.warn('[saved replay] cache miss (fetch):', url);
      }
      var status = cached != null ? 200 : 599;
      var statusText = cached != null ? 'OK' : 'No cache';
      var bodyText = cached != null ? cached : '';
      // content-type は body の中身から推測（JSON っぽければ application/json、それ以外は text/plain）
      var ct = 'text/plain';
      if(typeof bodyText === 'string'){
        var trim = bodyText.replace(/^\\s+/, '');
        if(trim.charAt(0) === '{' || trim.charAt(0) === '[') ct = 'application/json';
      }
      return Promise.resolve(new Response(bodyText, {
        status: status, statusText: statusText,
        headers: { 'content-type': ct },
      }));
    }
    // capture モード: 上流に投げて成功時は body を非破壊で取り出して保存
    if(__sv_shouldCache(url)){
      return __sv_existingFetch(input, init).then(function(resp){
        try {
          if(resp && resp.ok){
            resp.clone().text().then(function(text){
              try {
                __sv_queueOrCapture(url, body, text);
              } catch(e){
                console.warn('[saved] queueOrCapture (fetch) error:', e && e.message);
              }
            }).catch(function(err){
              console.warn('[saved] resp.text() failed (fetch):', err && err.message, url);
            });
          } else {
            console.log('[saved] fetch resp non-ok:', url, 'status=' + (resp && resp.status));
          }
        } catch(e){
          console.warn('[saved] capture outer error (fetch):', e && e.message);
        }
        return resp;
      }, function(err){
        console.warn('[saved] fetch reject:', url, err && err.message);
        throw err;
      });
    }
    return __sv_existingFetch(input, init);
  };

  // capture モード: sv_psw / name_l 監視ループでログイン成功を検知してプロフィール lock-in
  // 200ms 間隔でレスポンス処理直後のレース条件を素早くカバー、pending queue も自動 drain。
  if(!__sv_replay){
    setInterval(function(){
      try {
        var psw = window.sv_psw;
        if(typeof psw === 'string' && psw.length > 0 && !window.__saved_active_profile){
          __sv_setActiveProfile(psw, window.name_l || '');
        }
        if(window.__saved_active_profile && window.name_l){
          var idx = JSON.parse(localStorage.getItem('__sv_idx') || '{}');
          if(idx[window.__saved_active_profile] && idx[window.__saved_active_profile].name !== window.name_l){
            idx[window.__saved_active_profile].name = window.name_l;
            localStorage.setItem('__sv_idx', JSON.stringify(idx));
          }
        }
      } catch(e){}
    }, 200);
  }

  // replay モード: WebSocket は dummy で即時 error / close（socket.io が retry し続けないように）
  if(__sv_replay && typeof WebSocket !== 'undefined'){
    function __sv_DummyWS(url, protocols){
      this.url = url;
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.onopen = null; this.onclose = null; this.onerror = null; this.onmessage = null;
      this.protocol = ''; this.extensions = '';
      var self = this;
      setTimeout(function(){
        self.readyState = 3;
        var err;
        try { err = new Event('error'); } catch(e){ err = { type: 'error' }; }
        if(self.onerror){ try { self.onerror(err); } catch(e){} }
        var close;
        try { close = new CloseEvent('close', { code: 1006, reason: 'replay mode', wasClean: false }); }
        catch(e){ close = { type: 'close', code: 1006, reason: 'replay mode', wasClean: false }; }
        if(self.onclose){ try { self.onclose(close); } catch(e){} }
      }, 5);
    }
    __sv_DummyWS.prototype.send = function(){};
    __sv_DummyWS.prototype.close = function(){ this.readyState = 3; };
    __sv_DummyWS.prototype.addEventListener = function(t, h){
      if(t === 'open') this.onopen = h;
      else if(t === 'close') this.onclose = h;
      else if(t === 'error') this.onerror = h;
      else if(t === 'message') this.onmessage = h;
    };
    __sv_DummyWS.prototype.removeEventListener = function(){};
    __sv_DummyWS.OPEN = 1; __sv_DummyWS.CLOSED = 3;
    __sv_DummyWS.CONNECTING = 0; __sv_DummyWS.CLOSING = 2;
    window.WebSocket = __sv_DummyWS;
    console.log('[saved replay] WebSocket dummied; profiles:',
      Object.keys(JSON.parse(localStorage.getItem('__sv_idx') || '{}')).length);
  }

  // === Phase 5 UX: 視覚 badge + console helpers ===
  // replay モード時: 画面右上に固定 badge "💾 SAVED REPLAY" を出して状態を一目で分かるように
  if(__sv_replay){
    function __sv_addBadge(){
      if(!document.body || document.getElementById('__sv_badge')) return;
      var b = document.createElement('div');
      b.id = '__sv_badge';
      b.textContent = '💾 SAVED';
      var s = b.style;
      s.position = 'fixed';
      s.top = 'max(8px, env(safe-area-inset-top))';
      s.left = 'max(8px, env(safe-area-inset-left))';
      s.background = 'linear-gradient(180deg,#1ea27a,#0a4d3a)';
      s.color = '#fff';
      s.padding = '4px 10px';
      s.borderRadius = '999px';
      s.border = '1px solid #fff';
      s.fontSize = 'clamp(10px, 2.5vmin, 13px)';
      s.fontFamily = 'sans-serif';
      s.fontWeight = 'bold';
      s.zIndex = '99999';
      s.pointerEvents = 'none';
      s.letterSpacing = '0.05em';
      s.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
      document.body.appendChild(b);
    }
    if(document.body) __sv_addBadge();
    else document.addEventListener('DOMContentLoaded', __sv_addBadge);
  }

  // F12 console から扱える管理 API。capture モード / replay モード両方で使える。
  //   __sv.list()     全プロフィール表示
  //   __sv.size()     占有 localStorage 量
  //   __sv.clear('all')              全 saved-data 削除
  //   __sv.clear('<profileHash>')    特定 profile のみ削除
  //   __sv.snapshot() 手動 snapshot 発火（replay 中のデバッグ用）
  //   __sv.writes()   最近の書込履歴
  //   __sv.profile()  現在 active な profile hash
  window.__sv = {
    list: function(){
      var idx = {};
      try { idx = JSON.parse(localStorage.getItem('__sv_idx') || '{}'); } catch(e){}
      var rows = {};
      for(var h in idx){
        rows[h] = {
          name: idx[h].name || '(unnamed)',
          last_seen: new Date(idx[h].last_seen || 0).toISOString().slice(0,19).replace('T',' '),
          has_snapshot: localStorage.getItem('__sv_state_' + h) ? '✓' : '',
        };
      }
      try { console.table(rows); } catch(e){ console.log(rows); }
      return rows;
    },
    size: function(){
      var keys = Object.keys(localStorage);
      var total = 0, n = 0;
      for(var i=0; i<keys.length; i++){
        if(/^__sv/.test(keys[i])){
          total += keys[i].length + (localStorage.getItem(keys[i]) || '').length;
          n++;
        }
      }
      return { keys: n, totalKB: +(total/1024).toFixed(1) };
    },
    clear: function(target){
      var keys = Object.keys(localStorage);
      var n = 0;
      if(target === 'all'){
        for(var i=0; i<keys.length; i++){
          if(/^__sv/.test(keys[i])){ localStorage.removeItem(keys[i]); n++; }
        }
        console.log('[saved] cleared all (' + n + ' keys)');
      } else if(typeof target === 'string' && target.length > 0){
        for(var i=0; i<keys.length; i++){
          var k = keys[i];
          if(k === '__sv_state_' + target ||
             k.indexOf('__sv_' + target + '_') === 0){
            localStorage.removeItem(k); n++;
          }
        }
        // index からも削除
        try {
          var idx = JSON.parse(localStorage.getItem('__sv_idx') || '{}');
          if(idx[target]){ delete idx[target]; localStorage.setItem('__sv_idx', JSON.stringify(idx)); }
        } catch(e){}
        console.log('[saved] cleared profile ' + target + ' (' + n + ' keys)');
      } else {
        console.warn('usage: __sv.clear("all") or __sv.clear("<profileHash>")');
      }
      return n;
    },
    snapshot: function(){
      if(!window.__saved_replay){ console.warn('[saved] snapshot() only meaningful in replay mode'); return; }
      __sv_snapshotState();
    },
    writes: function(){
      return window.__sv_writes || [];
    },
    profile: function(){
      return window.__saved_active_profile || null;
    },
    diag: function(){
      var keys = Object.keys(localStorage);
      var byProfile = {};
      keys.forEach(function(k){
        var m = k.match(/^__sv_([0-9a-f]{8})_/);
        if(m){ byProfile[m[1]] = (byProfile[m[1]] || 0) + 1; }
      });
      var idx = {};
      try { idx = JSON.parse(localStorage.getItem('__sv_idx') || '{}'); } catch(e){}
      var info = {
        mode: window.__saved_replay ? 'REPLAY' : 'CAPTURE',
        active_profile: window.__saved_active_profile || null,
        profiles_in_idx: Object.keys(idx),
        cache_keys_per_profile: byProfile,
        pending_capture_queue: (window.__sv_pending || []).length,
        recent_writes: (window.__sv_writes || []).slice(-5),
        sv_psw_global: typeof window.sv_psw,
        name_l_global: typeof window.name_l,
        plr_dat_length: window.plr_dat ? window.plr_dat.length : 0,
        s_name_loaded: !!(window.s_name && window.s_name.length > 0),
      };
      console.log('=== __sv.diag() ===');
      console.log(info);
      return info;
    },
  };

  // document.domain を 'dya.jp' に偽装（chsm==582 等のチェックを通すため）
  try {
    Object.defineProperty(document, 'domain', {
      configurable: true,
      get: function(){ return 'dya.jp'; }
    });
  } catch(e){ console.warn('[online] domain spoof failed:', e); }

  // AdSense H5 game ads (adBreak / adConfig) のスタブ。localhost からは AdSense は
  // 配信されず、未定義参照で gsts/lp/pdo2 が ReferenceError になるため、即時callback で
  // ゲーム進行を進める。
  window.adsbygoogle = window.adsbygoogle || [];
  function adStub(o){
    if(!o || typeof o !== 'object') return;
    if(typeof o.onReady === 'function')        setTimeout(function(){ try{ o.onReady({}); }catch(e){} }, 20);
    if(typeof o.adBreakStarted === 'function') setTimeout(function(){ try{ o.adBreakStarted({}); }catch(e){} }, 30);
    if(typeof o.adViewed === 'function')       setTimeout(function(){ try{ o.adViewed({}); }catch(e){} }, 40);
    if(typeof o.adBreakDone === 'function')    setTimeout(function(){ try{ o.adBreakDone({breakStatus:'viewed'}); }catch(e){} }, 60);
  }
  window.adBreak = adStub;
  window.adConfig = adStub;

  // dya.js パッチが安全に参照できるよう、空オブジェクトだけは常に用意。
  window.__cheat = window.__cheat || {};

  // ===== ↓↓↓ ここからチート UI （チート版モードでのみ有効）↓↓↓ =====
  if (window.__cheat_enabled) {
${CHEAT_UI_BOOTSTRAP}
${ONLINE_LAB_HARNESS}
  } // ===== ↑↑↑ チート UI ここまで ↑↑↑ =====
`;

const BOOTSTRAP = COMMON_BOOTSTRAP_HEAD + (isOnline ? ONLINE_BOOTSTRAP_TAIL : OFFLINE_BOOTSTRAP_TAIL);

const TITLE = isOnline ? 'ダイナマイト野球 (オンライン版)' : 'ダイナマイト野球 (オフライン版)';

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<title>${TITLE}</title>
<style>
html,body{margin:0;padding:0;background:#000;overflow:hidden;height:100%;width:100%;-webkit-user-select:none;user-select:none;position:fixed;}
#myCanvas{display:block;}
#chf2{position:absolute;left:0;top:0;}
#__loading{position:fixed;left:0;top:0;width:100%;height:100%;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;z-index:9999;font-size:14px;text-align:center;padding:0 20px;box-sizing:border-box;}
#__diag{position:fixed;left:6px;bottom:6px;color:#9f9;font:11px/1.3 monospace;background:rgba(0,0,0,.6);padding:4px 8px;max-width:90%;white-space:pre-wrap;z-index:9998;pointer-events:none;}
</style>
</head>
<body>
<div id="__loading">読み込み中…</div>
<div id="__diag"></div>
<canvas id="myCanvas"></canvas>
<div id="chf2"></div>

<script id="__assets" type="application/octet-stream">
${assetBlob}
</script>

<script>
(function(){
${BOOTSTRAP}

  // 共通: ローディング進捗 / エラー収集
  var loadingEl = document.getElementById('__loading');
  var diagEl = document.getElementById('__diag');
  function setMsg(t){ if(loadingEl) loadingEl.textContent = t; }
  function diag(t){ if(diagEl){ diagEl.textContent = (diagEl.textContent + '\\n' + t).slice(-1500); } }
  setMsg('読み込み中… (準備中)');
  diag('mode: ${MODE}');
  window.addEventListener('error', function(e){
    diag('ERR: ' + (e.message || e.error || '?') + ' @ ' + (e.filename||'').slice(-40) + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e){
    diag('PROMISE-REJ: ' + (e.reason && e.reason.message || e.reason || '?'));
  });
  var hideTries = 0; var lastCnt = -1;
  var hideTimer = setInterval(function(){
    hideTries++;
    try {
      var mx = (typeof gldt_mx !== 'undefined') ? gldt_mx : 0;
      var cnt = (typeof gldt !== 'undefined') ? gldt : 0;
      setMsg('読み込み中… ' + cnt + ' / ' + (mx || '?'));
      if(cnt !== lastCnt){ diag('progress: ' + cnt + '/' + mx); lastCnt = cnt; }
      if(mx > 0 && cnt >= mx){
        if(loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
        if(diagEl && diagEl.parentNode) diagEl.parentNode.removeChild(diagEl);
        clearInterval(hideTimer);
      } else if(hideTries > 600){
        if(loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
        clearInterval(hideTimer);
      }
    } catch(e){}
  }, 100);
})();
</script>

<script>
/* ===== three.min.js ===== */
${threeJS}
</script>
<script>
/* ===== GLTFLoader.js ===== */
${gltfJS}
</script>
<script>
/* ===== SkeletonUtils.js ===== */
${skelJS}
</script>
<script>
/* ===== socket.io client ===== */
${socketJS}
</script>
<script>
/* ===== dya.js (game logic, patched: mode=${MODE}) ===== */
${dyaJS}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
const sz = fs.statSync(OUT).size;
console.log('wrote', OUT, '(', (sz/1024/1024).toFixed(2), 'MB ) mode=' + MODE);
