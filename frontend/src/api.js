const BASE = process.env.REACT_APP_BACKEND_URL || '';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  getStats: () => req('GET', '/api/stats'),
  getBotStatus: () => req('GET', '/api/bot/status'),
  startBot: () => req('POST', '/api/bot/start'),
  stopBot: () => req('POST', '/api/bot/stop'),

  getTenants: () => req('GET', '/api/tenants'),
  createTenant: (data) => req('POST', '/api/tenants', data),
  getTenant: (id) => req('GET', `/api/tenants/${id}`),
  updateTenant: (id, data) => req('PUT', `/api/tenants/${id}`, data),
  deleteTenant: (id) => req('DELETE', `/api/tenants/${id}`),
  enableTenant: (id) => req('POST', `/api/tenants/${id}/enable`),
  disableTenant: (id) => req('POST', `/api/tenants/${id}/disable`),

  getChats: (tid) => req('GET', `/api/tenants/${tid}/chats`),
  getMessages: (tid, fanId) => req('GET', `/api/tenants/${tid}/chats/${fanId}/messages`),
  blockUser: (tid, fanId, fanName) =>
    req('POST', `/api/tenants/${tid}/block/${fanId}?fan_name=${encodeURIComponent(fanName || '')}`),
  unblockUser: (tid, fanId) => req('DELETE', `/api/tenants/${tid}/block/${fanId}`),

  getDrafts: (tenantId) =>
    req('GET', `/api/drafts${tenantId ? `?tenant_id=${tenantId}` : ''}`),
  approveDraft: (id, text) =>
    req('POST', `/api/drafts/${id}/approve`, text ? { draft_reply: text } : undefined),
  rejectDraft: (id) => req('POST', `/api/drafts/${id}/reject`),
  updateDraft: (id, text) => req('PUT', `/api/drafts/${id}`, { draft_reply: text }),

  getLogs: (n = 200) => req('GET', `/api/logs?n=${n}`),
};
