'use client';

import { useState, type FormEvent } from 'react';

import type { Agent } from '@/lib/types';
import { agentId } from '@/lib/viz';
import { postInterview, type InterviewMsg } from '@/lib/api';
import { DEMO_READONLY_NOTE, STATIC_DEMO } from '@/lib/demo';

/**
 * V2.3b — the interview drawer: ask ONE of this run's voices a question, in character. Session-only:
 * the transcript lives in the parent's per-agent map and is never written anywhere. The client sends
 * IDS only (run_id + agentId) — the grounding is built server-side from the artifact, and the server's
 * honesty guard audits every answer (a failed audit renders the in-character refusal + a labeled note).
 */
export function InterviewDrawer({
  agent,
  agentIndex,
  runId,
  sessionKey,
  messages,
  onMessages,
  onClose,
}: {
  agent: Agent;
  /** The record's position in agents[] — disambiguates sibling inferred voices sharing a persona.id
   * (sent on the wire; -1 = unknown, the server falls back to the id scan). */
  agentIndex: number;
  runId: string;
  /** Parent's transcript-map key for THIS record (index-qualified — persona.id alone collides). */
  sessionKey: string;
  messages: InterviewMsg[];
  onMessages: (id: string, msgs: InterviewMsg[]) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kind = agent.grounding === 'mandate' ? 'mandate' : agent.grounding === 'inferred' ? 'inferred' : 'sim';
  const id = agentId(agent);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setErr(null);
    // the transcript sent is the PRIOR history — the question rides its own field (no duplication)
    const history = messages.map(({ role, text }) => ({ role, text }));
    const withUser = [...messages, { role: 'user' as const, text: q }];
    onMessages(sessionKey, withUser);
    setLoading(true);
    const res = await postInterview(runId, id, q, history, agentIndex);
    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
      return; // the user turn stays; the error renders labeled below the thread
    }
    onMessages(sessionKey, [...withUser, { role: 'agent', text: res.value.answer, audit: res.value.audit }]);
  };

  return (
    <div style={card} data-testid="interview-drawer">
      <button style={close} onClick={onClose} aria-label="Close interview">
        ×
      </button>
      <div style={kicker}>
        INTERVIEW ·{' '}
        {kind === 'mandate' ? 'institutional (mandate lens)' : kind === 'inferred' ? 'community voice' : 'simulated traveler'}
      </div>
      <div style={title}>{agent.persona.label}</div>
      <div style={grounding} data-testid="interview-grounding">
        {kind === 'mandate'
          ? "Answers are generated from this organization's published mandate and this run's computed facts — not from the organization itself."
          : kind === 'inferred'
            ? "This voice wasn't simulated directly — it speaks from what the scenario implies for someone like them."
            : "Answers come from this persona's own simulated trip in this run — anticipation, never a verdict."}
      </div>

      <div style={thread}>
        {messages.length === 0 && <div style={empty}>Ask what this change means for them — in their own words.</div>}
        {messages.map((m, i) => (
          <div key={i}>
            <div style={m.role === 'user' ? userMsg : agentMsg} data-testid="interview-msg">
              {m.text}
            </div>
            {m.role === 'agent' && m.audit?.status === 'failed' && (
              <div style={note} data-testid="interview-guard-note">
                the honesty guard stepped in — this voice can only speak to its own experience
              </div>
            )}
            {m.role === 'agent' && m.audit?.status === 'error' && (
              <div style={note} data-testid="interview-error-note">
                model unavailable — try again
              </div>
            )}
          </div>
        ))}
        {loading && <div style={{ ...agentMsg, color: '#9aa0a6' }}>…thinking</div>}
        {err && (
          <div style={errBox} data-testid="interview-error">
            {err}
          </div>
        )}
      </div>

      {STATIC_DEMO && (
        // V2.5d demo: interviews need the live model — a property of the demo, not a failure
        <div style={{ ...agentMsg, color: '#9aa0a6' }} data-testid="demo-readonly-note">
          {DEMO_READONLY_NOTE}
        </div>
      )}
      {!STATIC_DEMO && (
      <form style={form} onSubmit={send}>
        <input
          style={inputBox}
          data-testid="interview-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask this voice a question…"
          maxLength={500}
        />
        <button
          style={{ ...sendBtn, ...(loading || !input.trim() ? sendDisabled : null) }}
          data-testid="interview-send"
          disabled={loading || !input.trim()}
          title="One model call per question — a fraction of a cent (approx)."
        >
          {'Ask · <1¢'}
        </button>
      </form>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  padding: '14px 16px',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.97)',
  boxShadow: '0 4px 18px rgba(0,0,0,0.22)',
  pointerEvents: 'auto',
  fontFamily: 'system-ui, sans-serif',
};
const close: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 10,
  border: 'none',
  background: 'transparent',
  fontSize: 20,
  lineHeight: 1,
  color: '#999',
  cursor: 'pointer',
};
const kicker: React.CSSProperties = { fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#9aa0a6' };
const title: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#1f2937', margin: '2px 0 6px' };
const grounding: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.4,
  color: '#6b7280',
  background: '#f3f4f6',
  borderRadius: 8,
  padding: '6px 8px',
  marginBottom: 8,
};
const thread: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 220,
  overflowY: 'auto',
  marginBottom: 8,
};
const empty: React.CSSProperties = { fontSize: 12, color: '#9aa0a6', padding: '4px 2px' };
const userMsg: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '88%',
  background: '#e8f0fe',
  color: '#1f2937',
  borderRadius: 10,
  padding: '6px 9px',
  fontSize: 12.5,
  lineHeight: 1.4,
  marginLeft: 'auto',
};
const agentMsg: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '92%',
  background: '#f3f4f6',
  color: '#374151',
  borderRadius: 10,
  padding: '6px 9px',
  fontSize: 12.5,
  lineHeight: 1.4,
  fontStyle: 'italic',
};
const note: React.CSSProperties = { fontSize: 10.5, color: '#8a6d1a', padding: '2px 4px 0' };
const errBox: React.CSSProperties = { fontSize: 11, color: '#b3541e', padding: '4px 2px' };
const form: React.CSSProperties = { display: 'flex', gap: 6 };
const inputBox: React.CSSProperties = {
  flex: 1,
  border: '1px solid #d7dbe0',
  borderRadius: 8,
  padding: '7px 9px',
  fontSize: 12.5,
  outline: 'none',
};
const sendBtn: React.CSSProperties = {
  border: 'none',
  background: '#1f4e9c',
  color: '#fff',
  borderRadius: 8,
  padding: '7px 11px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const sendDisabled: React.CSSProperties = { opacity: 0.5, cursor: 'default' };
