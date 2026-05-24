# Codex Handoff

Last reviewed: 2026-05-24

## Current State

This project is a Dynamite Baseball proxy/editor package originally developed with Claude Code.

- Git branch: `main`
- Remote: `origin https://github.com/tenma2066-tech/dya-proxy.git`
- Working tree before this handoff file was clean.
- Latest commit: `ad1f6d6 Fix is_pitcher: detect by slot {8,17,18,19} not pos_type`

## Main Entry Points

- `proxy.js`
  - Starts the launcher/auth/proxy server.
  - Default URL: `http://localhost:8080/`
  - Default PIN: `231125`, override with `PROXY_AUTH_PIN`.
  - Routes:
    - `/auth`
    - `/editor`
    - `/online?cheat=0|1`
    - `/offline?cheat=0|1`
    - `/offline?saved=1&cheat=1`
    - `/offline?original=1&cheat=1`
- `build.js`
  - Rebuilds `dya_online.html` or `dya_offline.html`.
  - Commands: `node build.js online`, `node build.js offline`
- `team_editor/static/*`
  - Client-only embedded original-team editor served by `/editor`.
  - Editing persistence is JSON download/upload plus tab-scoped `sessionStorage` autosave.
- `team_editor/default_teams.json`
  - 12 teams x 21 players, schema version 2.
- `team_editor/verify_roundtrip.js`
  - Verifies encoder/decoder compatibility for default teams.
- `team_editor/app.py`
  - Legacy Flask editor. Kept in the tree but superseded by `/editor`.

## Current Original-Team Flow

1. Start the server with `node proxy.js` or `start.bat`.
2. Open `/editor`.
3. Create/open/edit teams.
4. Download `original_teams_*.json`.
5. Open `/offline?original=1&cheat=1`.
6. Upload the JSON in the full-screen overlay.
7. The game stores the uploaded JSON in `sessionStorage` for that tab and starts CPU play.

Important: the current original-team flow intentionally does not use persistent `localStorage`.
Old `localStorage['__orig_teams_data']` data is removed by the offline bootstrap.

## Verified On Review

Commands run successfully:

```powershell
node team_editor\verify_roundtrip.js
node --check proxy.js
node --check build.js
node --check team_editor\static\editor.js
node --check team_editor\extract_defaults.js
python -m py_compile team_editor\app.py
```

Roundtrip result:

```text
[verify] total players: 252, mismatches: 0
```

`python -m py_compile` created `team_editor/__pycache__/`; it was removed afterward.

## Notes For Next Work

- `CLAUDE.md` is the detailed historical work log. The latest relevant sections are:
  - `2026-05-11 オリジナルチームモード実装`
  - `2026-05-12 編集ツールをサイト内化`
  - `2026-05-12 オリジナル対戦を localStorage 撤去 + JSON アップロード必須に`
- Some older docs (`original_team_schema.md`, `dya_format_spec.md`) contain stale localStorage/base62 notes. Treat them as investigation history unless reconciled with `build.js`, `proxy.js`, and `CLAUDE.md` tail.
- If changing original-team encoding, run `node team_editor\verify_roundtrip.js` before rebuilding HTML.
- If changing proxy routes or editor bundling, test `node proxy.js` then check `/auth`, `/editor`, `/offline?original=1`, and `/__original_teams` remains 404.
- If rebuilding, expect large generated changes in `dya_online.html` / `dya_offline.html`.
