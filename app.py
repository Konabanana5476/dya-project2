"""
Original Team Editor — local Flask server.

Run: python app.py
Open: http://localhost:5001/
"""

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
DEFAULT_JSON = ROOT / "default_teams.json"
CUSTOM_JSON = ROOT / "custom_teams.json"
STATIC_DIR = ROOT / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")


def load_teams_data():
    """Return current editable JSON. Initializes custom_teams.json from default on first run."""
    if not CUSTOM_JSON.exists():
        if not DEFAULT_JSON.exists():
            raise FileNotFoundError(
                f"{DEFAULT_JSON.name} missing. Run `node extract_defaults.js` first."
            )
        shutil.copy(DEFAULT_JSON, CUSTOM_JSON)
    with CUSTOM_JSON.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_teams_data(data):
    data["modified"] = datetime.now(timezone.utc).isoformat()
    tmp = CUSTOM_JSON.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(CUSTOM_JSON)


# ---------- Routes ----------

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/teams", methods=["GET"])
def api_get_teams():
    return jsonify(load_teams_data())


@app.route("/api/teams", methods=["POST"])
def api_save_teams():
    data = request.get_json(force=True)
    if not isinstance(data, dict) or "teams" not in data:
        return jsonify({"error": "invalid payload"}), 400
    if len(data.get("teams", [])) != 12:
        return jsonify({"error": "must have exactly 12 teams"}), 400
    save_teams_data(data)
    return jsonify({"ok": True, "modified": data["modified"]})


@app.route("/api/defaults", methods=["GET"])
def api_get_defaults():
    """Return the read-only default snapshot (for reset operations)."""
    if not DEFAULT_JSON.exists():
        return jsonify({"error": "default_teams.json missing"}), 404
    with DEFAULT_JSON.open("r", encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Reset custom_teams.json from default_teams.json."""
    if not DEFAULT_JSON.exists():
        return jsonify({"error": "default_teams.json missing"}), 404
    shutil.copy(DEFAULT_JSON, CUSTOM_JSON)
    return jsonify({"ok": True})


@app.route("/api/export", methods=["GET"])
def api_export():
    """Return the saved JSON as a downloadable file."""
    data = load_teams_data()
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    return (
        payload,
        200,
        {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="original_teams.json"',
        },
    )


# ---------- Entry ----------

if __name__ == "__main__":
    # Initialize custom_teams.json if missing
    load_teams_data()
    port = int(os.environ.get("EDITOR_PORT", "5001"))
    print(f"\n  Original Team Editor")
    print(f"  http://localhost:{port}/\n")
    app.run(host="127.0.0.1", port=port, debug=False)
