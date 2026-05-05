import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Play, Square, RefreshCw, Activity, Users, FileText,
  MessageSquare, Ban, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { api } from '../api';

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.22, delay: i * 0.06 } }),
};

function StatCard({ label, value, icon: Icon, accent, index }) {
  return (
    <motion.div custom={index} variants={fadeUp} initial="hidden" animate="show">
      <Card data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <CardContent className="p-5 flex items-center gap-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
            <p
              className="text-2xl font-semibold text-zinc-100 tabular-nums"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {value ?? '—'}
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Dashboard({ onStatsChange }) {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [botLoading, setBotLoading] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
      onStatsChange?.(s.pending_drafts || 0);
    } catch (e) {
      console.error(e);
    }
  }, [onStatsChange]);

  const loadLogs = useCallback(async () => {
    try {
      const { lines } = await api.getLogs(15);
      setLogs(lines.slice(-10));
    } catch {}
  }, []);

  useEffect(() => {
    loadStats();
    loadLogs();
    const id = setInterval(() => { loadStats(); loadLogs(); }, 20000);
    return () => clearInterval(id);
  }, [loadStats, loadLogs]);

  const handleBotToggle = async () => {
    setBotLoading(true);
    try {
      if (stats?.bot_status === 'running') {
        await api.stopBot();
        toast.success('Bot stopped');
      } else {
        await api.startBot();
        toast.success('Bot started');
      }
      await loadStats();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBotLoading(false);
    }
  };

  const running = stats?.bot_status === 'running';

  function logClass(line) {
    const l = line.toLowerCase();
    if (l.includes('[error]')) return 'log-error';
    if (l.includes('[warn]')) return 'log-warn';
    if (l.includes('[debug]')) return 'log-debug';
    return 'log-info';
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="show" className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-semibold text-zinc-100 tracking-tight"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            data-testid="dashboard-title"
          >
            Dashboard
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">Bot status and activity overview</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { loadStats(); loadLogs(); }} data-testid="refresh-button">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </motion.div>

      {/* Bot Status Card */}
      <motion.div variants={fadeUp} custom={1} initial="hidden" animate="show">
        <Card data-testid="bot-status-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${running ? 'bg-emerald-500/15 border border-emerald-400/20' : 'bg-zinc-700/30 border border-zinc-600/20'}`}>
                  <Activity className={`w-6 h-6 ${running ? 'text-emerald-400' : 'text-zinc-500'}`} />
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Bot Status</p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${running ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`}
                    />
                    <span
                      className="text-lg font-semibold"
                      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                      data-testid="bot-status-text"
                    >
                      {running ? 'Running' : 'Stopped'}
                    </span>
                    {stats?.bot_pid && (
                      <span className="text-xs text-zinc-500">PID {stats.bot_pid}</span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant={running ? 'danger' : 'success'}
                onClick={handleBotToggle}
                disabled={botLoading || !stats}
                data-testid="bot-toggle-button"
              >
                {botLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : running ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {running ? 'Stop Bot' : 'Start Bot'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard index={2} label="Active Accounts" value={stats?.active_tenants} icon={Users} accent="bg-blue-500/15 border border-blue-400/20 text-blue-400" />
        <StatCard index={3} label="Pending Drafts" value={stats?.pending_drafts} icon={FileText} accent="bg-amber-400/15 border border-amber-300/20 text-amber-400" />
        <StatCard index={4} label="Replied Today" value={stats?.replied_today} icon={MessageSquare} accent="bg-emerald-500/15 border border-emerald-400/20 text-emerald-400" />
        <StatCard index={5} label="Blocked Users" value={stats?.blocked_users} icon={Ban} accent="bg-red-500/15 border border-red-400/20 text-red-400" />
      </div>

      {/* Recent Logs */}
      <motion.div variants={fadeUp} custom={6} initial="hidden" animate="show">
        <Card data-testid="recent-logs-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Recent Logs</span>
              <span className="text-[10px] text-zinc-500 font-normal ml-1">last 10 lines</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-zinc-600 italic">No logs yet. Start the bot to see activity.</p>
            ) : (
              <div className="space-y-0.5 font-mono text-xs" data-testid="log-preview">
                {logs.map((line, i) => (
                  <div key={i} className={`${logClass(line)} leading-5 truncate`}>{line}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
