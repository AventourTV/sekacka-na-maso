import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { MessageSquare, Ban, CheckCircle, User, RefreshCw, ChevronLeft, Bot, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { api } from '../api';

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

function isFromFan(msg, fanId) {
  if (msg.is_from_me === false) return true;
  if (msg.fromUser === true) return true;
  if (msg.fromUser && typeof msg.fromUser === 'object' && fanId) {
    return String(msg.fromUser.id) === String(fanId);
  }
  return false;
}

export default function Chats() {
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);

  useEffect(() => {
    api.getTenants().then(setTenants).catch(() => {});
  }, []);

  const loadChats = useCallback(async (tid) => {
    setLoadingChats(true);
    setChats([]);
    setSelectedChat(null);
    setMessages([]);
    try {
      const { chats: c } = await api.getChats(tid);
      setChats(c);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoadingChats(false);
    }
  }, []);

  const loadMessages = useCallback(async (tid, fanId) => {
    setLoadingMsgs(true);
    try {
      const { messages: m } = await api.getMessages(tid, fanId);
      setMessages(m);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  const handleSelectTenant = (t) => {
    setSelectedTenant(t);
    loadChats(t.id);
  };

  const handleSelectChat = (chat) => {
    setSelectedChat(chat);
    const fanId = String(chat?.fan?.id || '');
    if (fanId) loadMessages(selectedTenant.id, fanId);
  };

  const handleTriggerReply = async () => {
    if (!selectedTenant || !fanId) return;
    setTriggerLoading(true);
    try {
      const result = await api.triggerReply(selectedTenant.id, fanId);
      toast.success('AI reply sent successfully');
      // Refresh messages to show the sent reply
      await loadMessages(selectedTenant.id, fanId);
    } catch (e) {
      toast.error(`Failed to send AI reply: ${e.message}`);
    } finally {
      setTriggerLoading(false);
    }
  };

  const handleBlock = async (chat) => {
    if (!selectedTenant) return;
    const fanId = String(chat?.fan?.id || '');
    const fanName = chat?.fan?.name || chat?.fan?.username || fanId;
    setBlockLoading(true);
    try {
      if (chat._blocked) {
        await api.unblockUser(selectedTenant.id, fanId);
        toast.success(`${fanName} unblocked`);
      } else {
        await api.blockUser(selectedTenant.id, fanId, fanName);
        toast.success(`${fanName} blocked — bot will skip replies`);
      }
      await loadChats(selectedTenant.id);
      // Update selected chat blocked state
      setSelectedChat(prev => prev ? { ...prev, _blocked: !prev._blocked } : prev);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBlockLoading(false);
    }
  };

  const fanId = String(selectedChat?.fan?.id || '');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }} data-testid="chats-title">
          Chats
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">View conversations and manage reply blocking</p>
      </div>

      {/* Tenant selector */}
      {!selectedTenant ? (
        <div>
          <p className="text-sm text-zinc-500 mb-3">Select an account to view chats:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tenants.map(t => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card
                  className="cursor-pointer hover:border-white/10 transition-colors duration-150"
                  onClick={() => handleSelectTenant(t)}
                  data-testid={`tenant-select-${t.name}`}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-400/20 flex items-center justify-center">
                      <User className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{t.name}</p>
                      <p className="text-xs text-zinc-500">{t.of_user_id}</p>
                    </div>
                    <Badge variant={t.enabled ? 'success' : 'stopped'} className="ml-auto">
                      {t.enabled ? 'Active' : 'Off'}
                    </Badge>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Back + account label */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedTenant(null); setChats([]); setSelectedChat(null); }} data-testid="back-to-accounts-button">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            <span className="text-sm text-zinc-400">Account: <span className="text-zinc-200 font-medium">{selectedTenant.name}</span></span>
            <Button variant="secondary" size="sm" onClick={() => loadChats(selectedTenant.id)} data-testid="refresh-chats-button">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
            {/* Chat list */}
            <Card data-testid="chat-list-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {loadingChats ? 'Loading chats...' : `${chats.length} conversations`}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingChats ? (
                  <div className="p-4 text-sm text-zinc-500">Fetching chats from OnlyFans...</div>
                ) : chats.length === 0 ? (
                  <div className="p-4 text-sm text-zinc-500">No chats found.</div>
                ) : (
                  <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
                    {chats.map(chat => {
                      const fan = chat.fan || {};
                      const name = fan.name || fan.username || fan.id || 'Unknown';
                      const unread = chat.unreadMessagesCount || chat.unread_count || 0;
                      const lastMsg = stripHtml(
                        (chat.lastMessage || chat.last_message)?.text || ''
                      ).slice(0, 50);
                      const isSelected = selectedChat?.fan?.id === fan.id;
                      return (
                        <div
                          key={fan.id}
                          className={`px-4 py-3 cursor-pointer transition-colors duration-150 ${isSelected ? 'bg-white/5' : 'hover:bg-white/3'}`}
                          onClick={() => handleSelectChat(chat)}
                          data-testid={`chat-item-${fan.id}`}
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium text-zinc-200 truncate flex-1">{name}</span>
                            {chat._blocked && <Badge variant="blocked" className="text-[9px]">blocked</Badge>}
                            {unread > 0 && (
                              <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">{unread}</span>
                            )}
                          </div>
                          {lastMsg && <p className="text-xs text-zinc-500 truncate">{lastMsg}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Conversation panel */}
            {selectedChat ? (
              <Card data-testid="conversation-panel">
                <CardHeader className="pb-3 border-b border-white/5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-400/20 flex items-center justify-center">
                        <User className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-200">
                          {selectedChat?.fan?.name || selectedChat?.fan?.username || fanId}
                        </p>
                        <p className="text-xs text-zinc-500">ID: {fanId}</p>
                      </div>
                      {selectedChat._blocked && <Badge variant="blocked">Blocked</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => loadMessages(selectedTenant.id, fanId)}
                        data-testid="refresh-messages-button"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleTriggerReply}
                        disabled={triggerLoading || selectedChat._blocked}
                        data-testid="trigger-ai-reply-button"
                        title={selectedChat._blocked ? 'Fan is blocked — unblock first' : 'Generate and send an AI reply now'}
                      >
                        {triggerLoading ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</>
                        ) : (
                          <><Bot className="w-3.5 h-3.5" /> Send AI Reply</>
                        )}
                      </Button>
                      <Button
                        variant={selectedChat._blocked ? 'success' : 'danger'}
                        size="sm"
                        onClick={() => handleBlock(selectedChat)}
                        disabled={blockLoading}
                        data-testid="block-user-button"
                      >
                        {selectedChat._blocked ? (
                          <><CheckCircle className="w-3.5 h-3.5" /> Unblock</>
                        ) : (
                          <><Ban className="w-3.5 h-3.5" /> Block Replies</>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  {loadingMsgs ? (
                    <p className="text-sm text-zinc-500">Loading messages...</p>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-zinc-500 italic">No messages to display.</p>
                  ) : (
                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                      {messages.map((msg, i) => {
                        const fromFan = isFromFan(msg, fanId);
                        const text = stripHtml(msg.text || '');
                        if (!text) return null;
                        return (
                          <div key={msg.id || i} className={`flex ${fromFan ? 'justify-start' : 'justify-end'}`}>
                            <div
                              className={`max-w-[75%] px-3 py-2 rounded-xl text-sm leading-6 ${
                                fromFan
                                  ? 'bg-[#111318] border border-white/5 text-zinc-300'
                                  : 'bg-blue-500/20 border border-blue-400/20 text-blue-100'
                              }`}
                              data-testid={`message-bubble-${i}`}
                            >
                              {text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                  <MessageSquare className="w-10 h-10 text-zinc-700 mb-3" />
                  <p className="text-sm text-zinc-500">Select a conversation to view messages</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
