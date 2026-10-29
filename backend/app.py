"""
Gemma 3 Web Interface — бэкенд на Flask + Ollama.

Эндпоинты:
  GET    /                       — отдаёт index.html
  GET    /api/sessions           — список сессий
  POST   /api/sessions           — создать сессию  { "title": "..." }
  GET    /api/sessions/<id>      — история сообщений сессии
  POST   /api/sessions/<id>/msg  — отправить сообщение (multipart: message, images[])
  DELETE /api/sessions/<id>      — удалить сессию
  GET    /uploads/<filename>     — отдача загруженного изображения

Ollama chat API: POST http://localhost:11434/api/chat
"""

import os
import json
import uuid
import base64
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import requests

# ---------------------------------------------------------------------------
# Пути и константы
# ---------------------------------------------------------------------------
PROJECT_DIR = Path(__file__).resolve().parent.parent
SESSIONS_DIR = PROJECT_DIR / "sessions"
UPLOADS_DIR = PROJECT_DIR / "uploads"
FRONTEND_DIR = PROJECT_DIR / "frontend"

SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIR.mkdir(parents=True, exist_ok=True)

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3")

# ---------------------------------------------------------------------------
# Flask приложение
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="/")
CORS(app)

# ---------------------------------------------------------------------------
# Вспомогательные функции для сессий
# ---------------------------------------------------------------------------

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _session_path(session_id: str) -> Path:
    return SESSIONS_DIR / f"{session_id}.json"


def _list_sessions():
    sessions = []
    for path in SESSIONS_DIR.glob("*.json"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            sessions.append({
                "id": data.get("id"),
                "title": data.get("title", "Новый чат"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "message_count": len(data.get("messages", [])),
            })
        except Exception:
            continue
    sessions.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    return sessions


def _load_session(session_id: str):
    path = _session_path(session_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_session(data: dict):
    path = _session_path(data["id"])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Маршруты — фронтенд
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(str(FRONTEND_DIR), filename)


@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(str(UPLOADS_DIR), filename)


# ---------------------------------------------------------------------------
# Маршруты — сессии
# ---------------------------------------------------------------------------

@app.route("/api/sessions", methods=["GET"])
def api_list_sessions():
    return jsonify(_list_sessions())


@app.route("/api/sessions", methods=["POST"])
def api_create_session():
    body = request.get_json(silent=True) or {}
    title = body.get("title") or "Новый чат"
    session_id = str(uuid.uuid4())
    now = _now_iso()
    data = {
        "id": session_id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }
    _save_session(data)
    return jsonify({
        "id": data["id"],
        "title": data["title"],
        "created_at": data["created_at"],
        "updated_at": data["updated_at"],
        "message_count": 0,
    }), 201


@app.route("/api/sessions/<session_id>", methods=["GET"])
def api_get_session(session_id):
    data = _load_session(session_id)
    if data is None:
        return jsonify({"error": "Сессия не найдена"}), 404
    return jsonify(data)


@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def api_delete_session(session_id):
    path = _session_path(session_id)
    if not path.exists():
        return jsonify({"error": "Сессия не найдена"}), 404
    path.unlink()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Маршрут — отправка сообщения (с изображениями)
# ---------------------------------------------------------------------------

def _save_uploaded_images(files):
    """Сохраняет загруженные изображения, возвращает список имён файлов."""
    saved = []
    for file in files:
        if file and file.filename:
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"):
                continue
            name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{ext}"
            file.save(str(UPLOADS_DIR / name))
            saved.append(name)
    return saved


def _image_to_base64(image_path: Path) -> str:
    """Читает изображение и возвращает base64 (без data-URI префикса)."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _build_ollama_messages(messages):
    """Преобразует сообщения из нашего формата в формат Ollama."""
    ollama_msgs = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        images = m.get("images", [])
        msg = {"role": role, "content": content}
        if images:
            img_b64 = []
            for img_name in images:
                img_path = UPLOADS_DIR / img_name
                if img_path.exists():
                    img_b64.append(_image_to_base64(img_path))
            if img_b64:
                msg["images"] = img_b64
        ollama_msgs.append(msg)
    return ollama_msgs


@app.route("/api/sessions/<session_id>/msg", methods=["POST"])
def api_send_message(session_id):
    data = _load_session(session_id)
    if data is None:
        return jsonify({"error": "Сессия не найдена"}), 404

    user_text = request.form.get("message", "")
    image_files = request.files.getlist("images")

    saved_images = _save_uploaded_images(image_files)

    user_msg = {
        "role": "user",
        "content": user_text,
        "images": saved_images,
        "timestamp": _now_iso(),
    }
    data["messages"].append(user_msg)
    data["updated_at"] = _now_iso()
    # Авто-название сессии по первому сообщению
    if data["title"] == "Новый чат" and user_text:
        data["title"] = user_text[:60] + ("…" if len(user_text) > 60 else "")
    _save_session(data)

    # --- потоковый ответ от Ollama ---
    def generate():
        ollama_messages = _build_ollama_messages(data["messages"])
        payload = {
            "model": OLLAMA_MODEL,
            "messages": ollama_messages,
            "stream": True,
        }

        full_reply = ""

        try:
            resp = requests.post(
                f"{OLLAMA_HOST}/api/chat",
                json=payload,
                stream=True,
                timeout=300,
            )
            resp.raise_for_status()

            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if chunk.get("done"):
                    break

                message = chunk.get("message", {})
                piece = message.get("content", "")
                if piece:
                    full_reply += piece
                    yield f"data: {json.dumps({'type': 'token', 'content': piece}, ensure_ascii=False)}\n\n"

        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)}, ensure_ascii=False)}\n\n"
            return

        # Сохраняем ответ ассистента в сессию
        assistant_msg = {
            "role": "assistant",
            "content": full_reply,
            "timestamp": _now_iso(),
        }
        data["messages"].append(assistant_msg)
        data["updated_at"] = _now_iso()
        _save_session(data)

        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype="text/event-stream")


# ---------------------------------------------------------------------------
# Запуск
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
