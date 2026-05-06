import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Terminal, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

const API_BASE = process.env.REACT_APP_BACKEND_URL || '';

function logLevel(line) {
  const l = line.toLowerCase();
  if (l.includes('[error]')) return 'error';
  if (l.includes('[warn]')) return 'warn';
  if (l.includes('[debug]')) return 'debug';
  return 'info';
}

function logCls(level) {
  return { error: 'log-error', warn: 'log-warn', debug: 'log-debug', info: 'log-info' }[level] || 'log-info';
}

const FILTERS = ['all', 'info', 'warn', 'error'];

export default function Logs() {
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('all');
  const bottomRef = useRef(null);
  const esRef = useRef(null);

  const connect = useCallback(() => {
    if (esRef.current) { esRef.current.close(); }
    const es = new EventSource(`${API_BASE}/api/logs/stream`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const { line } = JSON.parse(e.data);
        if (line) setLines(prev => [...prev.slice(-999), line]);
      } catch {}
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 5s
      setTimeout(connect, 5000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { esRef.current?.close(); };
  }, [connect]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const filtered = filter === 'all' ? lines : lines.filter(l => logLevel(l) === filter);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }} data-testid="logs-title">
            Live Logs
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">Real-time output from all bot processes</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={connected ? 'success' : 'stopped'}
            data-testid="log-connection-badge"
          >
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? 'Live' : 'Reconnecting...'}
          </Badge>
          <Button variant="secondary" size="sm" onClick={() => setLines([])} data-testid="clear-logs-button">
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            data-testid={`log-filter-${f}`}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors duration-150 ${
              filter === f
                ? 'bg-blue-500/20 text-blue-300 border border-blue-400/20'
                : 'bg-white/5 text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-600 self-center">{filtered.length} lines</span>
      </div>

      {/* Log pane */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card data-testid="log-pane">
          <CardContent className="p-0">
            <div className="bg-[#080a0c] rounded-xl font-mono text-xs leading-5 h-[520px] overflow-y-auto p-4 space-y-px" data-testid="log-lines-container">
              {filtered.length === 0 ? (
                <p className="text-zinc-600 italic">
                  {connected
                    ? 'Waiting for log output. Start the bot from the Dashboard.'
                    : 'Connecting to log stream...'}
                </p>
              ) : (
                filtered.map((line, i) => (
                  <div key={i} className={logCls(logLevel(line))}>{line}</div>
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
