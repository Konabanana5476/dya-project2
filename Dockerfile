# Render / Fly.io 用 Dockerfile（依存ゼロ・最小構成）
# proxy.js は標準モジュールのみ使用するので package.json も node_modules も不要。
# ビルド済 HTML 2 つ、proxy.js、埋め込みエディタ素材をコンテナに入れて起動する。

FROM node:20-alpine

WORKDIR /app

# 必要最小限のファイルのみコピー（.dockerignore で他は除外）
COPY proxy.js ./
COPY dya_online.html ./
COPY dya_offline.html ./

# チーム編集ツール (/editor) の素材。proxy.js が serveEditor で読み込んで inline 配信。
# default_teams.json は editor の初期 252 選手データとして埋め込まれる。
COPY team_editor/static/index.html  team_editor/static/index.html
COPY team_editor/static/editor.css  team_editor/static/editor.css
COPY team_editor/static/editor.js   team_editor/static/editor.js
COPY team_editor/default_teams.json team_editor/default_teams.json

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 一般ユーザで実行（root のまま動かさない）
USER node

CMD ["node", "proxy.js"]
