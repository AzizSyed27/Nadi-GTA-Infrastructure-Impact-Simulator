// V2.8 — the landing page's road-sign silhouettes and its reroute diagram, ported from the
// ratified canvas's `glyph()` and `reroute()` (coordinates verbatim). Every glyph is drawn facing
// RIGHT; a wrapper flips it for leftward lanes.
import type { CSSProperties, ReactNode } from 'react';

export type GlyphType = 'ped' | 'kids' | 'wheel' | 'bike' | 'car' | 'van' | 'bus' | 'truck' | 'fire';

/** Natural pixel size per glyph (the canvas's width/height attributes). */
export const GLYPH_SIZE: Record<GlyphType, [number, number]> = {
  ped: [30, 44], kids: [40, 44], wheel: [40, 40], bike: [56, 42], car: [68, 32],
  van: [76, 36], bus: [84, 37], truck: [84, 37], fire: [88, 37],
};
const VIEWBOX: Record<GlyphType, string> = {
  ped: '0 0 44 64', kids: '0 0 60 64', wheel: '0 0 60 60', bike: '0 0 76 56', car: '0 0 84 40',
  van: '0 0 92 44', bus: '0 0 100 44', truck: '0 0 100 44', fire: '0 0 104 44',
};

const STEEL = 'var(--color-accent-900)';

function wheels(fill: string, hub: string, ...at: [number, number, number][]): ReactNode[] {
  return at.flatMap(([cx, cy, r]) => [
    <circle key={`w${cx}`} cx={cx} cy={cy} r={r} fill={fill} />,
    <circle key={`h${cx}`} cx={cx} cy={cy} r={r * 0.4} fill={hub} />,
  ]);
}

function parts(type: GlyphType, fill: string, hub: string): ReactNode {
  const S = { fill, stroke: 'none' };
  switch (type) {
    case 'ped':
      return (<>
        <circle cx={27} cy={8} r={6.5} {...S} />
        <polygon points="18,16 31,16 33,36 16,36" {...S} />
        <polygon points="16,35 24,35 11,60 5,58" {...S} />
        <polygon points="24,35 33,35 36,50 42,60 36,62 30,52 25,46" {...S} />
        <polygon points="19,17 24,21 12,36 8,33" {...S} />
        <polygon points="29,17 34,19 43,32 39,35" {...S} />
      </>);
    case 'kids':
      return (<>
        <circle cx={16} cy={8} r={6.5} {...S} />
        <polygon points="10,16 22,16 24,36 8,36" {...S} />
        <polygon points="8,35 16,35 6,60 1,58" {...S} />
        <polygon points="16,35 24,35 30,58 24,60" {...S} />
        <polygon points="21,17 25,19 36,36 32,38" {...S} />
        <circle cx={44} cy={24} r={5.5} {...S} />
        <polygon points="39,30 49,30 50,46 38,46" {...S} />
        <polygon points="38,45 44,45 36,62 32,60" {...S} />
        <polygon points="44,45 50,45 56,60 51,62" {...S} />
        <polygon points="39,31 36,34 32,38 35,40" {...S} />
        <polygon points="48,31 52,33 58,44 54,46" {...S} />
      </>);
    case 'wheel':
      return (<>
        <circle cx={24} cy={42} r={14} fill="none" stroke={fill} strokeWidth={4} />
        <circle cx={24} cy={42} r={3} {...S} />
        <circle cx={48} cy={50} r={5} {...S} />
        <circle cx={32} cy={8} r={6} {...S} />
        <polygon points="26,14 38,14 40,32 46,32 48,38 26,38" {...S} />
        <polygon points="16,24 22,24 22,40 16,40" {...S} />
        <polygon points="40,36 46,36 50,48 44,50" {...S} />
      </>);
    case 'bike':
      return (<>
        <circle cx={14} cy={42} r={12} fill="none" stroke={fill} strokeWidth={3.5} />
        <circle cx={62} cy={42} r={12} fill="none" stroke={fill} strokeWidth={3.5} />
        <polyline points="14,42 28,22 50,22 62,42 36,42 28,22" fill="none" stroke={fill} strokeWidth={3.5} strokeLinejoin="round" />
        <line x1={50} y1={22} x2={46} y2={12} stroke={fill} strokeWidth={3.5} />
        <rect x={20} y={18} width={12} height={4} {...S} />
        <circle cx={44} cy={6} r={5.5} {...S} />
        <polygon points="40,12 50,14 56,22 50,28 40,24 34,34 38,20" {...S} />
        <polygon points="36,30 40,32 40,40 34,42" {...S} />
      </>);
    case 'car':
      return (<>
        <path d="M4 28 L4 19 L16 16 L26 6 L50 6 L60 15 L77 18 L80 28 Z" {...S} />
        <polygon points="28,9 37,9 37,15 21,15" fill={hub} />
        <polygon points="40,9 49,9 56,15 40,15" fill={hub} />
        {wheels(fill, hub, [20, 30, 6.5], [64, 30, 6.5])}
      </>);
    case 'van':
      return (<>
        <path d="M4 34 V8 H58 L78 20 L88 24 V34 Z" {...S} />
        <polygon points="10,12 30,12 30,20 10,20" fill={hub} />
        <polygon points="34,12 56,12 70,20 34,20" fill={hub} />
        {wheels(fill, hub, [22, 34, 6.5], [70, 34, 6.5])}
      </>);
    case 'bus':
      return (<>
        <path d="M2 4 H88 L98 14 V34 H2 Z" {...S} />
        {[8, 24, 40, 56].map((x) => <rect key={x} x={x} y={9} width={13} height={10} fill={hub} />)}
        <polygon points="74,9 87,9 94,16 94,19 74,19" fill={hub} />
        {wheels(fill, hub, [20, 34, 6.5], [78, 34, 6.5])}
      </>);
    case 'truck':
      return (<>
        <rect x={2} y={2} width={60} height={32} {...S} />
        <polygon points="64,14 84,14 94,24 94,34 64,34" {...S} />
        <polygon points="67,17 82,17 89,24 67,24" fill={hub} />
        {wheels(fill, hub, [16, 34, 6.5], [46, 34, 6.5], [82, 34, 6.5])}
      </>);
    case 'fire':
      return (<>
        <rect x={2} y={12} width={64} height={22} {...S} />
        <polygon points="68,12 90,12 98,24 98,34 68,34" {...S} />
        <polygon points="71,15 88,15 94,24 71,24" fill={hub} />
        <rect x={74} y={6} width={8} height={5} {...S} />
        <rect x={6} y={5} width={54} height={3} {...S} />
        <rect x={6} y={1} width={54} height={2} {...S} />
        {[12, 22, 32, 42, 52].map((x) => <rect key={x} x={x} y={3} width={2} height={3} {...S} />)}
        {wheels(fill, hub, [18, 34, 6.5], [50, 34, 6.5], [86, 34, 6.5])}
      </>);
  }
}

export function Glyph({ type, fill, hub = STEEL, style }: {
  type: GlyphType; fill: string; hub?: string; style?: CSSProperties;
}) {
  const [w, h] = GLYPH_SIZE[type];
  return (
    <svg viewBox={VIEWBOX[type]} width={w} height={h} style={style}>
      {parts(type, fill, hub)}
    </svg>
  );
}

// The reroute diagram: a 16 s SMIL loop. Straight-route dots, a cone drops, detour dots.
export function RerouteDiagram() {
  const D = '16s';
  const paper = 'var(--color-bg)', grid = 'var(--color-neutral-200)', ink = 'var(--color-text)', acc = 'var(--color-accent-700)';
  const A = 'M24 100 H576', B = 'M24 100 H140 V220 H460 V100 H576';
  const f3 = (n: number) => n.toFixed(3);
  const fade = (keyTimes: string, values: string) => (
    <animate attributeName="opacity" dur={D} repeatCount="indefinite" values={values} keyTimes={keyTimes} />
  );
  const dot = (path: string, s: number, t: number, key: string) => (
    <circle key={key} r={5} fill={paper} stroke={STEEL} strokeWidth={1.5} opacity={0}>
      <animateMotion path={path} dur={D} repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1" keyTimes={`0;${f3(s)};${f3(s + t)};1`} />
      {fade(`0;${f3(s)};${f3(s + 0.004)};${f3(s + t - 0.004)};${f3(s + t)};1`, '0;0;1;1;0;0')}
    </circle>
  );
  const road = (x1: number, y1: number, x2: number, y2: number, key: string) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={STEEL} strokeWidth={16} strokeLinecap="square" />
  );
  const dash = (x1: number, y1: number, x2: number, y2: number, key: string) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={paper} strokeWidth={1.5} strokeDasharray="8 8" opacity={0.55} />
  );
  const label = (x: number, y: number, text: string, anchor: 'start' | 'middle' = 'middle', fill = ink) => (
    <text x={x} y={y} textAnchor={anchor} fontFamily="var(--font-heading)" fontSize={12} letterSpacing="0.16em" fill={fill}>{text}</text>
  );
  return (
    <svg viewBox="0 0 600 320" style={{ width: '100%', height: 'auto', display: 'block' }} aria-hidden>
      <defs>
        <pattern id="nadi-grid" width={24} height={24} patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke={grid} strokeWidth={1} />
        </pattern>
        <pattern id="nadi-hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={3} height={8} fill={paper} opacity={0.75} />
        </pattern>
      </defs>
      <rect width={600} height={320} fill="url(#nadi-grid)" />
      {road(24, 100, 576, 100, 'r1')}{road(24, 220, 576, 220, 'r2')}{road(140, 100, 140, 220, 'r3')}{road(460, 100, 460, 220, 'r4')}
      {dash(24, 100, 576, 100, 'd1')}{dash(24, 220, 576, 220, 'd2')}
      {label(24, 80, 'SIMULATED TRAFFIC', 'start', 'var(--color-neutral-600)')}
      <g opacity={0}>
        {fade('0;0.43;0.45;0.985;1', '0;0;1;1;0')}
        <rect x={252} y={92} width={96} height={16} fill="url(#nadi-hatch)" />
        <line x1={252} y1={90} x2={252} y2={110} stroke={paper} strokeWidth={2} />
        <line x1={348} y1={90} x2={348} y2={110} stroke={paper} strokeWidth={2} />
        {label(300, 64, 'CLOSURE · TIMED WINDOW')}
      </g>
      <g opacity={0}>
        {fade('0;0.48;0.5;0.985;1', '0;0;1;1;0')}
        {label(300, 254, 'DETOUR', 'middle', acc)}
      </g>
      {[0.02, 0.08, 0.14, 0.2, 0.26].map((s, i) => dot(A, s, 0.11, `a${i}`))}
      {[0.48, 0.56, 0.64, 0.72, 0.8].map((s, i) => dot(B, s, 0.16, `b${i}`))}
      <g transform="translate(300 100)">
        <g opacity={0}>
          {fade('0;0.4;0.405;0.97;1', '0;0;1;1;0')}
          <animateTransform attributeName="transform" type="translate" values="0 -170;0 -170;0 0;0 0;0 -170" keyTimes="0;0.4;0.44;0.985;1" calcMode="spline" keySplines="0 0 1 1;0.55 0 0.85 0.45;0 0 1 1;0 0 1 1" dur={D} repeatCount="indefinite" />
          <g transform="translate(-18 -39) scale(0.5)">
            <ellipse cx={36} cy={80} rx={30} ry={4} fill="rgba(0,0,0,0.3)" />
            <rect x={6} y={70} width={60} height={9} fill={ink} />
            <polygon points="26,4 46,4 58,70 14,70" fill={ink} />
            <polygon points="22,28 50,28 53,44 19,44" fill={paper} />
            <polygon points="27,4 45,4 46,12 26,12" fill={paper} />
          </g>
        </g>
      </g>
    </svg>
  );
}
