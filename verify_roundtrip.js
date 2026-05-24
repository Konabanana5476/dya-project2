// Verify that our bootstrap encoder produces records that dya.js's team_data_set
// parses back to the same gameplay-effective values. This mirrors:
//   bt_pd[i3][i]    = tmpd[1].split('')   // 14 raw stat chars
//   pch_dat[i3][i4] = tmpd[2].substr(i4,1) // 9 raw stat chars (pitcher branch)
//   defensive_eligibility (batter branch) = 9 raw chars from tmpd[2]
//
// Plus the 0→10 swap on parse.
//
// Usage: node verify_roundtrip.js

const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'default_teams.json'), 'utf8'));

function digit(v) {
  if (typeof v !== 'number') v = parseInt(v) || 0;
  if (v === 10) v = 0;
  return Math.max(0, Math.min(9, v));
}
function rawDigit(v) {
  if (typeof v !== 'number') v = parseInt(v) || 0;
  return Math.max(0, Math.min(9, v));
}
function unswap(d) { return d === 0 ? 10 : d; }

function encodeBatter14(s) {
  let d = "";
  d += digit(s.power);
  d += digit(s.contact);
  d += digit(s.eye);
  d += digit(s.speed);
  d += digit(s.defense_unused_0);
  d += digit(s.defense_unused_1);
  d += digit(s.defense_unused_2);
  d += digit(s.defense_unused_3);
  d += digit(s.defense_unused_4);
  d += digit(s.defense_unused_5);
  d += digit(s.defense_unused_6);
  d += digit(s.defense_unused_7);
  d += digit(s.defense_unused_8);
  d += rawDigit(s.batting_hand);
  return d;
}
function encodePitcher9(ps) {
  let d = "";
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

function buildRecord(p) {
  const raw14 = encodeBatter14(p.batter_stats);
  const raw9 = (p.is_pitcher && p.pitcher_stats)
    ? encodePitcher9(p.pitcher_stats)
    : (p.defensive_eligibility || []).slice(0, 9).map(rawDigit).join('').padEnd(9, '1');
  const dh = p.display_hint || {};
  const skinHex = (p.skin_color || '#434343').replace(/^#/, '');
  const stars = [
    raw9,
    dh.power ?? 50, dh.contact ?? 10, dh.speed ?? 20, dh.defense ?? 5, dh.overall ?? 50,
    skinHex,
    dh.pos_type ?? (p.is_pitcher ? 1 : 0),
    p.secondary_ability ?? 0,
  ].join('*');
  const flags = (p.special_flags && p.special_flags.length > 0)
    ? '|' + p.special_flags.join('|') + '|'
    : '';
  return `${p.name}#${raw14}#${stars}#${flags}`;
}

// Simulate team_data_set parse: bt_pd[][0..13] from tmpd[1], with 0→10 swap.
function simBatterParse(record) {
  const parts = record.split('#');
  const raw14 = parts[1];
  const stats = [];
  for (let i = 0; i < 14; i++) {
    let v = parseInt(raw14.charAt(i));
    if (v === 0) v = 10;
    stats.push(v);
  }
  return {
    power: stats[0], contact: stats[1], eye: stats[2], speed: stats[3],
    defense_unused_0: stats[4], defense_unused_1: stats[5], defense_unused_2: stats[6],
    defense_unused_3: stats[7], defense_unused_4: stats[8], defense_unused_5: stats[9],
    defense_unused_6: stats[10], defense_unused_7: stats[11], defense_unused_8: stats[12],
    batting_hand: parseInt(raw14.charAt(13)),
  };
}

function simPitcherParse(record) {
  const parts = record.split('#');
  const faceParts = parts[2].split('*');
  const raw9 = faceParts[0];
  const stats = [];
  for (let i = 0; i < 9; i++) {
    let v = parseInt(raw9.charAt(i));
    if (v === 0) v = 10;
    stats.push(v);
  }
  return {
    speed: stats[0], control: stats[1], stamina_rank: stats[2],
    break_slider: stats[3], break_curve: stats[4], break_fork: stats[5],
    break_screw: stats[6], break_shoot: stats[7],
    handedness: parseInt(raw9.charAt(8)),
  };
}

let total = 0, mismatches = 0;
const issues = [];

for (const team of data.teams) {
  for (const p of team.players) {
    total++;
    const rec = buildRecord(p);
    const parsedB = simBatterParse(rec);

    // Compare batter_stats roundtrip (0→10 swap applied on both sides)
    const expectB = {
      power: digit(p.batter_stats.power) === 0 ? 10 : digit(p.batter_stats.power),
      contact: digit(p.batter_stats.contact) === 0 ? 10 : digit(p.batter_stats.contact),
      eye: digit(p.batter_stats.eye) === 0 ? 10 : digit(p.batter_stats.eye),
      speed: digit(p.batter_stats.speed) === 0 ? 10 : digit(p.batter_stats.speed),
      defense_unused_0: digit(p.batter_stats.defense_unused_0) === 0 ? 10 : digit(p.batter_stats.defense_unused_0),
      defense_unused_1: digit(p.batter_stats.defense_unused_1) === 0 ? 10 : digit(p.batter_stats.defense_unused_1),
      defense_unused_2: digit(p.batter_stats.defense_unused_2) === 0 ? 10 : digit(p.batter_stats.defense_unused_2),
      defense_unused_3: digit(p.batter_stats.defense_unused_3) === 0 ? 10 : digit(p.batter_stats.defense_unused_3),
      defense_unused_4: digit(p.batter_stats.defense_unused_4) === 0 ? 10 : digit(p.batter_stats.defense_unused_4),
      defense_unused_5: digit(p.batter_stats.defense_unused_5) === 0 ? 10 : digit(p.batter_stats.defense_unused_5),
      defense_unused_6: digit(p.batter_stats.defense_unused_6) === 0 ? 10 : digit(p.batter_stats.defense_unused_6),
      defense_unused_7: digit(p.batter_stats.defense_unused_7) === 0 ? 10 : digit(p.batter_stats.defense_unused_7),
      defense_unused_8: digit(p.batter_stats.defense_unused_8) === 0 ? 10 : digit(p.batter_stats.defense_unused_8),
      batting_hand: rawDigit(p.batter_stats.batting_hand),
    };
    for (const k in expectB) {
      if (parsedB[k] !== expectB[k]) {
        issues.push(`team ${team.index} slot ${p.slot} ${p.name} ${k}: expected ${expectB[k]} got ${parsedB[k]}`);
        mismatches++;
        break;
      }
    }

    if (p.is_pitcher && p.pitcher_stats) {
      const parsedP = simPitcherParse(rec);
      const ps = p.pitcher_stats;
      const expectP = {
        speed: digit(ps.speed) === 0 ? 10 : digit(ps.speed),
        control: digit(ps.control) === 0 ? 10 : digit(ps.control),
        stamina_rank: digit(ps.stamina_rank) === 0 ? 10 : digit(ps.stamina_rank),
        break_slider: digit(ps.break_slider) === 0 ? 10 : digit(ps.break_slider),
        break_curve: digit(ps.break_curve) === 0 ? 10 : digit(ps.break_curve),
        break_fork: digit(ps.break_fork) === 0 ? 10 : digit(ps.break_fork),
        break_screw: digit(ps.break_screw) === 0 ? 10 : digit(ps.break_screw),
        break_shoot: digit(ps.break_shoot) === 0 ? 10 : digit(ps.break_shoot),
        handedness: rawDigit(ps.handedness),
      };
      for (const k in expectP) {
        if (parsedP[k] !== expectP[k]) {
          issues.push(`team ${team.index} slot ${p.slot} ${p.name} pitcher ${k}: expected ${expectP[k]} got ${parsedP[k]}`);
          mismatches++;
          break;
        }
      }
    }
  }
}

console.log(`[verify] total players: ${total}, mismatches: ${mismatches}`);
for (const m of issues.slice(0, 20)) console.log(' ', m);

// Sample output: compare original record vs rebuilt
console.log('\nsample team 0 player 0 (rebuilt vs original-style):');
const p0 = data.teams[0].players[0];
console.log('  built:', buildRecord(p0));
console.log('  spec:', '伊達#79891141317773#435211111*72*10*20*7*57*434343*0*0#|4|6|10|8|');

console.log('\nsample team 0 first pitcher:');
const pp = data.teams[0].players.find(p => p.is_pitcher);
if (pp) console.log('  built:', buildRecord(pp));
