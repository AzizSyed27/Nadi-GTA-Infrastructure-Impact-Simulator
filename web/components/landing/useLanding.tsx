'use client';

// V2.8 — the landing page's LOGIC, ported from the ratified canvas's component class (its
// `tick()` / `count()` / `renderVals()`), with the canvas's default knobs fixed (intro on,
// the pylon drops on scroll, busy street). The mutable model lives in a ref that only the
// 80 ms tick and the event handlers touch; React state is a committed copy of it. Nothing here
// fetches: the landing mounts no map and asks nothing of an API.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LANDING_TEST_COUNTS } from '@/lib/landingCounts';
import { Glyph, GLYPH_SIZE, RerouteDiagram, type GlyphType } from './glyphs';

type NumKey = 'voices' | 'fa' | 'fb' | 'fc' | 'fd' | 'fe';
type State = {
  dropped: boolean; cta: boolean; nav: string; acts: boolean; stage: number; pv: string;
  strike: boolean; found: boolean; seen: Record<string, boolean>;
} & Record<NumKey, string>;

const INITIAL: State = {
  dropped: false, cta: false, nav: '', acts: false, stage: 0, pv: '', strike: false, found: false,
  seen: {}, voices: '0', fa: '0.0', fb: '0', fc: '0', fd: '0', fe: '0.0',
};

/** The figures the count-ups land on — the page's computed facts (README "Three things it computed"). */
export const LANDING_FIGURES = { voices: 212, fa: 29.1, fb: 30, fc: 28, fd: 72, fe: 51.8 } as const;

const INK = 'var(--color-text)', PAPER = 'var(--color-bg)', STEEL = 'var(--color-accent-900)';

// lanes: 0 top sidewalk (east) · 1 road (east) · 2 road (west) · 3 bottom sidewalk (west)
const LANE_BAND: [number, number][] = [[0, 56], [56, 103], [151, 196], [244, 300]];
const TRAFFIC: [GlyphType, number, number, number][] = [
  ['ped', 0, 36, 0], ['kids', 0, 36, -9], ['wheel', 0, 36, -18], ['ped', 0, 36, -27],
  ['car', 1, 20, -1], ['bike', 1, 20, -5], ['bus', 1, 20, -9], ['car', 1, 20, -13], ['fire', 1, 20, -17],
  ['car', 2, 20, -2], ['truck', 2, 20, -6], ['bike', 2, 20, -10], ['car', 2, 20, -14], ['bus', 2, 20, -18],
  ['ped', 3, 36, -4], ['ped', 3, 36, -13], ['kids', 3, 36, -22], ['wheel', 3, 36, -31],
];
const ROLLING: GlyphType[] = ['car', 'van', 'bus', 'truck', 'fire'];
const walkFor = (type: GlyphType, onRoad: boolean) =>
  type === 'bike' ? 'nadi-pedal 0.5s ease-in-out infinite'
    : onRoad ? 'nadi-roll 0.35s ease-in-out infinite' : 'nadi-walk 0.55s ease-in-out infinite';

// 212 voices as a field of individuals. Group sizes are illustrative; no total is ever drawn from them.
const VOICE_GROUPS: [string, number, string, string][] = [
  ['Driver', 88, 'var(--color-accent-900)', 'var(--color-accent-900)'],
  ['Cyclist', 34, 'var(--color-accent-600)', 'var(--color-accent-600)'],
  ['Pedestrian', 52, 'var(--color-accent-400)', 'var(--color-accent-400)'],
  ['Transit rider', 26, 'var(--color-accent-200)', 'var(--color-accent-400)'],
  ['Resident or business', 9, 'var(--color-neutral-400)', 'var(--color-neutral-400)'],
  ['Institution', 3, 'transparent', 'var(--color-text)'],
];

// first-load intro: a car pushes PLAN in from the left, a truck pushes PREVIEW from the right,
// two vehicles meet at PREDICT (the ratified hero — see LandingMarkup's header).
function introCar(type: GlyphType, side: 'l' | 'r', animation: string): ReactNode {
  const [w, h] = GLYPH_SIZE[type];
  const pos: CSSProperties = side === 'l' ? { right: '100%', marginRight: '0.05em' } : { left: '100%', marginLeft: '0.05em' };
  return (
    <span data-intro-car="1" aria-hidden style={{ position: 'absolute', bottom: '0.1em', lineHeight: 0, pointerEvents: 'none', animation, ...pos }}>
      <span style={{ display: 'inline-block', lineHeight: 0, transform: side === 'r' ? 'scaleX(-1)' : 'none' }}>
        <Glyph type={type} fill={STEEL} hub={PAPER} style={{ display: 'block', height: '0.6em', width: `${(0.6 * w / h).toFixed(3)}em` }} />
      </span>
    </span>
  );
}

export function useLanding() {
  const [s, setS] = useState<State>(INITIAL);
  const model = useRef<{ s: State; anims: Partial<Record<NumKey, number>>; holdUntil: number; actsAt: number }>(
    { s: INITIAL, anims: {}, holdUntil: 0, actsAt: 0 },
  );

  useEffect(() => {
    const m = model.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const patch = (next: Partial<State>) => { m.s = { ...m.s, ...next }; setS(m.s); };
    const rect = (id: string) => document.getElementById(id)?.getBoundingClientRect() ?? null;
    const count = (key: NumKey, dec: number, ms: number, delay = 0) => {
      window.clearInterval(m.anims[key]);
      const to = LANDING_FIGURES[key];
      if (reduce) { patch({ [key]: to.toFixed(dec) }); return; } // no count-up: the figure, at once
      const t0 = performance.now() + delay;
      m.anims[key] = window.setInterval(() => {
        const p = (performance.now() - t0) / ms;
        if (p < 0) return;
        const q = Math.min(1, p), e = 1 - Math.pow(1 - q, 3);
        patch({ [key]: (to * e).toFixed(dec) });
        if (q >= 1) window.clearInterval(m.anims[key]);
      }, 40);
    };
    const tick = () => {
      const vh = window.innerHeight || 800, cur = m.s, next: Partial<State> = {};
      const hero = rect('top');
      const dropped = !!hero && hero.top < -16;
      if (dropped !== cur.dropped) next.dropped = dropped;
      const cta = !!hero && hero.bottom < 120;
      if (cta !== cur.cta) next.cta = cta;
      let nav = '';
      for (const id of ['what', 'how', 'honesty', 'demo']) { const r = rect(id); if (r && r.top <= 160) nav = id; }
      if (nav !== cur.nav) next.nav = nav;
      const c = rect('how-console');
      const now = performance.now();
      const acts = !!c && c.top < vh * 0.8 && c.bottom > 0 && now > m.holdUntil;
      let startVoices = false;
      if (acts !== cur.acts) {
        next.acts = acts;
        if (acts) { m.actsAt = now; startVoices = true; } else { window.clearInterval(m.anims.voices); next.voices = '0'; }
      }
      // console clock → which of the four stages is lit (BUILD 0–0.9 s, WATCH to 3.5, READ to 7.4, EXPLORE after)
      const el = acts ? (now - (m.actsAt || now)) / 1000 : -1;
      const stage = el < 0 ? 0 : el < 0.9 ? 1 : el < 3.5 ? 2 : el < 7.4 ? 3 : 4;
      if (stage !== cur.stage) next.stage = stage;
      const k = rect('strike');
      const strike = !!k && k.top < vh * 0.85 && k.bottom > 0;
      if (strike !== cur.strike) next.strike = strike;
      const f = rect('findings');
      const found = !cur.found && !!f && f.top < vh * 0.75;
      if (found) next.found = true;
      for (const id of ['findings', 'honesty', 'gates', 'real', 'demo', 'run']) {
        if (cur.seen[id]) continue;
        const r = rect(id);
        if (r && r.top < vh * 0.85) next.seen = { ...(next.seen ?? cur.seen), [id]: true };
      }
      if (Object.keys(next).length) patch(next);
      if (startVoices) count('voices', 0, 3000, 4300);
      if (found) { count('fa', 1, 1400); count('fb', 0, 1400); count('fc', 0, 1400); count('fd', 0, 1400); count('fe', 1, 1400); }
    };
    const timer = window.setInterval(tick, 80);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
      Object.values(m.anims).forEach((id) => window.clearInterval(id));
    };
  }, []);

  const replay = useCallback(() => {
    const m = model.current;
    m.holdUntil = performance.now() + 160;
    window.clearInterval(m.anims.voices);
    m.s = { ...m.s, acts: false, voices: '0', stage: 0 };
    setS(m.s);
  }, []);
  const setPv = useCallback((k: string) => () => {
    const m = model.current;
    m.s = { ...m.s, pv: k };
    setS(m.s);
  }, []);

  const reroute = useMemo(() => <RerouteDiagram />, []);
  // the thesis parade: one of each sign, walking the line left to right at a shared pace
  const parade = useMemo(() => (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {(['ped', 'bike', 'car', 'kids', 'bus', 'wheel', 'truck', 'fire'] as GlyphType[]).map((type, i) => (
        <div key={type} data-anim="1" style={{ position: 'absolute', left: 0, bottom: 29, lineHeight: 0, animation: `nadi-travel 34s linear infinite ${-(i * 34 / 8 + (i % 2) * 0.7)}s` }}>
          <div style={{ animation: walkFor(type, ROLLING.includes(type)), display: 'inline-block', lineHeight: 0 }}>
            <Glyph type={type} fill={PAPER} />
          </div>
        </div>
      ))}
    </div>
  ), []);
  const voiceDots = useMemo(() => VOICE_GROUPS.flatMap(([label, n, bg, bd]) =>
    Array.from({ length: n }, (_, i) => (
      <span
        key={`${label}${i}`}
        data-testid="landing-voice-dot"
        title={label + (label === 'Institution' ? ': quotes its own mandate, zero model calls' : ': one voice, one trip')}
        style={{ width: 9, height: 9, background: bg, border: `1px solid ${bd}`, boxSizing: 'border-box' }}
      />
    ))), []);
  const intro = useMemo(() => ({
    aPlan: 'nadi-push-l 0.9s cubic-bezier(.2,.7,.2,1) 0.15s both',
    aPreview: 'nadi-push-r 0.9s cubic-bezier(.2,.7,.2,1) 0.75s both',
    aAnd: 'nadi-in 0.4s ease 3.3s both',
    aPredict: 'nadi-appear 0.05s linear 2.62s both, nadi-impact 0.55s ease-out 2.62s',
    aSub: 'nadi-in 0.5s ease 3.45s both',
    aCta: 'nadi-in 0.5s ease 3.6s both',
    carPlan: introCar('car', 'l', 'nadi-exit-l 0.7s ease-in 1.2s both'),
    carPreview: introCar('truck', 'r', 'nadi-exit-r 0.7s ease-in 1.8s both'),
    carCrashL: introCar('car', 'l', 'nadi-crash-l 1.6s linear 1.9s both'),
    carCrashR: introCar('van', 'r', 'nadi-crash-r 1.6s linear 1.9s both'),
  }), []);

  const d = s.dropped;
  const traffic = (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {TRAFFIC.map(([type, lane, dur, delay], i) => {
        const dir = lane < 2 ? 1 : -1, onRoad = lane === 1 || lane === 2;
        const [a, b] = LANE_BAND[lane];
        const top = Math.round(a + (b - a - GLYPH_SIZE[type][1]) / 2);
        const play = d ? 'paused' : 'running';
        return (
          <div key={`${type}${lane}${i}`} data-anim="1" style={{ position: 'absolute', left: 0, top, animation: `nadi-travel ${dur}s linear infinite ${delay}s`, animationDirection: dir < 0 ? 'reverse' : 'normal', animationPlayState: play }}>
            <div style={{ transition: 'transform 1.1s cubic-bezier(.5,0,.8,.4), opacity 0.8s ease 0.2s', transform: d ? `translateX(${dir * 70}vw)` : 'none', opacity: d ? 0 : 1 }}>
              {/* the flip lives on its own wrapper so the walk keyframes (which set transform) cannot undo it */}
              <div style={{ transform: dir < 0 ? 'scaleX(-1)' : 'none', display: 'inline-block', lineHeight: 0 }}>
                <div style={{ animation: walkFor(type, onRoad), animationPlayState: play, display: 'inline-block', lineHeight: 0 }}>
                  <Glyph type={type} fill={onRoad ? PAPER : INK} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
  const pylonStyle: CSSProperties = {
    position: 'absolute', left: '50%', top: 66, marginLeft: -36, lineHeight: 0, zIndex: 2,
    transition: 'transform 0.9s cubic-bezier(.3,1.5,.5,1), opacity 0.3s',
    transform: d ? 'translateY(0)' : 'translateY(-120vh)', opacity: d ? 1 : 0,
  };
  const lag = d ? '0.9s' : '0s';
  const captionStyle: CSSProperties = {
    position: 'absolute', left: 'calc(50% + 64px)', right: 16, top: 84, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2,
    transition: `opacity 0.6s ease ${lag}, transform 0.6s ease ${lag}`,
    opacity: d ? 1 : 0, transform: d ? 'translateY(0)' : 'translateY(12px)', pointerEvents: d ? 'auto' : 'none',
  };

  const navC = (id: string) => (s.nav === id ? 'var(--color-accent)' : 'transparent');
  const inN = (id: string) => (s.seen[id] ? 'nadi-in' : 'none');
  const lit = (n: number) => s.stage === n;
  const stBg = (n: number) => (lit(n) ? 'color-mix(in srgb, var(--color-bg) 10%, transparent)' : 'transparent');
  const stBar = (n: number) => (lit(n) ? 'var(--color-accent-300)' : 'transparent');
  const stColor = (n: number) => (lit(n) ? 'var(--color-bg)' : 'var(--color-accent-300)');
  const pvOn = (k: string) => (s.pv === k ? 1 : 0);
  const bar = (k: string) => (s.pv === k ? 'var(--color-accent)' : 'transparent');
  const seenF = !!s.seen.findings;
  const ctaEvents: CSSProperties['pointerEvents'] = s.cta ? 'auto' : 'none';

  return {
    traffic, pylonStyle, captionStyle, cueOpacity: d ? 0 : 1, parade, reroute, voiceDots, ...intro,
    ctaOpacity: s.cta ? 1 : 0, ctaShift: s.cta ? '0' : '-6px', ctaEvents,
    replay, hoverOff: setPv(''), baseOpacity: s.pv ? 0.3 : 1,
    pvRoad: pvOn('Road'), pvBike: pvOn('Bike'), pvSpeed: pvOn('Speed'), pvClosure: pvOn('Closure'), pvIncident: pvOn('Incident'), pvSchool: pvOn('School'),
    hoverRoad: setPv('Road'), hoverBike: setPv('Bike'), hoverSpeed: setPv('Speed'), hoverClosure: setPv('Closure'), hoverIncident: setPv('Incident'), hoverSchool: setPv('School'),
    barRoad: bar('Road'), barBike: bar('Bike'), barSpeed: bar('Speed'), barClosure: bar('Closure'), barIncident: bar('Incident'), barSchool: bar('School'),
    st1Bg: stBg(1), st1Bar: stBar(1), st1Color: stColor(1), st2Bg: stBg(2), st2Bar: stBar(2), st2Color: stColor(2),
    st3Bg: stBg(3), st3Bar: stBar(3), st3Color: stColor(3), st4Bg: stBg(4), st4Bar: stBar(4), st4Color: stColor(4),
    navWhat: navC('what'), navHow: navC('how'), navHonesty: navC('honesty'), navDemo: navC('demo'),
    actsName: s.acts ? 'nadi-in' : 'none', popName: s.acts ? 'nadi-pop' : 'none', strikeName: s.strike ? 'nadi-strike' : 'none',
    voices: s.voices, fa: s.fa, fb: s.fb, fc: s.fc, fd: s.fd, fe: s.fe,
    fdW: Math.round(250 * parseFloat(s.fd) / 100), feW: `${s.fe}%`,
    inFindings: inN('findings'), inHonesty: inN('honesty'), inGates: inN('gates'), inReal: inN('real'), inDemo: inN('demo'), inRun: inN('run'),
    drawShort: seenF ? 'nadi-draw-short' : 'none', drawLong: seenF ? 'nadi-draw-long' : 'none',
    drawIn: seenF ? 'nadi-draw-in' : 'none', drawOut: seenF ? 'nadi-draw-out' : 'none', growName: seenF ? 'nadi-grow' : 'none',
    cPytest: LANDING_TEST_COUNTS.pytest, cPlaywright: LANDING_TEST_COUNTS.playwright, cDemo: LANDING_TEST_COUNTS.staticDemo,
  };
}

export type LandingVals = ReturnType<typeof useLanding>;
