import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Power, PowerOff, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '../components/ui/dialog';
import { api } from '../api';

const DEFAULT_FORM = {
  name: '', of_user_id: '',
  anthropic_api_key: '', claude_model: 'claude-sonnet-4-6',
  system_prompt: 'You are a warm, flirtatious content creator chatting with a fan on OnlyFans. Keep replies short (1–3 sentences), personal, and engaging. Never break character or reveal you are an AI.',
  poll_interval_seconds: 15,
  reply_delay_min_seconds: 30,
  reply_delay_max_seconds: 120,
  history_limit: 10,
  human_review_mode: false,
};

const MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-5'];

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

function TenantForm({ initial, onSave, onClose, loading }) {
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...initial });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form
      onSubmit={e => { e.preventDefault(); onSave(form); }}
      className="space-y-4 max-h-[70vh] overflow-y-auto px-[3px]"
      data-testid="tenant-form"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account Name *">
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. creator1" required data-testid="tenant-name-input" />
        </Field>
        <Field label="OF User ID *">
          <Input value={form.of_user_id} onChange={e => set('of_user_id', e.target.value)} placeholder="acct_..." required data-testid="tenant-of-user-id-input" />
        </Field>
      </div>

      <Field label="Anthropic API Key (optional — uses shared if blank)">
        <Input type="password" value={form.anthropic_api_key} onChange={e => set('anthropic_api_key', e.target.value)} placeholder="sk-ant-..." data-testid="tenant-anthropic-key-input" />
      </Field>

      <Field label="AI Model">
        <select
          value={form.claude_model}
          onChange={e => set('claude_model', e.target.value)}
          className="h-10 w-full rounded-md bg-[#0b0d10] border border-white/10 px-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
          data-testid="tenant-model-select"
        >
          {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>

      <Field label="System Prompt (AI persona)">
        <Textarea
          rows={4}
          value={form.system_prompt}
          onChange={e => set('system_prompt', e.target.value)}
          placeholder="You are..."
          data-testid="tenant-system-prompt-input"
        />
      </Field>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
      >
        {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Advanced settings
      </button>

      {showAdvanced && (
        <div className="space-y-3 p-4 bg-[#111318] rounded-lg border border-white/5">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Poll interval (s)">
              <Input type="number" min={5} value={form.poll_interval_seconds} onChange={e => set('poll_interval_seconds', +e.target.value)} data-testid="tenant-poll-input" />
            </Field>
            <Field label="Delay min (s)">
              <Input type="number" min={0} value={form.reply_delay_min_seconds} onChange={e => set('reply_delay_min_seconds', +e.target.value)} data-testid="tenant-delay-min-input" />
            </Field>
            <Field label="Delay max (s)">
              <Input type="number" min={0} value={form.reply_delay_max_seconds} onChange={e => set('reply_delay_max_seconds', +e.target.value)} data-testid="tenant-delay-max-input" />
            </Field>
          </div>
          <Field label="Message history limit">
            <Input type="number" min={1} max={50} value={form.history_limit} onChange={e => set('history_limit', +e.target.value)} data-testid="tenant-history-input" />
          </Field>
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm text-zinc-300">Human Review Mode</p>
              <p className="text-xs text-zinc-500">Queue AI replies for manual approval before sending</p>
            </div>
            <Switch
              checked={form.human_review_mode}
              onCheckedChange={v => set('human_review_mode', v)}
              data-testid="tenant-human-review-switch"
            />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={loading} className="flex-1" data-testid="tenant-save-button">
          {loading ? 'Saving...' : 'Save Account'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} data-testid="tenant-cancel-button">
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function Accounts() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [editTenant, setEditTenant] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTenants(await api.getTenants()); } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    setFormLoading(true);
    try {
      await api.createTenant(form);
      toast.success('Account created');
      setShowAdd(false);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setFormLoading(false); }
  };

  const handleUpdate = async (form) => {
    setFormLoading(true);
    try {
      await api.updateTenant(editTenant.id, form);
      toast.success('Account updated');
      setEditTenant(null);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setFormLoading(false); }
  };

  const handleToggle = async (t) => {
    try {
      if (t.enabled) { await api.disableTenant(t.id); toast.success(`${t.name} disabled`); }
      else { await api.enableTenant(t.id); toast.success(`${t.name} enabled`); }
      load();
    } catch (e) { toast.error(e.message); }
  };

  const handleDelete = async () => {
    try {
      await api.deleteTenant(deleteId);
      toast.success('Account deleted');
      setDeleteId(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }} data-testid="accounts-title">
            Accounts
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">Manage OnlyFans accounts and their AI settings</p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button data-testid="add-account-button"><Plus className="w-4 h-4" /> Add Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Account</DialogTitle></DialogHeader>
            <TenantForm onSave={handleCreate} onClose={() => setShowAdd(false)} loading={formLoading} />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading accounts...</p>
      ) : tenants.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">No accounts yet. Add your first OnlyFans account.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tenants.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04 }}
            >
              <Card data-testid={`tenant-card-${t.name}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-zinc-100 text-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                          {t.name}
                        </span>
                        <Badge variant={t.enabled ? 'success' : 'stopped'} data-testid={`tenant-status-badge-${t.name}`}>
                          {t.enabled ? 'Active' : 'Disabled'}
                        </Badge>
                        {t.human_review_mode && <Badge variant="warning">Review Mode</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                        <span>OF ID: <span className="text-zinc-400 font-mono">{t.of_user_id}</span></span>
                        <span>Model: <span className="text-zinc-400">{t.claude_model}</span></span>
                        <span>Poll: <span className="text-zinc-400">{t.poll_interval_seconds}s</span></span>
                        <span>Delay: <span className="text-zinc-400">{t.reply_delay_min_seconds}–{t.reply_delay_max_seconds}s</span></span>
                        <span>Cookie: <Badge variant={t.has_cookie ? 'success' : 'danger'} className="text-[9px]">{t.has_cookie ? 'set' : 'missing'}</Badge></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={t.enabled ? 'warning' : 'success'}
                        size="sm"
                        onClick={() => handleToggle(t)}
                        data-testid={`tenant-toggle-button-${t.name}`}
                      >
                        {t.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                        {t.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Dialog open={editTenant?.id === t.id} onOpenChange={open => !open && setEditTenant(null)}>
                        <DialogTrigger asChild>
                          <Button variant="secondary" size="sm" onClick={() => setEditTenant(t)} data-testid={`tenant-edit-button-${t.name}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Edit {t.name}</DialogTitle></DialogHeader>
                          <TenantForm
                            initial={{ ...t, anthropic_api_key: '' }}
                            onSave={handleUpdate}
                            onClose={() => setEditTenant(null)}
                            loading={formLoading}
                          />
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteId(t.id)}
                        data-testid={`tenant-delete-button-${t.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Account?</DialogTitle></DialogHeader>
          <p className="text-sm text-zinc-400 mb-5">This will permanently remove the account and all its data.</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={handleDelete} className="flex-1" data-testid="confirm-delete-button">Delete</Button>
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
