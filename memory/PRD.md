# OFM Bot Control Dashboard

## Original Problem Statement
Build a Next.js/React UI to control an OnlyFans auto-reply bot script. Host frontend on Vercel.
The bot is a multi-tenant Node.js script using Claude AI.

## Architecture
- **Frontend**: React CRA (`/app/frontend`) → Vercel deployment
- **Backend**: FastAPI (`/app/backend`) → separate host (Railway/Render/VPS)
- **Bot**: Node.js scripts in `/app/` → same host as backend
- **DB**: SQLite at `/app/of_bot.db` (shared between bot and API)

## Core Requirements (Static)
1. Live log viewer with SSE streaming
2. Bot status indicators (running/stopped)
3. Start / Stop bot
4. Account (tenant) management: CRUD, enable/disable
5. Custom reply templates / system prompts per account
6. Reply delay & rate limit settings per account
7. Chat viewer — see what bot replied and what fans said
8. Block replies for specific users
9. Pending drafts review (approve / reject / edit) — human review mode

## What's Been Implemented (2026-02-xx)
### Backend (FastAPI)
- `/api/health` — health check
- `/api/stats` — bot status, active accounts, pending drafts, replied today, blocked users, config status
- `/api/bot/start` `/api/bot/stop` `/api/bot/status` — control Node.js bot process
- `/api/tenants` CRUD + enable/disable — full tenant management with AES-256-GCM crypto matching Node.js
- `/api/tenants/{tid}/chats` `/api/tenants/{tid}/chats/{fan_id}/messages` — OF API proxy
- `/api/tenants/{tid}/chats/{fan_id}/trigger-reply` **NEW** — manually trigger AI reply for a conversation
- `/api/tenants/{tid}/block/{fan_id}` `/api/tenants/{tid}/block/{fan_id}` — block/unblock fans
- `/api/drafts` GET + approve/reject/update — pending draft management
- `/api/logs` GET + `/api/logs/stream` SSE — log streaming

### Frontend (React)
- Dashboard — bot status card, stats grid, recent logs, start/stop button, config warnings
- Accounts — CRUD with modal form (all settings incl. system prompt, delays, review mode)
- Chats — tenant picker → chat list → conversation view → block/unblock + **"Send AI Reply" button** (trigger manual AI reply)
- Drafts — approve / edit / reject AI-generated replies
- Logs — SSE live stream, filter by level (all/info/warn/error), auto-scroll

### Bot Modifications
- `database.js` — added `isBlocked()` function + `blocked_users` table
- `scheduler.js` — checks `isBlocked()` before processing any chat

## Prioritized Backlog

### P0 (Blockers for production use)
- [ ] Set ENCRYPTION_KEY in backend/.env (32-byte hex)
- [ ] Set OF_API_KEY in backend/.env

### P1 (Important features)
- [ ] Pagination for chats list (OF API may return many)
- [ ] Search/filter chats by fan name
- [ ] Toast notification when new draft arrives

### P2 (Nice to have)
- [ ] Statistics charts (replies over time)
- [ ] Export chat history
- [ ] Mobile-responsive sidebar (hamburger menu)
- [ ] Dark/light theme toggle

## Next Tasks
1. Configure ENCRYPTION_KEY and OF_API_KEY in `/app/backend/.env`
2. Deploy frontend to Vercel (set REACT_APP_BACKEND_URL env var)
3. Deploy backend to Railway/Render or run on bot's host server
