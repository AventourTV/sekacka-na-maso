import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, MessageSquare, FileText, Terminal, Bot,
} from 'lucide-react';

const NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/accounts', label: 'Accounts', icon: Users },
  { path: '/chats', label: 'Chats', icon: MessageSquare },
  { path: '/drafts', label: 'Drafts', icon: FileText },
  { path: '/logs', label: 'Logs', icon: Terminal },
];

export function Layout({ children, pendingDrafts = 0 }) {
  return (
    <div className="min-h-screen flex bg-[#0a0a0a] text-zinc-200">
      {/* Sidebar */}
      <aside
        className="w-60 shrink-0 bg-[#0b0d10] border-r border-white/5 flex flex-col h-screen sticky top-0"
        data-testid="sidebar"
      >
        {/* Brand */}
        <div className="h-16 border-b border-white/5 flex items-center gap-2.5 px-5">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
            <Bot className="w-4 h-4 text-blue-400" />
          </div>
          <span
            className="font-semibold text-zinc-100 tracking-tight text-sm"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            OFM Control
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5">
          {NAV.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              data-testid={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                  isActive
                    ? 'bg-white/5 text-white border border-white/10'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
              {label === 'Drafts' && pendingDrafts > 0 && (
                <span className="ml-auto bg-blue-500/20 text-blue-300 text-[10px] px-1.5 py-0.5 rounded-full border border-blue-400/20 font-semibold">
                  {pendingDrafts}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-white/5">
          <p className="text-[11px] text-zinc-600">v1.0 · Multi-tenant</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-screen overflow-auto">{children}</main>
    </div>
  );
}
