# Original Team JSON スキーマ v1

編集ツール ↔ ランタイム bootstrap 間のデータ契約。
localStorage キー: `__dya_original_teams_v1`

---

## 設計方針

1. **編集 UI が扱うのは「raw 0-9 ステータス」**（実ゲームプレイで参照される値）
2. 表示値（71, 12, 20 等の "display" カラム）は raw から自動算出（編集 UI では参考表示のみ）
3. 区分 1（14 base62 char）はランタイム再エンコードで生成 → JSON に持たない
4. 区分 2 の 9 桁守備適性は **位置別 0-9 配列**で保持（直感的）
5. 区分 3 の特殊能力フラグは **コード番号配列**で保持（UI ではチェックボックスで対応する日本語名表示）

---

## トップレベル

```json
{
  "version": 1,
  "name": "MyOriginal",
  "created": "2026-05-11T13:00:00Z",
  "modified": "2026-05-11T13:00:00Z",
  "charset": "ByDExOQGWUFkfwMK5trYASJpnRzhjosLu8NVi0TZC4a1IPHl2c3Xm6vqb7e9gd",
  "teams": [ /* 12 entries, see Team */ ]
}
```

- `charset`: dya.js 内 `s_n` の実値スナップショット（バージョン互換性確保用）

---

## Team

```json
{
  "index": 0,
  "name": "アリゲーターズ",
  "color": "#1a8a3f",
  "starting_order": [7, 6, 8, 3, 9, 5, 4, 2, 1],
  "players": [ /* 21 entries, see Player */ ]
}
```

- `index`: 0-11、`team_data` の case 番号と一致
- `name`: 表示用（編集 UI でのチーム選択時に使用）
- `color`: 編集 UI のチーム識別色
- `starting_order`: 先発打順、`set_shibi_ps` 由来。9 要素、各値は 0-9 の `players[N]` インデックス。10 以上の補欠を打順に入れる場合は別仕様（おそらく未サポート、要検証）
- `players`: 21 名固定

---

## Player

```json
{
  "slot": 0,
  "name": "伊達",
  "face_ref": "yB",
  "skin_color": "#434343",
  "is_pitcher": false,
  "secondary_ability": 0,
  "defensive_eligibility": [4, 3, 5, 2, 1, 1, 1, 1, 1],
  "special_flags": [4, 6, 10, 8],
  "batter_stats": {
    "batting_hand": 1,
    "condition": 1,
    "power": 5,
    "contact": 9,
    "kd": 3,
    "speed": 7,
    "stat4": 4,
    "stat5": 3,
    "stat6": 7,
    "stat7": 9,
    "stat8": 4,
    "stat9": 10,
    "stat10": 9,
    "stat11": 1,
    "stat12": 10
  },
  "pitcher_stats": null
}
```

### フィールド説明

| フィールド | 範囲 | 説明 |
|---|---|---|
| `slot` | 0-20 | チーム内インデックス（`set_plr_dat[N]`） |
| `name` | string | 表示名（漢字/カナ自由） |
| `face_ref` | 2-char id | 顔アセット参照（既存 252 ID から選択、`yB`, `yE` 等） |
| `skin_color` | hex | 肌色（CSS hex format、UI 上は color picker） |
| `is_pitcher` | bool | `true` の場合 `pitcher_stats` が非 null、`batter_stats` も任意（投手も打席に立つ） |
| `secondary_ability` | 0 / 62-69 | s_name field[7] 由来の副能力コード（リード強/弱、盗塁、サヨナラ男 等） |
| `defensive_eligibility` | int[9] (0-9) | 投/捕/一/二/三/遊/左/中/右 の守備適性スコア |
| `special_flags` | int[] | 特殊能力フラグ（バッター 3-11, 22-24、投手特殊球種 12-21） |

### `batter_stats`（全選手必須）

| キー | 範囲 | 意味 |
|---|---|---|
| `batting_hand` | 1, 2, 3 | 1=右打、2=左打、3=switch |
| `condition` | 0-4 | 開幕時の調子（試合中に変動する dyn 値とは別） |
| `power` | 1-10 | 長打（パワー）。実コード `bt_pd[][0] = prm_pw` |
| `contact` | 1-10 | ミート。`bt_pd[][1] = prm_ht` |
| `kd` | 1-10 | **[要追加調査]** 推定: 弾道 or 守備 or ?. `bt_pd[][2] = prm_kd` |
| `speed` | 1-10 | 走力。`bt_pd[][3]` → `ht_sp[N]` テーブル |
| `stat4`〜`stat12` | 1-10 | **[要追加調査]** 守備力 9 種別の仮説。順序: 投捕一二三遊左中右 と推定 |

注: 入力 0 は内部で 10 として扱われる（dya.js の `if(==0){=10}` 仕様）。
編集 UI では「1-10」のスライダー、JSON も 1-10 で保存、エンコード時に 10→0 変換。

### `pitcher_stats`（投手のみ。`is_pitcher: true` で必須）

```json
{
  "handedness": 1,
  "stat14": 7,
  "stat11": 9,
  "speed": 8,
  "control": 9,
  "break_straight": 5,
  "break_slider": 8,
  "break_curve": 7,
  "break_fork": 6,
  "break_screw": 1,
  "break_shoot": 5
}
```

| キー | 範囲 | 意味 |
|---|---|---|
| `handedness` | 1, 2 | 1=右投、2=左投。`pch_dat[][8]` |
| `stat14` | 1-10 | **[要追加調査]** スタミナ or 球種数。`pch_dat[][14]` |
| `stat11` | 1-10 | **[要追加調査]**（pitcher_comp 内で `--` される）`pch_dat[][11]` |
| `speed` | 1-10 | 球速。`pch_dat[][0]` |
| `control` | 1-10 | **[要追加調査]** コントロール推定 `pch_dat[][1]` |
| `break_*` | 1-10 | 各球種の変化量（仮説、要検証）。順序: ストレート / スライダー / カーブ / フォーク / スクリュー / シュート |

### `special_flags` のコードテーブル

#### バッター（`tksh_nr_s` @ dya.js:33659 より）

| コード | 名前 |
|---|---|
| 3 | 内野安打 |
| 4 | 流し打ち |
| 5 | 引っ張り |
| 6 | 粘り強い |
| 7 | チャンス強い |
| 8 | チャンス弱い |
| 9 | 三振 |
| 10 | リードオフマン |
| 11 | 初球狙い |
| 22 | 反撃の狼煙 |
| 23 | 逆転弾 |
| 24 | マシンガン |

#### 投手特殊球種（CLAUDE.md より既知）

| コード | 名前 | 上書き元 |
|---|---|---|
| 12 | カットボール | スライダー |
| 13 | スプリット | フォーク |
| 14 | ツーシーム | シュート |
| 15 | チェンジアップ | フォーク |
| 16 | サークルチェンジ | スクリュー |
| 17 | 縦スライダー | フォーク |
| 18 | 高速シンカー | スクリュー |
| 19 | スラーブ | カーブ |
| 20 | ノビ | ストレート (pitch_pw=1) |
| 21 | ホップ | ストレート (pitch_pw=1) |

#### `secondary_ability`（s_name field[7] 由来）

| コード | 名前（仮） |
|---|---|
| 0 | なし |
| 62 | リード弱 |
| 65 | リード強 |
| 66 | チャンス強 |
| 67 | チャンス強 |
| 68 | 盗塁 |
| 69 | サヨナラ男 |

**[要追加調査]** 65-69 の正確な名前マッピング。`tksh_nr_s` と重複する概念もあり、用途が異なる可能性。

---

## ランタイム再構築（bootstrap 側の責務）

JSON → `team_data` のレコード文字列への変換:

```
名前 # ENCODE_14(stats) # 9digits * d1*d2*d3*d4*d5*d6*d7*d8 # |flag|flag|...|
```

### ENCODE_14(stats)
バッター:
```js
const inum_set = [13, 17, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
// 引数: batter_stats オブジェクト
function buildBatterDigits(s) {
  const map = {
    13: s.batting_hand,
    17: s.condition,
    0: s.power, 1: s.contact, 2: s.kd, 3: s.speed,
    4: s.stat4, 5: s.stat5, 6: s.stat6, 7: s.stat7,
    8: s.stat8, 9: s.stat9, 10: s.stat10, 11: s.stat11, 12: s.stat12
  };
  let digits = "";
  for (const idx of inum_set) {
    let v = map[idx];
    if (v === 10) v = 0;   // 10 → 0 にスワップ（s_hrk 復号時に 0 → 10 に戻る）
    if (v < 0 || v > 9) throw new Error("stat out of range: " + idx);
    digits += String(v);
  }
  return digits;   // 15 桁の文字列
}
```

投手も同様、`inum_set_p = [8, 14, 11, 0, 1, 2, 3, 4, 5, 6, 7]` で 11 桁。残り 4 桁は 0 パディング。

### 14 base62 char へのエンコード
```js
const S_N = "ByDExOQGWUFkfwMK5trYASJpnRzhjosLu8NVi0TZC4a1IPHl2c3Xm6vqb7e9gd";

function s_tdm(decimalStr, len = 14) {
  // decimalStr の数値を base62 文字列にエンコード（左 0 詰めで len 桁）
  let n = BigInt(decimalStr);
  let r = "";
  while (n > 0n) {
    r = S_N[Number(n % 62n)] + r;
    n = n / 62n;
  }
  while (r.length < len) r = S_N[0] + r;   // 'B' で左パディング
  return r;
}
```

### 表示値の自動算出（区分 2 の 8 フィールド）
**[要追加調査] 厳密な式は未確定**。暫定式（編集 UI が表示する目安値、JSON には保存しない）:
```js
function displayPower(rawPower) {
  // raw 1-10 → display 30-90 程度
  return 25 + rawPower * 6.5;  // 仮
}
```
最終的に dya.js 内で表示値がどう参照されるか追加調査して厳密化する。

### 9 桁守備適性
`defensive_eligibility[0..8]` を連結 → 9 桁数字文字列。
例: `[4,3,5,2,1,1,1,1,1]` → `"435211111"`

### 完成レコード例
```
入力 JSON:
{
  "name": "伊達", "face_ref": "yB", "skin_color": "#434343", "is_pitcher": false,
  "secondary_ability": 0,
  "defensive_eligibility": [4,3,5,2,1,1,1,1,1],
  "special_flags": [4, 6, 10, 8],
  "batter_stats": { "batting_hand": 1, "condition": 1, "power": 5, "contact": 9,
    "kd": 3, "speed": 7, "stat4": 4, "stat5": 3, "stat6": 7, "stat7": 9,
    "stat8": 4, "stat9": 10, "stat10": 9, "stat11": 1, "stat12": 10 }
}

出力レコード:
"伊達#<14-base62-char>#435211111*<display values 5個>*434343*0*0#|4|6|10|8|"
```

---

## バリデーションルール

ツール書込時の必須チェック:

1. `teams.length === 12`
2. 各 `team.players.length === 21`
3. 各 `team.starting_order.length === 9`、要素値 ∈ [0, 9]、重複なし
4. 各 `player.name.length ≤ 7`（dya.js の `name_l.substr(0,7)` 仕様）
5. 各 `player.face_ref` が dya.js 内既存 252 ID のいずれか
6. 全ステータス値 ∈ [1, 10]
7. `defensive_eligibility[i]` ∈ [0, 9]、length === 9
8. `secondary_ability` ∈ {0, 62, 65, 66, 67, 68, 69}
9. `special_flags[i]` ∈ {3..11, 22, 23, 24, 12..21}（混在許容）
10. `skin_color` は `#RRGGBB` 形式

---

## マイグレーション

`version: 1` で開始。将来フィールド追加時は version をインクリメントし、bootstrap で旧版を自動マイグレーション。

---

## 次タスク (#3) で Flask UI スケルトンを書くときの起点

1. 起動時に `default_teams.json`（dya.js デフォルトを抽出した初期データ）をロード
2. 編集 → JSON 出力 → ユーザは「ブラウザの localStorage に保存」ボタンで dya proxy 側に渡す
   - 単純な実装: ユーザがコピペで dya proxy のコンソールに `localStorage.setItem('__dya_original_teams_v1', '<JSON>')` を叩く
   - 上級: Flask 側に POST API、proxy.js 側に「localStorage 書込指示」エンドポイントを追加（次以降の課題）
