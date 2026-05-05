from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import sqlite3, os, subprocess, json, asyncio, threading, uuid
from typing import Optional
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

load_dotenv()

app = FastAPI(title="OFM Control API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

BOT_DB = os.environ.get("BOT_DB_FILE", "/app/of_bot.db")
BOT_DIR = os.environ.get("BOT_DIR", "/app")
ENC_KEY_HEX = os.environ.get("ENCRYPTION_KEY", "")
OF_API_KEY = os.environ.get("OF_API_KEY", "")
OF_BASE = "https://app.onlyfansapi.com/api"
LOG_DIR = os.path.join(BOT_DIR, "logs")

_bot_proc = None
_bot_lock = threading.Lock()


# ── Crypto (must match Node.js crypto.js AES-256-GCM) ──────────────────────
def _enc_key():
    return bytes.fromhex(ENC_KEY_HEX) if ENC_KEY_HEX else None


def encrypt_val(text: str) -> Optional[str]:
    if not text:
        return None
    key = _enc_key()
    if not key:
        return None
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        iv = os.urandom(12)
        ct_tag = AESGCM(key).encrypt(iv, text.encode(), None)
        # ct_tag = ciphertext(n bytes) + tag(16 bytes)
        ct, tag = ct_tag[:-16], ct_tag[-16:]
        return f"{iv.hex()}:{tag.hex()}:{ct.hex()}"
    except Exception:
        return None


def decrypt_val(cipher: str) -> Optional[str]:
    if not cipher:
        return None
    key = _enc_key()
    if not key:
        return None
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        parts = cipher.split(":")
        if len(parts) != 3:
            return None
        iv = bytes.fromhex(parts[0])
        tag = bytes.fromhex(parts[1])
        ct = bytes.fromhex(parts[2])
        return AESGCM(key).decrypt(iv, ct + tag, None).decode()
    except Exception:
        return None


# ── Database ────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(BOT_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def row(r):
    return dict(r) if r else None


def rows(rs):
    return [dict(r) for r in rs]


def safe_tenant(t: dict) -> dict:
    if not t:
        return t
    t = dict(t)
    t["has_cookie"] = bool(t.pop("of_cookie_encrypted", None))
    t["has_xbc"] = bool(t.pop("of_x_bc_encrypted", None))
    t["has_anthropic_key"] = bool(t.pop("anthropic_api_key_encrypted", None))
    t["enabled"] = bool(t.get("enabled"))
    t["human_review_mode"] = bool(t.get("human_review_mode"))
    return t


def init_schema():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            of_user_id TEXT NOT NULL,
            of_cookie_encrypted TEXT NOT NULL DEFAULT '',
            of_x_bc_encrypted TEXT NOT NULL DEFAULT '',
            anthropic_api_key_encrypted TEXT,
            claude_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
            system_prompt TEXT NOT NULL DEFAULT '',
            poll_interval_seconds INTEGER NOT NULL DEFAULT 15,
            reply_delay_min_seconds INTEGER NOT NULL DEFAULT 30,
            reply_delay_max_seconds INTEGER NOT NULL DEFAULT 120,
            history_limit INTEGER NOT NULL DEFAULT 10,
            human_review_mode INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS replied_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            replied_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(tenant_id, message_id)
        );
        CREATE TABLE IF NOT EXISTS pending_drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            fan_user_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            fan_message_text TEXT NOT NULL,
            draft_reply TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS blocked_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            fan_user_id TEXT NOT NULL,
            fan_name TEXT,
            blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(tenant_id, fan_user_id)
        );
    """)
    conn.commit()
    conn.close()


init_schema()


# ── Pydantic models ─────────────────────────────────────────────────────────
class TenantCreate(BaseModel):
    name: str
    of_user_id: str
    of_cookie: str = ""
    of_x_bc: str = ""
    anthropic_api_key: Optional[str] = None
    claude_model: str = "claude-sonnet-4-6"
    system_prompt: str = ""
    poll_interval_seconds: int = 15
    reply_delay_min_seconds: int = 30
    reply_delay_max_seconds: int = 120
    history_limit: int = 10
    human_review_mode: bool = False


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    of_user_id: Optional[str] = None
    of_cookie: Optional[str] = None
    of_x_bc: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    claude_model: Optional[str] = None
    system_prompt: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    reply_delay_min_seconds: Optional[int] = None
    reply_delay_max_seconds: Optional[int] = None
    history_limit: Optional[int] = None
    human_review_mode: Optional[bool] = None


class DraftBody(BaseModel):
    draft_reply: str


# ── Bot process helpers ─────────────────────────────────────────────────────
def find_bot_pid() -> Optional[int]:
    try:
        r = subprocess.run(["pgrep", "-f", "node main.js"], capture_output=True, text=True)
        pids = [p.strip() for p in r.stdout.strip().split() if p.strip()]
        return int(pids[0]) if pids else None
    except Exception:
        return None


def bot_status_dict() -> dict:
    global _bot_proc
    if _bot_proc and _bot_proc.poll() is None:
        return {"status": "running", "pid": _bot_proc.pid}
    pid = find_bot_pid()
    if pid:
        return {"status": "running", "pid": pid}
    return {"status": "stopped", "pid": None}


# ── Log helpers ─────────────────────────────────────────────────────────────
def read_log_lines(n: int = 200) -> list:
    all_lines = []
    try:
        files = sorted([
            os.path.join(LOG_DIR, f)
            for f in os.listdir(LOG_DIR)
            if f.endswith(".log")
        ])
    except Exception:
        return []
    for filepath in files:
        try:
            with open(filepath) as fh:
                all_lines.extend(l.rstrip() for l in fh if l.strip())
        except Exception:
            pass
    all_lines.sort(key=lambda x: x[:19])
    return all_lines[-n:]


# ═══════════════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/stats")
def get_stats():
    conn = get_db()
    active = conn.execute("SELECT COUNT(*) c FROM tenants WHERE enabled=1").fetchone()["c"]
    pending = conn.execute("SELECT COUNT(*) c FROM pending_drafts WHERE status='pending'").fetchone()["c"]
    replied = conn.execute(
        "SELECT COUNT(*) c FROM replied_messages WHERE replied_at >= date('now')"
    ).fetchone()["c"]
    blocked = conn.execute("SELECT COUNT(*) c FROM blocked_users").fetchone()["c"]
    conn.close()
    info = bot_status_dict()
    return {
        "bot_status": info["status"],
        "bot_pid": info["pid"],
        "active_tenants": active,
        "pending_drafts": pending,
        "replied_today": replied,
        "blocked_users": blocked,
        "encryption_key_set": bool(ENC_KEY_HEX),
        "of_api_key_set": bool(OF_API_KEY),
    }


# ── Bot control ─────────────────────────────────────────────────────────────
@app.get("/api/bot/status")
def get_bot_status():
    return bot_status_dict()


@app.post("/api/bot/start")
def start_bot():
    global _bot_proc
    with _bot_lock:
        if find_bot_pid() or (_bot_proc and _bot_proc.poll() is None):
            return {"status": "already_running"}
        env = os.environ.copy()
        _bot_proc = subprocess.Popen(
            ["node", "main.js"],
            cwd=BOT_DIR,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {"status": "started", "pid": _bot_proc.pid}


@app.post("/api/bot/stop")
def stop_bot():
    global _bot_proc
    with _bot_lock:
        stopped = False
        if _bot_proc and _bot_proc.poll() is None:
            _bot_proc.terminate()
            try:
                _bot_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _bot_proc.kill()
            stopped = True
        pid = find_bot_pid()
        if pid:
            try:
                subprocess.run(["kill", str(pid)], capture_output=True)
                stopped = True
            except Exception:
                pass
        return {"status": "stopped" if stopped else "not_running"}


# ── Tenants ─────────────────────────────────────────────────────────────────
@app.get("/api/tenants")
def list_tenants():
    conn = get_db()
    rs = conn.execute("SELECT * FROM tenants ORDER BY created_at").fetchall()
    conn.close()
    return [safe_tenant(row(r)) for r in rs]


@app.post("/api/tenants")
def create_tenant(body: TenantCreate):
    conn = get_db()
    if conn.execute("SELECT 1 FROM tenants WHERE name=?", (body.name,)).fetchone():
        conn.close()
        raise HTTPException(400, f"Tenant '{body.name}' already exists")
    tid = uuid.uuid4().hex
    conn.execute(
        """INSERT INTO tenants
           (id,name,of_user_id,of_cookie_encrypted,of_x_bc_encrypted,
            anthropic_api_key_encrypted,claude_model,system_prompt,
            poll_interval_seconds,reply_delay_min_seconds,reply_delay_max_seconds,
            history_limit,human_review_mode)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            tid, body.name, body.of_user_id,
            encrypt_val(body.of_cookie) or "",
            encrypt_val(body.of_x_bc) or "",
            encrypt_val(body.anthropic_api_key),
            body.claude_model, body.system_prompt,
            body.poll_interval_seconds,
            body.reply_delay_min_seconds,
            body.reply_delay_max_seconds,
            body.history_limit,
            1 if body.human_review_mode else 0,
        ),
    )
    conn.commit()
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (tid,)).fetchone()
    conn.close()
    return safe_tenant(row(t))


@app.get("/api/tenants/{tid}")
def get_tenant(tid: str):
    conn = get_db()
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (tid,)).fetchone()
    conn.close()
    if not t:
        raise HTTPException(404, "Tenant not found")
    return safe_tenant(row(t))


@app.put("/api/tenants/{tid}")
def update_tenant(tid: str, body: TenantUpdate):
    conn = get_db()
    if not conn.execute("SELECT 1 FROM tenants WHERE id=?", (tid,)).fetchone():
        conn.close()
        raise HTTPException(404, "Tenant not found")
    updates = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.of_user_id is not None:
        updates["of_user_id"] = body.of_user_id
    if body.of_cookie is not None:
        updates["of_cookie_encrypted"] = encrypt_val(body.of_cookie) or ""
    if body.of_x_bc is not None:
        updates["of_x_bc_encrypted"] = encrypt_val(body.of_x_bc) or ""
    if body.anthropic_api_key is not None:
        updates["anthropic_api_key_encrypted"] = encrypt_val(body.anthropic_api_key)
    if body.claude_model is not None:
        updates["claude_model"] = body.claude_model
    if body.system_prompt is not None:
        updates["system_prompt"] = body.system_prompt
    if body.poll_interval_seconds is not None:
        updates["poll_interval_seconds"] = body.poll_interval_seconds
    if body.reply_delay_min_seconds is not None:
        updates["reply_delay_min_seconds"] = body.reply_delay_min_seconds
    if body.reply_delay_max_seconds is not None:
        updates["reply_delay_max_seconds"] = body.reply_delay_max_seconds
    if body.history_limit is not None:
        updates["history_limit"] = body.history_limit
    if body.human_review_mode is not None:
        updates["human_review_mode"] = 1 if body.human_review_mode else 0
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates)
        conn.execute(
            f"UPDATE tenants SET {sets}, updated_at=datetime('now') WHERE id=?",
            list(updates.values()) + [tid],
        )
        conn.commit()
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (tid,)).fetchone()
    conn.close()
    return safe_tenant(row(t))


@app.delete("/api/tenants/{tid}")
def delete_tenant(tid: str):
    conn = get_db()
    conn.execute("DELETE FROM tenants WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/tenants/{tid}/enable")
def enable_tenant(tid: str):
    conn = get_db()
    conn.execute("UPDATE tenants SET enabled=1, updated_at=datetime('now') WHERE id=?", (tid,))
    conn.commit()
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (tid,)).fetchone()
    conn.close()
    return safe_tenant(row(t))


@app.post("/api/tenants/{tid}/disable")
def disable_tenant(tid: str):
    conn = get_db()
    conn.execute("UPDATE tenants SET enabled=0, updated_at=datetime('now') WHERE id=?", (tid,))
    conn.commit()
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (tid,)).fetchone()
    conn.close()
    return safe_tenant(row(t))


# ── Chats (via OF API) ───────────────────────────────────────────────────────
@app.get("/api/tenants/{tid}/chats")
async def get_chats(tid: str):
    conn = get_db()
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (tid,)).fetchone()
    blocked_set = {
        r["fan_user_id"]
        for r in conn.execute(
            "SELECT fan_user_id FROM blocked_users WHERE tenant_id=?", (tid,)
        ).fetchall()
    }
    conn.close()
    if not t:
        raise HTTPException(404, "Tenant not found")
    if not OF_API_KEY:
        raise HTTPException(503, "OF_API_KEY not configured in backend .env")
    of_uid = dict(t)["of_user_id"]
    async with httpx.AsyncClient(timeout=30) as c:
        resp = await c.get(
            f"{OF_BASE}/{of_uid}/chats",
            headers={"Authorization": f"Bearer {OF_API_KEY}", "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        chats = data.get("data", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    for chat in chats:
        fid = str((chat.get("fan") or {}).get("id", ""))
        chat["_blocked"] = fid in blocked_set
    return {"chats": chats}


@app.get("/api/tenants/{tid}/chats/{fan_id}/messages")
async def get_messages(tid: str, fan_id: str):
    conn = get_db()
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (tid,)).fetchone()
    conn.close()
    if not t:
        raise HTTPException(404, "Tenant not found")
    if not OF_API_KEY:
        raise HTTPException(503, "OF_API_KEY not configured in backend .env")
    of_uid = dict(t)["of_user_id"]
    async with httpx.AsyncClient(timeout=30) as c:
        resp = await c.get(
            f"{OF_BASE}/{of_uid}/chats/{fan_id}/messages?limit=30",
            headers={"Authorization": f"Bearer {OF_API_KEY}", "Accept": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
        msgs = data.get("data", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    return {"messages": msgs}


# ── Blocked users ────────────────────────────────────────────────────────────
@app.get("/api/blocked")
def get_all_blocked():
    conn = get_db()
    rs = conn.execute(
        """SELECT b.*, t.name tenant_name
           FROM blocked_users b
           LEFT JOIN tenants t ON b.tenant_id=t.id
           ORDER BY b.blocked_at DESC"""
    ).fetchall()
    conn.close()
    return rows(rs)


@app.post("/api/tenants/{tid}/block/{fan_id}")
def block_user(tid: str, fan_id: str, fan_name: Optional[str] = Query(None)):
    conn = get_db()
    conn.execute(
        "INSERT OR IGNORE INTO blocked_users (tenant_id,fan_user_id,fan_name) VALUES (?,?,?)",
        (tid, fan_id, fan_name),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/tenants/{tid}/block/{fan_id}")
def unblock_user(tid: str, fan_id: str):
    conn = get_db()
    conn.execute(
        "DELETE FROM blocked_users WHERE tenant_id=? AND fan_user_id=?", (tid, fan_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Drafts ───────────────────────────────────────────────────────────────────
@app.get("/api/drafts")
def get_drafts(tenant_id: Optional[str] = Query(None)):
    conn = get_db()
    base = """SELECT d.*, t.name tenant_name
              FROM pending_drafts d
              LEFT JOIN tenants t ON d.tenant_id=t.id
              WHERE d.status='pending'"""
    if tenant_id:
        rs = conn.execute(base + " AND d.tenant_id=? ORDER BY d.created_at", (tenant_id,)).fetchall()
    else:
        rs = conn.execute(base + " ORDER BY d.created_at").fetchall()
    conn.close()
    return rows(rs)


@app.post("/api/drafts/{did}/approve")
def approve_draft(did: int, body: Optional[DraftBody] = None):
    conn = get_db()
    d = conn.execute("SELECT * FROM pending_drafts WHERE id=?", (did,)).fetchone()
    if not d:
        conn.close()
        raise HTTPException(404, "Draft not found")
    d = row(d)
    t = conn.execute("SELECT * FROM tenants WHERE id=?", (d["tenant_id"],)).fetchone()
    if not t:
        conn.close()
        raise HTTPException(404, "Tenant not found")
    t = row(t)
    reply = body.draft_reply if body else d["draft_reply"]
    conn.execute(
        "UPDATE pending_drafts SET status='sent', draft_reply=?, updated_at=datetime('now') WHERE id=?",
        (reply, did),
    )
    conn.execute(
        "INSERT OR IGNORE INTO replied_messages (tenant_id,message_id) VALUES (?,?)",
        (d["tenant_id"], d["message_id"]),
    )
    conn.commit()
    conn.close()
    if OF_API_KEY:
        try:
            with httpx.Client(timeout=30) as hc:
                hc.post(
                    f"{OF_BASE}/{t['of_user_id']}/chats/{d['fan_user_id']}/messages",
                    headers={"Authorization": f"Bearer {OF_API_KEY}", "Accept": "application/json"},
                    json={"text": reply},
                )
        except Exception as e:
            return {"ok": True, "sent": False, "error": str(e)}
    return {"ok": True, "sent": bool(OF_API_KEY)}


@app.post("/api/drafts/{did}/reject")
def reject_draft(did: int):
    conn = get_db()
    conn.execute(
        "UPDATE pending_drafts SET status='rejected', updated_at=datetime('now') WHERE id=?", (did,)
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.put("/api/drafts/{did}")
def update_draft(did: int, body: DraftBody):
    conn = get_db()
    conn.execute(
        "UPDATE pending_drafts SET draft_reply=?, updated_at=datetime('now') WHERE id=?",
        (body.draft_reply, did),
    )
    conn.commit()
    d = conn.execute("SELECT * FROM pending_drafts WHERE id=?", (did,)).fetchone()
    conn.close()
    return row(d)


# ── Logs ─────────────────────────────────────────────────────────────────────
@app.get("/api/logs")
def get_logs(n: int = Query(200)):
    return {"lines": read_log_lines(n)}


@app.get("/api/logs/stream")
async def stream_logs(request: Request):
    async def gen():
        # Seed with last 100 lines
        for line in read_log_lines(100):
            yield f"data: {json.dumps({'line': line})}\n\n"

        log_file = os.path.join(LOG_DIR, "bot.log")
        last_size = 0
        try:
            last_size = os.path.getsize(log_file)
        except Exception:
            pass

        while True:
            if await request.is_disconnected():
                break
            try:
                sz = os.path.getsize(log_file)
                if sz > last_size:
                    with open(log_file) as f:
                        f.seek(last_size)
                        new_content = f.read()
                    last_size = sz
                    for line in new_content.split("\n"):
                        line = line.strip()
                        if line:
                            yield f"data: {json.dumps({'line': line})}\n\n"
            except Exception:
                pass
            await asyncio.sleep(1)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
