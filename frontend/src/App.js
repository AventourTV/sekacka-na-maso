import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';
import { Layout } from './components/Layout';
import { Toaster } from './components/ui/sonner';
import { api } from './api';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Chats from './pages/Chats';
import Drafts from './pages/Drafts';
import Logs from './pages/Logs';

export default function App() {
  const [pendingDrafts, setPendingDrafts] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const s = await api.getStats();
        setPendingDrafts(s.pending_drafts || 0);
      } catch {}
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <BrowserRouter>
      <Toaster />
      <Layout pendingDrafts={pendingDrafts}>
        <Routes>
          <Route path="/" element={<Dashboard onStatsChange={setPendingDrafts} />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/drafts" element={<Drafts onReview={() =>
            api.getStats().then(s => setPendingDrafts(s.pending_drafts || 0)).catch(() => {})
          } />} />
          <Route path="/logs" element={<Logs />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
