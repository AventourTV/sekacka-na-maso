# OFM Bot Control — Backend API Specification

> Hand this document to any coding agent (or implement it yourself) to build the backend
> that powers the OFM Control dashboard. The frontend is already built and calls these
> exact endpoints. Do not rename or restructure any route.

---

## 1. Overview

The dashboard is a React SPA hosted on Vercel. It talks to this backend via REST JSON APIs
and one Server-Sent Events (SSE) endpoint. The backend must:

- Serve all routes under the `/api/` prefix.
- Allow CORS from any origin (`*`).
- Read/write a **SQLite** database (`of_bot.db`) that is **shared** with the running Node.js bot.
- Use **AES-256-GCM** (matching the bot's `crypto.js`) to encrypt/decrypt credentials at rest.
- Proxy chat/message requests to `https://app.onlyfansapi.com/api` using `OF_API_KEY`.
- Start and stop the Node.js bot process (`node main.js`).
- Tail bot log files and stream new lines via SSE.

The reference implementation (Python / FastAPI) lives in `/app/backend/server.py`.
You may re-implement this in any language (Node/Express, Go, PHP, etc.) as long as
every route contract below is satisfied.

---

## 2. Environment Variables

| Variable          | Required | Description |
|-------------------|----------|-------------|
| `BOT_DB_FILE`     | yes      | Absolute path to `of_bot.db`, e.g. `/app/of_bot.db` |
| `BOT_DIR`         | yes      | Directory where `main.js` lives, e.g. `/app` |
| `ENCRYPTION_KEY`  | yes      | 64-char hex string (32 bytes). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — must match the key used by the bot |
| `OF_API_KEY`      | yes      | API key for `app.onlyfansapi.com` |
| `LOG_DIR`         | no       | Path to log directory. Default: `{BOT_DIR}/logs` |

---

## 3. Database Schema

The backend **shares** the SQLite file with the bot. Run these `CREATE TABLE IF NOT EXISTS`
statements on startup so the schema is always in sync. Do **not** drop or alter existing tables.

```sql
-- Already created by the bot (match exactly)
CREATE TABLE IF NOT EXISTS tenants (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL UNIQUE,
  enabled                     INTEGER NOT NULL DEFAULT 1,
  of_user_id                  TEXT NOT NULL,
  of_cookie_encrypted         TEXT NOT NULL DEFAULT '',
  of_x_bc_encrypted           TEXT NOT NULL DEFAULT '',
  anthropic_api_key_encrypted TEXT,
  claude_model                TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  system_prompt               TEXT NOT NULL DEFAULT '',
  poll_interval_seconds       INTEGER NOT NULL DEFAULT 15,
  reply_delay_min_seconds     INTEGER NOT NULL DEFAULT 30,
  reply_delay_max_seconds     INTEGER NOT NULL DEFAULT 120,
  history_limit               INTEGER NOT NULL DEFAULT 10,
  human_review_mode           INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS replied_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  replied_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, message_id)
);

CREATE TABLE IF NOT EXISTS pending_drafts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  fan_user_id       TEXT NOT NULL,
  message_id        TEXT NOT NULL,
  fan_message_text  TEXT NOT NULL,
  draft_reply       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Added by the API (new table — bot also reads this)
CREATE TABLE IF NOT EXISTS blocked_users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    TEXT NOT NULL,
  fan_user_id  TEXT NOT NULL,
  fan_name     TEXT,
  blocked_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, fan_user_id)
);
```

---

## 4. Encryption / Decryption

All sensitive fields (`of_cookie_encrypted`, `of_x_bc_encrypted`,
`anthropic_api_key_encrypted`) are stored as AES-256-GCM ciphertext.
The format is a colon-separated string:

```
{iv_hex}:{auth_tag_hex}:{ciphertext_hex}
```

- IV: 12 random bytes
- Auth tag: 16 bytes (appended by GCM)
- Key: 32-byte key from `ENCRYPTION_KEY` env var (64-char hex → decode to bytes)

### Node.js reference (already in `crypto.js`):

```js
const ALGO = 'aes-256-gcm';
const key  = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

function encrypt(plaintext) {
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv(ALGO, key, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(ciphertext) {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
}
```

### Python reference (in `server.py`):

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

key = bytes.fromhex(os.environ['ENCRYPTION_KEY'])

def encrypt(text):
    iv       = os.urandom(12)
    ct_tag   = AESGCM(key).encrypt(iv, text.encode(), None)
    ct, tag  = ct_tag[:-16], ct_tag[-16:]
    return f"{iv.hex()}:{tag.hex()}:{ct.hex()}"

def decrypt(cipher):
    iv_hex, tag_hex, ct_hex = cipher.split(':')
    iv, tag, ct = bytes.fromhex(iv_hex), bytes.fromhex(tag_hex), bytes.fromhex(ct_hex)
    return AESGCM(key).decrypt(iv, ct + tag, None).decode()
```

---

## 5. Safe Tenant Object

Endpoints that return a tenant must **never expose raw encrypted fields**.
Instead, strip them and add boolean presence flags:

```json
{
  "id": "abc123",
  "name": "creator1",
  "enabled": true,
  "of_user_id": "acct_xxx",
  "claude_model": "claude-sonnet-4-6",
  "system_prompt": "You are...",
  "poll_interval_seconds": 15,
  "reply_delay_min_seconds": 30,
  "reply_delay_max_seconds": 120,
  "history_limit": 10,
  "human_review_mode": false,
  "created_at": "2025-01-01 12:00:00",
  "updated_at": "2025-01-01 12:00:00",
  "has_cookie": true,
  "has_xbc": true,
  "has_anthropic_key": false
}
```

---

## 6. Error Format

All error responses must be JSON:

```json
{ "detail": "Human-readable error message" }
```

HTTP status codes: `400` bad request, `404` not found, `503` service unavailable.

---

## 7. Endpoints

### 7.1 Health

#### `GET /api/health`
Returns server health.

**Response 200:**
```json
{ "ok": true }
```

---

### 7.2 Stats

#### `GET /api/stats`
Returns aggregated dashboard stats. Called every 20 seconds by the dashboard.

**Response 200:**
```json
{
  "bot_status": "running",
  "bot_pid": 1234,
  "active_tenants": 2,
  "pending_drafts": 3,
  "replied_today": 47,
  "blocked_users": 5,
  "encryption_key_set": true,
  "of_api_key_set": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `bot_status` | `"running"` \| `"stopped"` | Whether the Node.js bot process is alive |
| `bot_pid` | integer \| null | PID of the bot process |
| `active_tenants` | integer | COUNT of tenants WHERE enabled=1 |
| `pending_drafts` | integer | COUNT of pending_drafts WHERE status='pending' |
| `replied_today` | integer | COUNT of replied_messages WHERE replied_at >= today |
| `blocked_users` | integer | COUNT of blocked_users |
| `encryption_key_set` | boolean | Whether ENCRYPTION_KEY env var is non-empty |
| `of_api_key_set` | boolean | Whether OF_API_KEY env var is non-empty |

---

### 7.3 Bot Control

#### `GET /api/bot/status`
Returns current bot process status.

**Response 200:**
```json
{ "status": "running", "pid": 1234 }
```
`status` is `"running"` or `"stopped"`. `pid` is null when stopped.

**Detection logic:**
1. Check if the tracked child process is still alive.
2. Fallback: scan system processes for `node main.js`.

---

#### `POST /api/bot/start`
Spawns `node main.js` in `BOT_DIR` as a background process.

**Response 200 (started):**
```json
{ "status": "started", "pid": 1234 }
```

**Response 200 (already running):**
```json
{ "status": "already_running" }
```

Notes:
- Inherit the current process environment so the bot picks up its own `.env`.
- Do **not** attach stdin/stdout pipes (let the bot write to its own log files).
- Store the PID so `stop` and `status` can reference it.

---

#### `POST /api/bot/stop`
Sends SIGTERM to the bot process, waits up to 5 seconds, then SIGKILL if needed.

**Response 200:**
```json
{ "status": "stopped" }
```
or
```json
{ "status": "not_running" }
```

---

### 7.4 Tenants (Accounts)

All tenant responses use the **safe tenant object** (section 5).

---

#### `GET /api/tenants`
List all tenants ordered by `created_at`.

**Response 200:** Array of safe tenant objects.

```json
[
  { "id": "abc", "name": "creator1", "enabled": true, ... },
  { "id": "def", "name": "creator2", "enabled": false, ... }
]
```

---

#### `POST /api/tenants`
Create a new tenant.

**Request body:**
```json
{
  "name": "creator1",
  "of_user_id": "acct_xxx",
  "of_cookie": "auth_uid=...",
  "of_x_bc": "xxx",
  "anthropic_api_key": "sk-ant-...",
  "claude_model": "claude-sonnet-4-6",
  "system_prompt": "You are a warm...",
  "poll_interval_seconds": 15,
  "reply_delay_min_seconds": 30,
  "reply_delay_max_seconds": 120,
  "history_limit": 10,
  "human_review_mode": false
}
```

| Field | Required | Default |
|-------|----------|---------|
| `name` | yes | — |
| `of_user_id` | yes | — |
| `of_cookie` | no | `""` |
| `of_x_bc` | no | `""` |
| `anthropic_api_key` | no | null |
| `claude_model` | no | `"claude-sonnet-4-6"` |
| `system_prompt` | no | `""` |
| `poll_interval_seconds` | no | `15` |
| `reply_delay_min_seconds` | no | `30` |
| `reply_delay_max_seconds` | no | `120` |
| `history_limit` | no | `10` |
| `human_review_mode` | no | `false` |

Before inserting: encrypt `of_cookie`, `of_x_bc`, `anthropic_api_key` (if provided).
Generate a random hex UUID for `id`.

**Response 201 / 200:** Safe tenant object of the newly created tenant.

**Error 400:** `{ "detail": "Tenant 'creator1' already exists" }` if name is taken.

---

#### `GET /api/tenants/{id}`
Get a single tenant by ID.

**Response 200:** Safe tenant object.
**Error 404:** `{ "detail": "Tenant not found" }`

---

#### `PUT /api/tenants/{id}`
Update one or more fields. All fields are optional — only provided fields are updated.

**Request body (all optional):**
```json
{
  "name": "new_name",
  "of_user_id": "acct_yyy",
  "of_cookie": "auth_uid=new...",
  "of_x_bc": "new_xbc",
  "anthropic_api_key": "sk-ant-new",
  "claude_model": "claude-haiku-4-5",
  "system_prompt": "New persona...",
  "poll_interval_seconds": 30,
  "reply_delay_min_seconds": 60,
  "reply_delay_max_seconds": 180,
  "history_limit": 15,
  "human_review_mode": true
}
```

Any credential field provided will be **re-encrypted** and stored.
Always update `updated_at = datetime('now')`.

**Response 200:** Updated safe tenant object.
**Error 404:** Not found.

---

#### `DELETE /api/tenants/{id}`
Delete a tenant and all its associated data (CASCADE).

**Response 200:** `{ "ok": true }`

---

#### `POST /api/tenants/{id}/enable`
Set `enabled = 1` for the tenant.

**Response 200:** Updated safe tenant object.

---

#### `POST /api/tenants/{id}/disable`
Set `enabled = 0` for the tenant.

**Response 200:** Updated safe tenant object.

---

### 7.5 Chats (OnlyFans API Proxy)

These endpoints proxy requests to `https://app.onlyfansapi.com/api`.
Require `OF_API_KEY` to be set. Return `503` if it is not.

The `Authorization` header sent to the OF API is: `Bearer {OF_API_KEY}`.

---

#### `GET /api/tenants/{id}/chats`
Fetch all chats for a tenant's OnlyFans account.

**Upstream call:**
```
GET https://app.onlyfansapi.com/api/{of_user_id}/chats
Authorization: Bearer {OF_API_KEY}
```

Post-process: for every chat in the response, look up whether the fan is in
`blocked_users` for this tenant and **annotate** each chat object with:
```json
"_blocked": true
```

**Response 200:**
```json
{
  "chats": [
    {
      "fan": { "id": "123", "name": "John", "username": "john_fan" },
      "unreadMessagesCount": 2,
      "lastMessage": { "text": "Hey!", "is_from_me": false },
      "_blocked": false
    }
  ]
}
```

**Error 503:** `{ "detail": "OF_API_KEY not configured in backend .env" }`
**Error 404:** Tenant not found.

---

#### `GET /api/tenants/{id}/chats/{fan_id}/messages`
Fetch message history for a specific fan conversation.

**Upstream call:**
```
GET https://app.onlyfansapi.com/api/{of_user_id}/chats/{fan_id}/messages?limit=30
Authorization: Bearer {OF_API_KEY}
```

**Response 200:**
```json
{
  "messages": [
    {
      "id": "msg_abc",
      "text": "<p>Hey babe!</p>",
      "is_from_me": false,
      "fromUser": { "id": "123" }
    },
    {
      "id": "msg_def",
      "text": "Hey! How are you?",
      "is_from_me": true
    }
  ]
}
```

Note: the frontend strips HTML from message text client-side.

---

### 7.6 Blocked Users

---

#### `GET /api/blocked`
List all blocked users across all tenants.

**Response 200:**
```json
[
  {
    "id": 1,
    "tenant_id": "abc",
    "fan_user_id": "456",
    "fan_name": "Jane",
    "blocked_at": "2025-01-02 10:00:00",
    "tenant_name": "creator1"
  }
]
```

---

#### `POST /api/tenants/{id}/block/{fan_id}`
Block a specific fan for a tenant (bot will skip replies to them).

**Query param:** `fan_name` (optional string) — the display name of the fan.

Example: `POST /api/tenants/abc/block/456?fan_name=Jane`

Performs `INSERT OR IGNORE` (idempotent — safe to call if already blocked).

**Response 200:** `{ "ok": true }`

---

#### `DELETE /api/tenants/{id}/block/{fan_id}`
Unblock a fan — bot will resume replying to them.

**Response 200:** `{ "ok": true }`

---

### 7.7 Pending Drafts

Drafts are created by the bot when `human_review_mode = 1` for a tenant.
The dashboard lets operators approve or reject before sending.

---

#### `GET /api/drafts`
List all pending drafts (status = `'pending'`), optionally filtered by tenant.

**Query param:** `tenant_id` (optional string)

**Response 200:**
```json
[
  {
    "id": 1,
    "tenant_id": "abc",
    "fan_user_id": "456",
    "message_id": "msg_xyz",
    "fan_message_text": "omg ur so hot",
    "draft_reply": "Aww thank you! You're so sweet 😊",
    "status": "pending",
    "created_at": "2025-01-02 10:00:00",
    "updated_at": "2025-01-02 10:00:00",
    "tenant_name": "creator1"
  }
]
```

---

#### `POST /api/drafts/{id}/approve`
Approve a draft and optionally override the reply text.

**Request body (optional — omit to use existing draft text):**
```json
{ "draft_reply": "Edited reply text here" }
```

**Logic:**
1. Look up draft by `id`. Return 404 if not found.
2. Look up the tenant. Return 404 if not found.
3. Update `pending_drafts` set `status = 'sent'`, `draft_reply = <final_text>`.
4. Insert into `replied_messages (tenant_id, message_id)` (INSERT OR IGNORE).
5. If `OF_API_KEY` is set: send the reply via OF API:
   ```
   POST https://app.onlyfansapi.com/api/{of_user_id}/chats/{fan_user_id}/messages
   Content-Type: application/json
   Authorization: Bearer {OF_API_KEY}

   { "text": "<final reply text>" }
   ```
6. Return result.

**Response 200:**
```json
{ "ok": true, "sent": true }
```
or if OF API call failed:
```json
{ "ok": true, "sent": false, "error": "connection timeout" }
```

---

#### `POST /api/drafts/{id}/reject`
Mark a draft as rejected (will not be sent).

**Response 200:** `{ "ok": true }`

---

#### `PUT /api/drafts/{id}`
Update the draft reply text without approving it (save for later review).

**Request body:**
```json
{ "draft_reply": "Updated draft text" }
```

**Response 200:** The updated `pending_drafts` row as JSON.

---

### 7.8 Logs

Bot logs are written to files in `LOG_DIR` (default: `{BOT_DIR}/logs`).
Log filenames follow the pattern `bot.log` and `tenant_{name}.log`.

Each log line format (from Winston):
```
2025-01-02 10:30:00 [INFO] scheduler — Fetched 5 chats
2025-01-02 10:30:01 [ERROR] tenant_creator1 — Claude API error: ...
```

---

#### `GET /api/logs`
Return last N lines from all log files, merged and sorted by timestamp prefix.

**Query param:** `n` (integer, default `200`, max recommend `1000`)

**Response 200:**
```json
{
  "lines": [
    "2025-01-02 10:30:00 [INFO] scheduler — Fetched 5 chats",
    "2025-01-02 10:30:01 [INFO] scheduler — Sent reply to fan 123"
  ]
}
```

---

#### `GET /api/logs/stream`
**Server-Sent Events (SSE)** endpoint. The frontend opens an `EventSource` connection here.

**Response headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

**Protocol:**
1. On connect: immediately emit the last 100 lines (one `data:` event per line).
2. Then: every ~1 second, check if `bot.log` has grown. If new bytes exist, emit each new line.
3. Continue indefinitely until the client disconnects.

**Event format:**
```
data: {"line": "2025-01-02 10:30:00 [INFO] scheduler — ..."}

data: {"line": "2025-01-02 10:30:01 [WARN] tenant_creator1 — ..."}

```

(Each event is `data: <json>\n\n`)

Frontend reconnects automatically every 5 seconds if the connection drops.

---

## 8. CORS Configuration

Must allow all origins, methods, and headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

For SSE (`/api/logs/stream`), also ensure no proxy buffering:
- `X-Accel-Buffering: no` (disables nginx buffering)
- `Cache-Control: no-cache`

---

## 9. Bot Process Management — Implementation Notes

### Starting
```bash
node main.js   # run from BOT_DIR, inheriting environment
```
Capture the PID. Store it in memory (not a file — restarts clear it).

### Stopping
Send SIGTERM, wait 5s, then SIGKILL.

### Status Detection (fallback)
If the stored PID is gone (server restarted), scan processes:
```bash
pgrep -f "node main.js"
```

---

## 10. Summary — All Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/stats` | Dashboard stats + config flags |
| GET | `/api/bot/status` | Bot running/stopped + PID |
| POST | `/api/bot/start` | Start bot process |
| POST | `/api/bot/stop` | Stop bot process |
| GET | `/api/tenants` | List all accounts |
| POST | `/api/tenants` | Create account |
| GET | `/api/tenants/{id}` | Get account |
| PUT | `/api/tenants/{id}` | Update account |
| DELETE | `/api/tenants/{id}` | Delete account |
| POST | `/api/tenants/{id}/enable` | Enable account |
| POST | `/api/tenants/{id}/disable` | Disable account |
| GET | `/api/tenants/{id}/chats` | Fetch OF chats (proxied) |
| GET | `/api/tenants/{id}/chats/{fan_id}/messages` | Fetch fan messages (proxied) |
| GET | `/api/blocked` | List all blocked fans |
| POST | `/api/tenants/{id}/block/{fan_id}` | Block a fan |
| DELETE | `/api/tenants/{id}/block/{fan_id}` | Unblock a fan |
| GET | `/api/drafts` | List pending drafts |
| POST | `/api/drafts/{id}/approve` | Approve + send draft |
| POST | `/api/drafts/{id}/reject` | Reject draft |
| PUT | `/api/drafts/{id}` | Update draft text |
| GET | `/api/logs` | Get last N log lines |
| GET | `/api/logs/stream` | SSE live log stream |

**Total: 23 endpoints**

---

## 11. Testing Checklist

Once implemented, verify each of the following:

- [ ] `GET /api/health` → `{"ok": true}`
- [ ] `GET /api/stats` → contains all 8 fields
- [ ] `POST /api/tenants` with valid body → creates tenant, returns safe object (no raw secrets)
- [ ] `PUT /api/tenants/{id}` with partial body → only updates provided fields
- [ ] `DELETE /api/tenants/{id}` → tenant gone from `GET /api/tenants`
- [ ] `POST /api/tenants/{id}/enable` then `GET /api/stats` → `active_tenants` increments
- [ ] `POST /api/tenants/{id}/block/{fan_id}` → fan appears in `GET /api/blocked`
- [ ] `POST /api/bot/start` → `status: started`, `GET /api/bot/status` → `status: running`
- [ ] `POST /api/bot/stop` → `status: stopped`
- [ ] `GET /api/logs` → `{ "lines": [...] }`
- [ ] `GET /api/logs/stream` with `curl -N` → streams `data: {...}` events continuously
- [ ] CORS: `OPTIONS /api/health` with `Origin: https://example.com` → 200 with CORS headers
- [ ] `GET /api/tenants/{id}/chats` without `OF_API_KEY` → 503 with `"OF_API_KEY not configured"`
