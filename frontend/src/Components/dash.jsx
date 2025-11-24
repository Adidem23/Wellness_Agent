import { useEffect, useRef, useState } from 'react';
import './dash.css';
import axios from 'axios';

const SAMPLE_CHATS = [
  {
    id: '1',
    title: 'Project ideas',
    updatedAt: Date.now() - 1000 * 60 * 60,
    messages: [
      { id: 'm1', role: 'user', text: 'Give me 5 project ideas for a portfolio.', createdAt: Date.now() - 1000 * 60 * 60 },
      { id: 'm2', role: 'assistant', text: 'Sure — a real-time chat app, personal finance dashboard, and more.', createdAt: Date.now() - 1000 * 60 * 60 + 1000 },
    ],
  },
];

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Helper: make any message content renderable */
function formatText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // If the value is an object with a common text field
  if (typeof value === 'object') {
    if ('text' in value && (typeof value.text === 'string' || typeof value.text === 'number')) {
      return String(value.text);
    }
    // Some assistants produce an array of blocks/messages
    if (Array.isArray(value)) {
      try {
        return value.map(v => formatText(v)).join('\n');
      } catch (e) {
        return JSON.stringify(value);
      }
    }
    // Fallback: pretty JSON
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
    }
  }
  return String(value);
}

export default function ChatDashboard() {
  const [chats, setChats] = useState(() => {
    try {
      const raw = localStorage.getItem('cgpt_chats_v2');
      if (!raw) return SAMPLE_CHATS;
      const parsed = JSON.parse(raw);
      // normalize: ensure messages arrays exist and texts are strings
      return parsed.map(c => ({ ...c, messages: Array.isArray(c.messages) ? c.messages.map(m => ({ ...m, text: formatText(m.text) })) : [] }));
    } catch (e) {
      console.error("Failed to load chats from localStorage:", e);
      return SAMPLE_CHATS;
    }
  });

  const [selectedChatId, setSelectedChatId] = useState(() => (chats[0]?.id ?? null));
  const [query, setQuery] = useState('');
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('cgpt_chats_v2', JSON.stringify(chats));
    } catch (e) {
      console.warn('Could not save chats to localStorage', e);
    }
  }, [chats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedChatId, chats]);

  const selectedChat = chats.find(c => c.id === selectedChatId) ?? null;

  function createNewChat() {
    const id = uid('chat');
    const newChat = { id, title: 'New chat', updatedAt: Date.now(), messages: [] };
    setChats(s => [newChat, ...s]);
    setSelectedChatId(id);
  }

  function deleteChat(id) {
    setChats(prev => {
      const next = prev.filter(c => c.id !== id);
      setSelectedChatId(curr => (curr === id ? (next[0]?.id ?? null) : curr));
      return next;
    });
  }

  function resetChat(id) {
    setChats(prev => prev.map(c => c.id === id ? { ...c, messages: [], title: 'New chat', updatedAt: Date.now() } : c));
  }

  function renameChat(id) {
    const currentTitle = chats.find(c => c.id === id)?.title || '';
    const newTitle = window.prompt('Rename chat', currentTitle);
    if (newTitle === null) return;
    setChats(prev => prev.map(c => c.id === id ? { ...c, title: newTitle } : c));
  }

  // Start conversation when a chat is selected and has no messages
  useEffect(() => {
    if (!selectedChatId) return;
    const chat = chats.find(c => c.id === selectedChatId);
    if (!chat) return;
    if (Array.isArray(chat.messages) && chat.messages.length > 0) return;
    if (isStarting) return;
    startConversation(selectedChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatId]);

  async function startConversation(chatId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    setIsStarting(true);

    const placeholderId = uid('m');
    const placeholder = { id: placeholderId, role: 'assistant', text: '...', createdAt: Date.now() };
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...(c.messages || []), placeholder], updatedAt: Date.now() } : c));

    try {
      const res = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          Query_body: "", // empty to trigger agent starter message
          User_Name: "Aditya"
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const dataAPI = await res.json();

      // extract possible reply fields and format them
      const rawReply = dataAPI?.reply ?? dataAPI?.message ?? dataAPI?.text ?? dataAPI;
      const replyText = formatText(rawReply);

      // (optional) TTS playback - non-blocking
      (async () => {
        try {
          const url = 'https://global.api.murf.ai/v1/speech/stream';
          const data = {
            "voiceId": "en-US-matthew",
            "text": replyText,
            "multiNativeLocale": "en-US",
            "model": "FALCON",
            "format": "MP3",
            "sampleRate": 24000,
            "channelType": "MONO"
          };
          const config = {
            method: 'post',
            url: url,
            headers: {
              'Content-Type': 'application/json',
              'api-key': ''
            },
            data: data,
            responseType: 'arraybuffer'
          };
          const resp = await axios(config);
          const audioBlob = new Blob([resp.data], { type: "audio/mpeg" });
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          audio.play().catch(err => console.error("Playback failed:", err));
          audio.onended = () => URL.revokeObjectURL(audioUrl);
        } catch (err) {
          console.warn("TTS failed (non-fatal):", err);
        }
      })();

      // replace placeholder with rendered string reply
      setChats(prev => prev.map(c => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          messages: (c.messages || []).map(m => m.id === placeholderId ? { ...m, text: replyText, createdAt: Date.now() } : m),
          updatedAt: Date.now(),
        };
      }));
    } catch (err) {
      console.error('startConversation error', err);
      setChats(prev => prev.map(c => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          messages: (c.messages || []).map(m => m.id === placeholderId ? { ...m, text: 'Error: failed to get response from API.' } : m),
          updatedAt: Date.now(),
        };
      }));
    } finally {
      setIsStarting(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || !selectedChatId) return;

    const msg = { id: uid('m'), role: 'user', text: input.trim(), createdAt: Date.now() };
    setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, messages: [...(c.messages || []), msg], updatedAt: Date.now() } : c));
    setInput('');

    const placeholderId = uid('m');
    const placeholder = { id: placeholderId, role: 'assistant', text: '...', createdAt: Date.now() };
    setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, messages: [...(c.messages || []), placeholder], updatedAt: Date.now() } : c));

    try {
      const res = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          Query_body: msg.text,
          User_Name: "Aditya"
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const dataAPI = await res.json();

      const rawReply = dataAPI?.reply ?? dataAPI?.message ?? dataAPI?.text ?? dataAPI;
      const replyText = formatText(rawReply);

      // optional TTS - non-blocking
      (async () => {
        try {
          const url = 'https://global.api.murf.ai/v1/speech/stream';
          const data = {
            "voiceId": "en-US-matthew",
            "text": replyText,
            "multiNativeLocale": "en-US",
            "model": "FALCON",
            "format": "MP3",
            "sampleRate": 24000,
            "channelType": "MONO"
          };
          const config = {
            method: 'post',
            url: url,
            headers: {
              'Content-Type': 'application/json',
              'api-key': ''
            },
            data: data,
            responseType: 'arraybuffer'
          };
          const resp = await axios(config);
          const audioBlob = new Blob([resp.data], { type: "audio/mpeg" });
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          audio.play().catch(err => console.error("Playback failed:", err));
          audio.onended = () => URL.revokeObjectURL(audioUrl);
        } catch (err) {
          console.warn("TTS failed (non-fatal):", err);
        }
      })();

      setChats(prev => prev.map(c => {
        if (c.id !== selectedChatId) return c;
        return {
          ...c,
          messages: (c.messages || []).map(m => m.id === placeholderId ? { ...m, text: replyText, createdAt: Date.now() } : m),
          updatedAt: Date.now(),
        };
      }));
    } catch (err) {
      console.error('sendMessage error', err);
      setChats(prev => prev.map(c => {
        if (c.id !== selectedChatId) return c;
        return {
          ...c,
          messages: (c.messages || []).map(m => m.id === placeholderId ? { ...m, text: 'Error: failed to get response from API.' } : m),
          updatedAt: Date.now(),
        };
      }));
    }
  }

  const filteredChats = chats.filter(c => {
    const titleOk = (c.title || '').toLowerCase().includes(query.toLowerCase());
    const messagesOk = (c.messages || []).some(m => (formatText(m.text) || '').toLowerCase().includes(query.toLowerCase()));
    return titleOk || messagesOk;
  });

  return (
    <div className="cd-root">
      <aside className="cd-sidebar">
        <div className="cd-side-header">
          <div className="cd-title">Chat</div>
          <button className="cd-btn" onClick={createNewChat}>New</button>
        </div>

        <div className="cd-search">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" />
        </div>

        <div className="cd-list">
          {filteredChats.map(chat => (
            <div key={chat.id} className={`cd-chat-item ${chat.id === selectedChatId ? 'active' : ''}`} onClick={() => setSelectedChatId(chat.id)}>
              <div className="cd-avatar">💬</div>
              <div className="cd-chat-main">
                <div className="cd-chat-title">{chat.title}</div>
                <div className="cd-chat-snippet">{(chat.messages && chat.messages.length > 0) ? (formatText(chat.messages[chat.messages.length - 1]?.text) || 'No messages yet') : 'No messages yet'}</div>
              </div>
              <div className="cd-chat-actions">
                <button className="cd-small" onClick={e => { e.stopPropagation(); resetChat(chat.id); }}>Reset</button>
                <button className="cd-small cd-danger" onClick={e => { e.stopPropagation(); deleteChat(chat.id); }}>Delete</button>
              </div>
            </div>
          ))}
        </div>

        <div className="cd-side-footer">Local demo</div>
      </aside>

      <main className="cd-main">
        <header className="cd-main-header">
          <div>
            <h2 className="cd-main-title">{selectedChat?.title ?? 'No chat selected'}</h2>
            <div className="cd-main-sub">{selectedChat ? `${(selectedChat.messages || []).length} messages` : 'Select or create a chat'}</div>
          </div>
          <div className="cd-main-controls">
            {selectedChat && (
              <>
                <button className="cd-btn" onClick={() => renameChat(selectedChat.id)}>Rename</button>
                <button className="cd-btn" onClick={() => resetChat(selectedChat.id)}>Reset</button>
                <button className="cd-btn cd-danger" onClick={() => deleteChat(selectedChat.id)}>Delete</button>
              </>
            )}
          </div>
        </header>

        <div className="cd-conversation">
          {!selectedChat && <div className="cd-empty">Select or create a chat.</div>}

          {selectedChat && (
            <div className="cd-messages">
              {(selectedChat.messages || []).map(msg => (
                <div key={msg.id} className={`cd-message ${msg.role}`}>
                  <div className="cd-message-bubble">
                    <div className="cd-message-text">
                      {/* render safely */}
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{formatText(msg.text)}</pre>
                    </div>
                    <div className="cd-message-time">{new Date(msg.createdAt || Date.now()).toLocaleString()}</div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="cd-composer">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMessage(); }} placeholder="Type message — Ctrl/Cmd+Enter to send"></textarea>

          <div className="cd-composer-actions">
            <button className="cd-btn" onClick={sendMessage}>Send</button>
            <button className="cd-btn" onClick={() => setInput('')}>Clear</button>
          </div>
        </div>
      </main>
    </div>
  );
}
