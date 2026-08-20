'use client';

import { useMemo, useState, type FormEvent } from 'react';

import type { Agent, Grounding } from '@/lib/types';
import type { GroupTurnWire } from '@/lib/api';
import { GROUNDING_SENTENCES } from '@/components/InterviewDrawer';
import { modeIcon, groupOfAgent, INSTITUTION_GROUP } from '@/lib/personaGroups';
import { DEMO_READONLY_NOTE, STATIC_DEMO } from '@/lib/demo';

/**
 * V2.6b — the group-interview ROOM drawer: 3-5 of this run's voices answer one question in turn,
 * each hearing the others' actual words. Session-only like the single drawer: the shared transcript
 * lives in MapView state and is never written anywhere. The client sends IDS only (agent_refs with
 * the artifact index resolved ONCE at add time); each speaker's grounding is built server-side and
 * every answer passes the room guard (a failed audit renders that speaker's in-character refusal).
 * NO group-summary surface exists here by design (D3): the transcript IS the artifact — nothing
 * counts, averages, or characterizes the room's views.
 */

/** A room participant: the artifact's own agent object + its agents[] index (resolved at add). */
export interface RoomPair {
  agent: Agent;
  index: number;
}

/** A shared-room thread message. Wire halves (agentId/agentIndex) ride back on the transcript;
 * speakerLabel/grounding are DISPLAY-only (from the response — never sent back). */
export interface RoomMsg {
  role: 'user' | 'agent';
  text: string;
  agentId?: string;
  agentIndex?: number;
  speakerLabel?: string;
  grounding?: Grounding;
  audit?: { status?: string; calls?: number };
}

/** The in-flight round machine — everything a Retry needs to resume from speaker `speak`. */
export interface RoomRound {
  question: string;
  pairs: RoomPair[]; // SNAPSHOT at Ask time — mid-round roster edits can't shift refs
  speak: number;
  transcript: GroupTurnWire[]; // the wire prefix for the CURRENT speaker
  llmCalls: number;
  status: 'thinking' | 'error';
  error?: string;
}

function kindOf(agent: Agent): 'sim' | 'inferred' | 'mandate' {
  return agent.grounding === 'mandate' ? 'mandate' : agent.grounding === 'inferred' ? 'inferred' : 'sim';
}

function iconOf(agent: Agent): string {
  // modeIcon alone renders 💬 for institution ids (PERSONA_MODE has no tfs) — match the feed's 🏛️
  return groupOfAgent(agent) === INSTITUTION_GROUP ? '🏛️' : modeIcon(agent.persona.id);
}

export function RoomDrawer({
  pairs,
  messages,
  round,
  lastRoundCalls,
  busy,
  onAsk,
  onRetry,
  onDismissRound,
  onRemove,
  onClose,
}: {
  pairs: RoomPair[];
  messages: RoomMsg[];
  round: RoomRound | null;
  lastRoundCalls: number | null;
  busy: boolean;
  onAsk: (question: string) => void;
  onRetry: () => void;
  onDismissRound: () => void;
  onRemove: (index: number) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const n = pairs.length;

  // Display labels: sibling voices share one persona label — suffix "(a)"/"(b)" so a human can
  // tell the rows apart. UI-ONLY: the wire and the model prompt carry refs, never these labels
  // (the prompt-side ambiguity is a recorded BACKLOG deferral).
  const labelByIndex = useMemo(() => {
    const byLabel = new Map<string, RoomPair[]>();
    for (const p of pairs) {
      const l = p.agent.persona.label;
      byLabel.set(l, [...(byLabel.get(l) ?? []), p]);
    }
    const out = new Map<number, string>();
    for (const [label, group] of byLabel) {
      group.forEach((p, i) => {
        out.set(p.index, group.length > 1 ? `${label} (${String.fromCharCode(97 + i)})` : label);
      });
    }
    return out;
  }, [pairs]);

  const speakerLine = (index: number | undefined, fallback: string | undefined, icon: string) => (
    <div style={speaker} data-testid="room-speaker">
      <span style={speakerIcon}>{icon}</span>
      {(index != null ? labelByIndex.get(index) : undefined) ?? fallback ?? 'Another participant'}
    </div>
  );

  const currentPair = round ? round.pairs[round.speak] : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || round != null || n < 3) return;
    setInput('');
    onAsk(q);
  };

  return (
    <div style={card} data-testid="room-drawer">
      <button style={close} onClick={onClose} aria-label="Close conversation">
        ×
      </button>
      <div style={kicker}>GROUP INTERVIEW · {n} voice{n === 1 ? '' : 's'}</div>
      {/* D3, reader-facing (review catch): the room is the surface most likely to be misread as a
          "verdict panel" — say out loud that the roster is the USER'S pick, not a sample. */}
      <div style={curation} data-testid="room-note">
        voices you picked, answering one at a time — a conversation preview, not a poll or a sample
        of opinion
      </div>

      <div style={memberList}>
        {pairs.map((p) => (
          <div key={p.index} style={member} data-testid={`room-member-${p.index}`}>
            <div style={memberHead}>
              <span style={speakerIcon}>{iconOf(p.agent)}</span>
              <span style={memberLabel}>{labelByIndex.get(p.index)}</span>
              <button
                style={removeBtn}
                data-testid={`room-remove-${p.index}`}
                onClick={() => onRemove(p.index)}
                disabled={busy}
                aria-label={`Remove ${p.agent.persona.label} from the conversation`}
              >
                ✕
              </button>
            </div>
            <div style={memberGrounding} data-testid="room-grounding">
              {GROUNDING_SENTENCES[kindOf(p.agent)]}
            </div>
          </div>
        ))}
      </div>

      {n < 3 && (
        <div style={blocker} data-testid="room-blocker">
          a room needs at least 3 voices — for one voice, use 🎤 Interview
        </div>
      )}
      {n === 5 && (
        <div style={capNote} data-testid="room-cap-note">
          room capped at 5 voices — each answer is a separate guarded model call
        </div>
      )}

      <div style={thread}>
        {messages.length === 0 && !round && (
          <div style={empty}>Ask the room a question — each voice answers in turn, hearing the others.</div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === 'agent' &&
              speakerLine(m.agentIndex, m.speakerLabel, m.grounding === 'mandate' ? '🏛️' : iconFor(pairs, m))}
            <div style={m.role === 'user' ? userMsg : agentMsg} data-testid="room-msg">
              {m.text}
            </div>
            {m.role === 'agent' && m.audit?.status === 'failed' && (
              <div style={note} data-testid="room-guard-note">
                the honesty guard stepped in — this voice can only speak to its own experience
              </div>
            )}
            {m.role === 'agent' && m.audit?.status === 'error' && (
              <div style={note} data-testid="room-error-note">
                model unavailable — try again
              </div>
            )}
          </div>
        ))}
        {round?.status === 'thinking' && currentPair && (
          <div data-testid="room-thinking">
            {speakerLine(currentPair.index, currentPair.agent.persona.label, iconOf(currentPair.agent))}
            <div style={{ ...agentMsg, color: '#9aa0a6' }}>…thinking</div>
          </div>
        )}
        {round?.status === 'error' && currentPair && (
          <div>
            {speakerLine(currentPair.index, currentPair.agent.persona.label, iconOf(currentPair.agent))}
            <div style={errBox} data-testid="room-error">
              {round.error}
            </div>
            <div style={retryRow}>
              <button style={retryBtn} data-testid="room-retry" onClick={onRetry}>
                Retry
              </button>
              <button style={dismissBtn} data-testid="room-dismiss" onClick={onDismissRound}>
                skip the rest of this round
              </button>
            </div>
          </div>
        )}
      </div>

      {lastRoundCalls != null && !round && (
        <div
          style={callsLine}
          data-testid="room-calls"
          title="counted from completed responses — a request that failed in transit may have spent more server-side"
        >
          this round: {lastRoundCalls} model call{lastRoundCalls === 1 ? '' : 's'}
        </div>
      )}

      {STATIC_DEMO && (
        // V2.5d demo convention: the live model isn't here — a property of the demo, not a failure
        <div style={{ ...agentMsg, color: '#9aa0a6' }} data-testid="demo-readonly-note">
          {DEMO_READONLY_NOTE}
        </div>
      )}
      {!STATIC_DEMO && (
        <>
          <div
            style={costLine}
            data-testid="room-cost"
            title="One guarded model call per voice per question — a fraction of a cent per call (approx); retries can exceed this."
          >
            {`1 question · ${n} voices · ~${n}×<1¢`}
          </div>
          <form style={form} onSubmit={submit}>
            <input
              style={inputBox}
              data-testid="room-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the room a question…"
              maxLength={500}
            />
            <button
              style={{ ...sendBtn, ...(round != null || n < 3 || !input.trim() ? sendDisabled : null) }}
              data-testid="room-ask"
              disabled={round != null || n < 3 || !input.trim()}
            >
              Ask
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/** Thread-row icon for a past answer: the pair if the speaker is still in the room, else 💬. */
function iconFor(pairs: RoomPair[], m: RoomMsg): string {
  const p = pairs.find((x) => x.index === m.agentIndex);
  return p ? iconOf(p.agent) : '💬';
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
const curation: React.CSSProperties = { fontSize: 10.5, lineHeight: 1.35, color: '#6b7280', margin: '2px 0 6px' };
const memberList: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, margin: '6px 0 8px' };
const member: React.CSSProperties = { background: '#f8f9fb', borderRadius: 8, padding: '5px 8px' };
const memberHead: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5 };
const memberLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: '#1f2937', flex: 1 };
const speakerIcon: React.CSSProperties = { fontSize: 12 };
const removeBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#9aa0a6',
  fontSize: 12,
  cursor: 'pointer',
  padding: '0 2px',
};
const memberGrounding: React.CSSProperties = { fontSize: 10.5, lineHeight: 1.35, color: '#6b7280', marginTop: 2 };
const blocker: React.CSSProperties = {
  fontSize: 11,
  color: '#8a6d1a',
  background: '#fdf6e3',
  borderRadius: 8,
  padding: '5px 8px',
  marginBottom: 8,
};
const capNote: React.CSSProperties = { fontSize: 10.5, color: '#6b7280', padding: '0 2px 6px' };
const thread: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  // 200 not 260 (looked-at catch): three member chips + grounding lines already make this card
  // tall — a 260px thread pushed the question form below the right-rail's scroll fold.
  maxHeight: 200,
  overflowY: 'auto',
  marginBottom: 8,
};
const empty: React.CSSProperties = { fontSize: 12, color: '#9aa0a6', padding: '4px 2px' };
const speaker: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: '#6b7280',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  margin: '2px 0 1px',
};
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
const retryRow: React.CSSProperties = { display: 'flex', gap: 6, padding: '2px 0 0' };
const retryBtn: React.CSSProperties = {
  border: 'none',
  background: '#1f4e9c',
  color: '#fff',
  borderRadius: 6,
  padding: '3px 9px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};
const dismissBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  fontSize: 11,
  cursor: 'pointer',
  textDecoration: 'underline',
};
const callsLine: React.CSSProperties = { fontSize: 10.5, color: '#6b7280', padding: '0 2px 6px' };
const costLine: React.CSSProperties = { fontSize: 10.5, color: '#9aa0a6', padding: '0 2px 4px' };
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
