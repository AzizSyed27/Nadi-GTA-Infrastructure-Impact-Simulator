'use client';

// V2.7a — "Ask this run": the report chat, relocated from the ReportPanel's tail to its own
// Explore sub-view (the chat is GraphRAG memory over the run corpus — an exploration tool,
// not part of the run document). Behavior, testids, and honesty copy carried verbatim; the
// duplicated local API_BASE collapsed onto lib/api's.

import { useState } from 'react';
import { API_BASE } from '@/lib/api';
import { DEMO_READONLY_NOTE, STATIC_DEMO } from '@/lib/demo';

const STARTERS = ['What would business owners object to?', 'Who is hit hardest?', 'Did the street get safer?'];

interface ChatMsg {
  role: 'user' | 'agent';
  text: string;
  sources?: string[];
  audit?: string;
  down?: boolean;
}

/**
 * Ask-the-report chat. Every answer is grounded in this run's corpus and passes the SAME honesty
 * audit the report obeys (server-side) — anticipation, never a verdict, no safety direction, no
 * vote tally. Answers are qualitative (numbers live in the run document). Degrades gracefully if
 * the agent server isn't running.
 */
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setMessages((m) => [...m, { role: 'agent', text: d.answer, sources: d.sources, audit: d.audit?.status }]);
    } catch {
      setMessages((m) => [...m, { role: 'agent', text: '', down: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={sheet}>
      <div style={inner} data-testid="chat-panel">
        <div style={kicker}>EXPLORE · ASK THIS RUN</div>
        <h2 style={h2}>Ask the report</h2>
        <div style={subtle}>
          Grounded in this run only — anticipation, never a verdict. Answers are qualitative; for exact
          figures, read the run document.
        </div>

        {messages.length === 0 && !STATIC_DEMO && (
          <div style={starterWrap}>
            {STARTERS.map((s) => (
              <button key={s} style={starterBtn} data-testid="chat-starter" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div style={chatLog}>
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} style={userMsg} data-testid="chat-message">
                {m.text}
              </div>
            ) : (
              <div key={i} style={agentMsg} data-testid="chat-message">
                {m.down ? (
                  <span style={{ color: '#b45309' }}>
                    Couldn&apos;t reach the report agent. Start it with{' '}
                    <code>uvicorn server:app --port 8000</code> (from <code>python/src</code>), then retry.
                  </span>
                ) : (
                  <>
                    <div>{m.text}</div>
                    {m.sources && m.sources.length > 0 && (
                      <div style={chatSources} data-testid="chat-sources">
                        drew on: {m.sources.slice(0, 6).join(' · ')}
                      </div>
                    )}
                  </>
                )}
              </div>
            ),
          )}
          {loading && <div style={{ ...agentMsg, color: '#9aa0a6' }}>…thinking</div>}
        </div>

        {STATIC_DEMO ? (
          // V2.5d demo: the chat needs the live agent — say so as a property, never a failure
          <div style={{ ...agentMsg, color: '#9aa0a6' }} data-testid="demo-readonly-note">
            {DEMO_READONLY_NOTE}
          </div>
        ) : (
          <form
            style={chatForm}
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              style={chatInput}
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this run — a group, the scorecard, the limits…"
            />
            <button style={chatSend} data-testid="chat-send" type="submit" disabled={loading}>
              Ask
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// The Explore sub-view sheet (occludes the map like Compare/Graphs; map chrome hides via sheetMode).
const sheet: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  top: 94, // header 54 + explore sub-nav 40
  overflowY: 'auto',
  background: 'rgba(246,247,249,0.98)',
  zIndex: 18,
  padding: '28px 0 48px',
};
const inner: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '0 24px',
  fontFamily: 'system-ui, sans-serif',
  color: '#1f2937',
};
const kicker: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.1em',
  color: '#8a9099',
  marginBottom: 6,
};
const h2: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 700,
  color: '#1f2937',
  margin: '0 0 4px',
};
const subtle: React.CSSProperties = { fontSize: 12, color: '#8a8a8a', fontStyle: 'italic', marginBottom: 4 };
const starterWrap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 4px' };
const starterBtn: React.CSSProperties = {
  border: '1px solid #d7dbe0',
  background: '#f7f9fc',
  borderRadius: 16,
  padding: '6px 12px',
  fontSize: 12.5,
  color: '#374151',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
};
const chatLog: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0' };
const userMsg: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '85%',
  background: '#e8f0fe',
  color: '#1f2937',
  borderRadius: '12px 12px 2px 12px',
  padding: '8px 12px',
  fontSize: 13.5,
};
const agentMsg: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '92%',
  background: '#f3f4f6',
  color: '#1f2937',
  borderRadius: '12px 12px 12px 2px',
  padding: '9px 13px',
  fontSize: 13.5,
  lineHeight: 1.5,
};
const chatSources: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: '#7c5aa8',
  borderTop: '1px solid #e4e0ee',
  paddingTop: 5,
};
const chatForm: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 4 };
const chatInput: React.CSSProperties = {
  flex: 1,
  border: '1px solid #d7dbe0',
  borderRadius: 8,
  padding: '9px 12px',
  fontSize: 13.5,
  fontFamily: 'system-ui, sans-serif',
  outline: 'none',
};
const chatSend: React.CSSProperties = {
  border: 'none',
  background: '#1f4e9c',
  color: '#fff',
  borderRadius: 8,
  padding: '0 18px',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
};
