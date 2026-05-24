// Extract default 12-team data from dya_extracted.js into JSON schema format.
//
// IMPORTANT: dya.js has TWO data flows.
//   - team_data_set (offline / CPU match): reads the 14-digit string DIRECTLY,
//     each char (0-9) is one stat. NO base62 decoding.
//   - batter_comp (online network format): receives data that is base62 encoded
//     via s_hrk(). We don't use this path for original team mode.
//
// So team_data records are stored as plain ASCII 14-digit stat strings.
// The 9-digit "face data" prefix has DUAL meaning:
//   - For pitcher slots: 9 pitcher stats (speed, control, stamina_rank,
//     break_slider/curve/fork/screw/shoot, handedness)
//   - For non-pitcher slots: 9 defensive eligibility values (P/C/1B/2B/3B/SS/LF/CF/RF)
//
// Usage: node extract_defaults.js
// Output: team_editor/default_teams.json

const fs = require('fs');
const path = require('path');

const DYA = path.resolve(__dirname, '..', 'dya_extracted.js');
const OUT = path.resolve(__dirname, 'default_teams.json');

const dya = fs.readFileSync(DYA, 'utf8');

// === 1. s_n charset (for reference, also stored in output) ===
const sn_m = dya.match(/s_n="([^"]+)"/);
const S_N = sn_m ? sn_m[1] : '';

// === 2. Locate team_data and parse each case block ===
const tdIdx = dya.indexOf('function team_data');
if (tdIdx < 0) throw new Error('team_data not found');

const caseStarts = [];
const reCase = /case (\d+):/g;
reCase.lastIndex = tdIdx;
let m;
while ((m = reCase.exec(dya)) && caseStarts.length < 12) {
  const label = parseInt(m[1]);
  if (label >= 0 && label <= 11) caseStarts.push({ label, idx: m.index });
  if (label === 11) break;
}
if (caseStarts.length !== 12) throw new Error('expected 12 cases, got ' + caseStarts.length);

const teams = [];

for (let t = 0; t < 12; t++) {
  const start = caseStarts[t].idx;
  const end = (t + 1 < 12) ? caseStarts[t + 1].idx : (caseStarts[t].idx + 3000);
  const chunk = dya.substring(start, end);

  const players = [];
  const rePlr = /set_plr_dat\[(\d+)\]\s*=\s*"([^"]+)"/g;
  let pm;
  while ((pm = rePlr.exec(chunk)) && players.length < 21) {
    players.push({ slot: parseInt(pm[1]), record: pm[2] });
  }
  if (players.length !== 21) throw new Error(`team ${t}: expected 21 players, got ${players.length}`);
  players.sort((a, b) => a.slot - b.slot);

  const shibi_m = chunk.match(/set_shibi_ps="(\d+)"/);
  if (!shibi_m) throw new Error(`team ${t}: set_shibi_ps not found`);
  const starting_order = shibi_m[1].split('').map(Number);

  teams.push({
    index: t,
    name: `Team ${t}`,
    color: '#888888',
    starting_order,
    players: players.map(p => parsePlayer(p.slot, p.record)),
  });
}

// Apply 0→10 swap as dya.js does at parse time. (condition is the only
// stat that does NOT get this swap, per dya.js logic.)
function unswap(d) { return d === 0 ? 10 : d; }

function parsePlayer(slot, record) {
  // Format: "name#14digit#9digit*p1*p2*p3*p4*p5*hexskin*posType*ability#|flag|flag|...|"
  const parts = record.split('#');
  if (parts.length < 3) throw new Error(`bad record at slot ${slot}: ${record}`);

  const name = parts[0];
  const raw14 = parts[1];
  const faceField = parts[2];
  const flagStr = parts[3] || '';

  if (raw14.length !== 14) throw new Error(`slot ${slot} 14-digit length=${raw14.length}: ${raw14}`);

  // Parse the * field
  const faceParts = faceField.split('*');
  const raw9 = faceParts[0] || '';
  if (raw9.length !== 9) throw new Error(`slot ${slot} 9-digit length=${raw9.length}: ${raw9}`);

  const disp_power   = parseInt(faceParts[1] || '0');
  const disp_contact = parseInt(faceParts[2] || '0');
  const disp_speed   = parseInt(faceParts[3] || '0');
  const disp_defense = parseInt(faceParts[4] || '0');
  const disp_overall = parseInt(faceParts[5] || '0');
  const skin_hex     = '#' + (faceParts[6] || '000000');
  const pos_type     = parseInt(faceParts[7] || '0');
  const secondary_ab = parseInt(faceParts[8] || '0');

  const special_flags = (flagStr || '')
    .split('|').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

  // pos_type=1 は roster 画面の "P" バッジ向け display flag。9-digit 欄が
  // pitcher_stats か defensive_eligibility かは **スロット位置** が決定する:
  //
  //   - slot 8       = 先発投手 (starting_order の "1" 位置 = 9 番打者枠)。
  //   - slot 17/18/19 = ブルペン投手 (オンライン CPU 試合で代打ロジックが
  //     set_plr_dat[8] を slot 17/18 のレコードに上書きするため)。
  //   - 上記以外      = 野手。9-digit は defensive_eligibility。
  //
  // pos_type に依存させると vanilla データの slot 8 (例: 夏野 pos_type=0) を
  // 野手扱いし、9-digit を defensive_eligibility 配列で表示してしまう。実際は
  // 投手能力が入っている枠なので、ユーザがそれをいじると実プレイで投手能力が
  // 化ける。
  var is_pitcher_slot = new Set([8, 17, 18, 19]);
  const is_pitcher = is_pitcher_slot.has(slot);

  // === Batter stats (14 chars, position 0..13) ===
  // Per team_data_set: bt_pd[][0..13] = raw 14 digits (each 0-9, 0→10 swap).
  // Index meanings (from dya_stat_decoded.md + format_spec.md):
  //   [0] = prm_pw  (long-hit / power)
  //   [1] = prm_ht  (contact / meet)
  //   [2] = prm_kd  (eye for ball / 選球眼)
  //   [3] = speed   (走力)
  //   [4..12] = defensive position 9 (currently not read by gameplay code)
  //   [13] = batting hand (1=R, 2=L, 3=switch)
  const bd = (i) => unswap(parseInt(raw14.charAt(i)));
  const batter_stats = {
    power:            bd(0),
    contact:          bd(1),
    eye:              bd(2),
    speed:            bd(3),
    defense_unused_0: bd(4),
    defense_unused_1: bd(5),
    defense_unused_2: bd(6),
    defense_unused_3: bd(7),
    defense_unused_4: bd(8),
    defense_unused_5: bd(9),
    defense_unused_6: bd(10),
    defense_unused_7: bd(11),
    defense_unused_8: bd(12),
    batting_hand:     bd(13),
  };

  // === 9-digit field: pitcher stats OR defensive eligibility ===
  // Per team_data_set pitcher branch: pch_dat[][0..8] = raw 9 digits (0→10 swap).
  // Meanings (per dya_stat_decoded.md):
  //   [0] = ball speed   [1] = control      [2] = stamina rank
  //   [3] = slider break [4] = curve break  [5] = fork break
  //   [6] = screw break  [7] = shoot break  [8] = handedness (1=R, 2=L)
  const pd = (i) => unswap(parseInt(raw9.charAt(i)));

  let pitcher_stats = null;
  let defensive_eligibility = null;
  if (is_pitcher) {
    pitcher_stats = {
      speed:           pd(0),
      control:         pd(1),
      stamina_rank:    pd(2),
      break_slider:    pd(3),
      break_curve:     pd(4),
      break_fork:      pd(5),
      break_screw:     pd(6),
      break_shoot:     pd(7),
      handedness:      pd(8),
    };
  } else {
    defensive_eligibility = raw9.split('').map(c => parseInt(c));
  }

  return {
    slot,
    name,
    face_ref: '',                 // filled by second pass via s_name lookup
    skin_color: skin_hex,
    is_pitcher,
    secondary_ability: secondary_ab,
    defensive_eligibility,        // null for pitchers, array of 9 for batters
    special_flags,
    display_hint: {
      power: disp_power, contact: disp_contact, speed: disp_speed,
      defense: disp_defense, overall: disp_overall, pos_type,
    },
    batter_stats,
    pitcher_stats,
  };
}

// === 3. s_name → face_ref lookup (id ↔ name) ===
const sname_m = dya.match(/s_name="([^"]+)"/);
const SNAME = sname_m ? sname_m[1] : '';
const nameToId = new Map();
{
  const tokens = SNAME.split('#');
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const id = tokens[i];
    const rest = tokens[i + 1];
    const slashIdx = rest.indexOf('/');
    if (slashIdx < 0) continue;
    const nm = rest.substring(0, slashIdx);
    if (!nameToId.has(nm)) nameToId.set(nm, id);
  }
}
for (const team of teams) {
  for (const p of team.players) {
    if (!p.face_ref) p.face_ref = nameToId.get(p.name) || '';
  }
}

// === 4. Output ===
const out = {
  version: 2,            // schema bump - is_pitcher branching for 9-digit field
  name: 'default',
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  charset: S_N,
  teams,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

let total = 0, pitchers = 0;
for (const t of teams) for (const p of t.players) { total++; if (p.is_pitcher) pitchers++; }
console.log(`[extract] wrote ${OUT}`);
console.log(`[extract] teams=${teams.length}, players=${total}, pitchers=${pitchers}`);
console.log(`[extract] sample batter (team 0 slot 0):`);
console.log(JSON.stringify(teams[0].players[0], null, 2));
const samplePitcher = teams[0].players.find(p => p.is_pitcher);
if (samplePitcher) {
  console.log(`\n[extract] sample pitcher (team 0 slot ${samplePitcher.slot}):`);
  console.log(JSON.stringify(samplePitcher, null, 2));
}
