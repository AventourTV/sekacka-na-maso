import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Pencil, RefreshCw, FileText, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { api } from '../api';

function DraftCard({ draft, onApprove, onReject, loading }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.draft_reply);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card data-testid={`draft-card-${draft.id}`}>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-400">
                {draft.tenant_name || draft.tenant_id.slice(0, 8)}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-xs text-zinc-500 font-mono">Fan {draft.fan_user_id}</span>
            </div>
            <span className="text-[11px] text-zinc-600">{new Date(draft.created_at).toLocaleString()}</span>
          </div>

          {/* Fan message */}
          <div className="bg-[#111318] border border-white/5 rounded-lg p-3">
            <p className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Fan said</p>
            <p className="text-sm text-zinc-300 leading-6">{draft.fan_message_text}</p>
          </div>

          {/* AI reply */}
          <div className="bg-blue-500/5 border border-blue-400/15 rounded-lg p-3">
            <p className="text-[10px] text-blue-400 mb-1 uppercase tracking-wider">AI Draft</p>
            {editing ? (
              <Textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={3}
                className="text-sm"
                data-testid={`draft-edit-textarea-${draft.id}`}
              />
            ) : (
              <p className="text-sm text-zinc-200 leading-6">{draft.draft_reply}</p>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            {editing ? (
              <>
                <Button
                  variant="success"
                  size="sm"
                  disabled={loading}
                  onClick={() => { onApprove(draft.id, editText); setEditing(false); }}
                  data-testid={`draft-approve-edited-${draft.id}`}
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Send Edited
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { setEditing(false); setEditText(draft.draft_reply); }}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="success"
                  size="sm"
                  disabled={loading}
                  onClick={() => onApprove(draft.id, null)}
                  data-testid={`draft-approve-${draft.id}`}
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(true)}
                  data-testid={`draft-edit-${draft.id}`}
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={loading}
                  onClick={() => onReject(draft.id)}
                  data-testid={`draft-reject-${draft.id}`}
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Drafts({ onReview }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setDrafts(await api.getDrafts()); } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id, editedText) => {
    setActionLoading(true);
    try {
      const res = await api.approveDraft(id, editedText);
      if (res.sent) toast.success('Reply sent successfully');
      else toast.warning('Draft approved but sending failed — check OF_API_KEY');
      load();
      onReview?.();
    } catch (e) { toast.error(e.message); }
    finally { setActionLoading(false); }
  };

  const handleReject = async (id) => {
    setActionLoading(true);
    try {
      await api.rejectDraft(id);
      toast.success('Draft rejected');
      load();
      onReview?.();
    } catch (e) { toast.error(e.message); }
    finally { setActionLoading(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }} data-testid="drafts-title">
            Pending Drafts
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">Review and approve AI-generated replies before sending</p>
        </div>
        <div className="flex items-center gap-2">
          {drafts.length > 0 && (
            <Badge variant="warning" className="text-xs px-2 py-1" data-testid="drafts-count-badge">
              {drafts.length} pending
            </Badge>
          )}
          <Button variant="secondary" size="sm" onClick={load} data-testid="refresh-drafts-button">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading drafts...</p>
      ) : drafts.length === 0 ? (
        <Card>
          <CardContent className="p-16 text-center">
            <FileText className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">No pending drafts. Enable Human Review Mode on an account to start reviewing.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {drafts.map(d => (
            <DraftCard
              key={d.id}
              draft={d}
              onApprove={handleApprove}
              onReject={handleReject}
              loading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}
