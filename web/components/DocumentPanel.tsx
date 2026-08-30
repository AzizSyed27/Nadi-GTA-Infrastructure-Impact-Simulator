'use client';

// V2.7a — the RUN DOCUMENT panel: the collapsible reading surface over the persistent map
// canvas (the ratified Shell v2 layout). The panel is the FRAME; each stage supplies its
// article. Collapsed → a 46px vertical strip that re-expands on click.

export function DocumentPanel({
  title,
  collapsed,
  onToggle,
  topOffset,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  topOffset: number; // 78 under the bare header; 118 under the explore sub-nav
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <div className="nadi-shell" style={{ ...stripPos, top: topOffset }}>
        <div
          className="blueprint"
          data-testid="document-strip"
          onClick={() => onToggle(false)}
          title="Expand the run document"
          style={strip}
        >
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>⇥</span>
          <span style={stripTitle}>{title}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="nadi-shell" style={{ ...panelPos, top: topOffset }}>
      <section className="blueprint" style={panel} data-testid="document-panel">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div style={head}>
          <span style={headTitle}>{title}</span>
          <button
            className="btn btn-ghost"
            onClick={() => onToggle(true)}
            title="Collapse the document; the map takes over"
            data-testid="document-collapse"
          >
            ⇤ collapse
          </button>
        </div>
        <div className="nadi-doc" style={body}>{children}</div>
      </section>
    </div>
  );
}

const panelPos: React.CSSProperties = {
  position: 'absolute',
  left: 20,
  bottom: 20,
  width: 'min(680px, 52vw)',
  zIndex: 20,
};
const stripPos: React.CSSProperties = {
  position: 'absolute',
  left: 20,
  bottom: 20,
  width: 46,
  zIndex: 20,
};
const panel: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  background: 'var(--color-bg)',
  boxShadow: 'var(--shadow-lg)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'var(--font-body)',
  color: 'var(--color-text)',
};
const head: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--space-3) var(--space-6)',
  borderBottom: '1px solid var(--color-divider)',
};
const headTitle: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontSize: 13,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--color-neutral-700)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const body: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--space-8) 40px 48px',
  fontSize: 15,
  lineHeight: 1.55,
};
const strip: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  background: 'var(--color-bg)',
  boxShadow: 'var(--shadow-md)',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: 'var(--space-4) 0',
  gap: 'var(--space-4)',
  fontFamily: 'var(--font-body)',
  color: 'var(--color-text)',
};
const stripTitle: React.CSSProperties = {
  writingMode: 'vertical-rl',
  fontFamily: 'var(--font-heading)',
  fontSize: 12.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--color-neutral-700)',
};
