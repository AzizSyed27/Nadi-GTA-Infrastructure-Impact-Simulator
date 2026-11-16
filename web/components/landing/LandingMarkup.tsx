// V2.8 - the landing page's MARKUP, transcribed from the ratified canvas
// ("Nadi Landing.dc.html" in the design project "Nadi traffic simulation redesign", read
// 2026-11-15) by a one-shot converter and hand-maintained since. Structure, inline styles and
// copy are the canvas's, with the RATIFIED differences recorded in CLAUDE.md's V2.8 box:
// eleven copy corrections to the repo's record, same-host /app/ demo links, and the three test
// counts read from one constant. Every dynamic value arrives through `v` (useLanding).
//
// THE HERO IS A RATIFIED EXCEPTION (user, 2026-11-15): "Plan, Preview, and Predict." with two
// vehicles colliding into "Predict" ships exactly as designed, on this page only. The product's
// locked rules (a preview, never an oracle; no crash wording or imagery) are unchanged
// everywhere else - do not "fix" the headline, and do not copy it into the app.
import type { LandingVals } from './useLanding';

export default function LandingMarkup({ v }: { v: LandingVals }) {
  return (
    <>
    <nav className="nav" id="nav" data-nav="1" data-screen-label="Landing nav" style={{ position: "sticky", top: "0", zIndex: "20", background: "color-mix(in srgb, var(--color-bg) 92%, transparent)", backdropFilter: "blur(6px)", borderBottom: "1px solid var(--color-divider)", padding: "10px clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "var(--space-3) var(--space-4)" }}>
      <a href="#top" style={{ display: "flex", alignItems: "center", gap: "10px", color: "inherit", textDecoration: "none" }}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="2.5" y="2.5" width="19" height="19" />
          <line x1="2.5" y1="12" x2="21.5" y2="12" />
          <line x1="12" y1="2.5" x2="12" y2="21.5" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        </svg>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "20px", letterSpacing: "0.04em" }}>
          {"NADI"}
        </span>
        <span data-hide-narrow="1" style={{ fontSize: "12px", color: "var(--color-neutral-600)", whiteSpace: "nowrap" }}>
          {"GTA infrastructure impact simulator"}
        </span>
      </a>
      <div data-nav-links="1" style={{ display: "flex", gap: "var(--space-6)", justifyContent: "center", flexWrap: "wrap" }}>
        <a className="lh-accent" href="#what" style={{ fontSize: "14px", color: "inherit", textDecoration: "none", whiteSpace: "nowrap", padding: "4px 0", borderBottom: `2px solid ${v.navWhat}`, transition: "border-color 0.2s" }}>
          {"What it does"}
        </a>
        <a className="lh-accent" href="#how" style={{ fontSize: "14px", color: "inherit", textDecoration: "none", whiteSpace: "nowrap", padding: "4px 0", borderBottom: `2px solid ${v.navHow}`, transition: "border-color 0.2s" }}>
          {"How it works"}
        </a>
        <a className="lh-accent" href="#honesty" style={{ fontSize: "14px", color: "inherit", textDecoration: "none", whiteSpace: "nowrap", padding: "4px 0", borderBottom: `2px solid ${v.navHonesty}`, transition: "border-color 0.2s" }}>
          {"Honesty"}
        </a>
        <a className="lh-accent" href="#demo" style={{ fontSize: "14px", color: "inherit", textDecoration: "none", whiteSpace: "nowrap", padding: "4px 0", borderBottom: `2px solid ${v.navDemo}`, transition: "border-color 0.2s" }}>
          {"Demo"}
        </a>
      </div>
      <div data-nav-right="1" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <a className="btn btn-primary" href="/app/" style={{ gap: "8px", whiteSpace: "nowrap", borderRadius: "0", opacity: v.ctaOpacity, transform: `translateY(${v.ctaShift})`, pointerEvents: v.ctaEvents, transition: "opacity 0.3s, transform 0.3s" }}>
          {"Try the demo "}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
        </a>
        <a className="btn btn-secondary" href="https://github.com/AzizSyed27/Nadi-GTA-Infrastructure-Impact-Simulator" target="_blank" rel="noopener" style={{ gap: "8px", whiteSpace: "nowrap" }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.1c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
          </svg>
          {"GitHub"}
        </a>
      </div>
    </nav>
    <section id="top" data-screen-label="Landing hero" style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 57px)" }}>
      <div style={{ maxWidth: "1200px", width: "100%", margin: "0 auto", padding: "clamp(56px, 9vh, 112px) clamp(20px, 5vw, 72px) clamp(32px, 5vh, 56px)", boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "clamp(52px, 8vw, 112px)", lineHeight: "0.98", letterSpacing: "0.01em", textTransform: "uppercase", margin: "0" }}>
          <span style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "0 0.22em" }}>
            <span data-intro="1" style={{ position: "relative", display: "inline-block", animation: v.aPlan }}>
              {"Plan,"}
              {v.carPlan}
            </span>
            <span data-intro="1" style={{ position: "relative", display: "inline-block", animation: v.aPreview }}>
              {"Preview,"}
              {v.carPreview}
            </span>
          </span>
          <span style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "0 0.22em" }}>
            <span data-intro="1" style={{ display: "inline-block", animation: v.aAnd }}>
              {"and"}
            </span>
            <span style={{ position: "relative", display: "inline-block" }}>
              <span data-intro="1" style={{ display: "inline-block", transformOrigin: "50% 100%", animation: v.aPredict }}>
                {"Predict."}
              </span>
              {v.carCrashL}
              {v.carCrashR}
            </span>
          </span>
        </h1>
        <p data-intro="1" style={{ fontSize: "17px", lineHeight: "1.55", maxWidth: "58ch", margin: "28px auto 0", color: "var(--color-neutral-800)", animation: v.aSub }}>
          {"Draw a street change on a real Toronto corridor: a new road, a bike lane, a closure, a school zone. Nadi runs the morning rush with and without it, then shows who wins, who loses, and what each of them is likely to say, before anyone is consulted. The tool arranges evidence. The planner concludes."}
        </p>
        <div data-intro="1" style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", justifyContent: "center", marginTop: "28px", animation: v.aCta }}>
          <a className="btn btn-primary blueprint" href="/app/" style={{ padding: "10px 18px", fontSize: "15px", borderRadius: "0", gap: "8px" }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            {"Try the live demo"}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </a>
          <a className="btn btn-secondary" href="https://github.com/AzizSyed27/Nadi-GTA-Infrastructure-Impact-Simulator" target="_blank" rel="noopener" style={{ padding: "10px 18px", fontSize: "15px", borderRadius: "0", gap: "8px" }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {"Star on GitHub"}
          </a>
        </div>
        <div data-anim="1" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", marginTop: "44px", opacity: v.cueOpacity, transition: "opacity 0.4s" }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.18em", color: "var(--color-neutral-600)" }}>
            {"SCROLL"}
          </span>
          <svg data-anim="1" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--color-neutral-600)" strokeWidth="1.5" aria-hidden style={{ animation: "nadi-cue 1.6s ease-in-out infinite" }}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
      <div data-screen-label="Landing street" style={{ position: "relative", marginTop: "auto", width: "100%", height: "300px", userSelect: "none" }}>
        <div style={{ position: "absolute", left: "0", right: "0", top: "0", height: "56px", background: "var(--color-neutral-200)", borderTop: "1px solid var(--color-divider)" }} />
        <div style={{ position: "absolute", left: "0", right: "0", top: "56px", height: "188px", background: "var(--color-accent-900)" }} />
        <div style={{ position: "absolute", left: "0", right: "0", top: "103px", height: "0", borderTop: "2px dashed color-mix(in srgb, var(--color-bg) 55%, transparent)" }} />
        <div style={{ position: "absolute", left: "0", right: "0", top: "149px", height: "2px", background: "var(--color-bg)" }} />
        <div style={{ position: "absolute", left: "0", right: "0", top: "196px", height: "0", borderTop: "2px dashed color-mix(in srgb, var(--color-bg) 55%, transparent)" }} />
        <div style={{ position: "absolute", left: "0", right: "0", top: "244px", height: "56px", background: "var(--color-neutral-200)", borderBottom: "1px solid var(--color-divider)" }} />
        <span style={{ position: "absolute", left: "clamp(20px, 5vw, 72px)", top: "118px", fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.18em", color: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }}>
          {"LAWRENCE AVE E"}
        </span>
        <span style={{ position: "absolute", right: "clamp(20px, 5vw, 72px)", top: "211px", fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.18em", color: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }}>
          {"SCARBOROUGH · AM PEAK"}
        </span>
        {v.traffic}
        <div data-anim="1" style={v.pylonStyle}>
          <svg viewBox="0 0 72 84" width="72" height="84" aria-hidden>
            <ellipse cx="36" cy="80" rx="30" ry="4" fill="rgba(0,0,0,0.35)" />
            <rect x="6" y="70" width="60" height="9" fill="var(--color-bg)" />
            <polygon points="26,4 46,4 58,70 14,70" fill="var(--color-bg)" />
            <polygon points="22,28 50,28 53,44 19,44" fill="var(--color-accent-900)" />
            <polygon points="27,4 45,4 46,12 26,12" fill="var(--color-accent-900)" />
          </svg>
        </div>
        <div data-anim="1" style={v.captionStyle}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.14em", color: "var(--color-accent-300)" }}>
            {"A CLOSURE LANDS"}
          </span>
          <span style={{ fontSize: "15px", lineHeight: "1.45", color: "var(--color-bg)", maxWidth: "34ch" }}>
            {"Traffic moves around it. Nadi previews who that reaches, and what each of them is likely to say, before anyone is consulted."}
          </span>
        </div>
      </div>
    </section>
    <section id="what" data-screen-label="Landing 01 what it does" style={{ position: "relative", backgroundColor: "var(--color-bg)", backgroundImage: "linear-gradient(color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px)", backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px", backgroundPosition: "center top" }}>
      <div style={{ position: "relative", maxWidth: "1200px", margin: "0 auto", boxSizing: "border-box", padding: "96px clamp(20px, 5vw, 72px) 88px" }}>
        <div aria-hidden style={{ position: "absolute", top: "28px", right: "clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "auto auto", border: "1px solid var(--color-neutral-500)", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", lineHeight: "1", color: "var(--color-neutral-700)", background: "var(--color-bg)" }}>
          <span style={{ padding: "6px 10px", borderRight: "1px solid var(--color-neutral-500)" }}>
            {"SHEET"}
          </span>
          <span style={{ padding: "6px 10px", fontWeight: "600", color: "var(--color-text)" }}>
            {"01 / 05"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: "48px", alignItems: "center" }}>
          <div>
            <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-700)", marginBottom: "14px" }}>
              {"01 · What it does"}
            </span>
            <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "clamp(34px, 4.5vw, 56px)", lineHeight: "1", textTransform: "uppercase", letterSpacing: "0.01em", margin: "0 0 20px" }}>
              {"Draw a change on a real street. See who it reaches."}
            </h2>
            <p style={{ fontSize: "16px", lineHeight: "1.6", margin: "0 0 14px", color: "var(--color-neutral-800)" }}>
              {"A preview tool for city planners: the corridor is real (Scarborough, Pickering and Ajax, from Toronto open data), you draw a change on it, and Nadi runs the morning rush twice, as the street is today and with your change in place."}
            </p>
            <p style={{ fontSize: "16px", lineHeight: "1.6", margin: "0", color: "var(--color-neutral-800)" }}>
              {"Underneath, a traffic microsimulation (SUMO) moves about 67,000 travelers as physics, calibrated to Toronto counts; a few hundred of them, pinned to their own measured trips, are then given a voice by a language model."}
            </p>
          </div>
          <div className="blueprint" style={{ padding: "12px", background: "var(--color-bg)" }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div style={{ position: "relative" }}>
              <div style={{ opacity: v.baseOpacity, transition: "opacity 0.3s" }}>
                {v.reroute}
              </div>
              <svg viewBox="0 0 600 320" aria-hidden style={{ position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" }}>
                <defs>
                  <pattern id="nadi-hatch-pv" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="3" height="8" fill="var(--color-bg)" opacity="0.8" />
                  </pattern>
                </defs>
                <g style={{ opacity: v.pvRoad, transition: "opacity 0.25s" }}>
                  <path d="M300 100 C 350 100, 370 220, 420 220" fill="none" stroke="var(--color-accent-300)" strokeWidth="22" strokeDasharray="6 5" />
                  <path d="M300 100 C 350 100, 370 220, 420 220" fill="none" stroke="var(--color-accent-900)" strokeWidth="16" />
                  <path d="M300 100 C 350 100, 370 220, 420 220" fill="none" stroke="var(--color-bg)" strokeWidth="1.5" strokeDasharray="8 8" opacity="0.7" />
                  <text x="300" y="40" fontFamily="var(--font-heading)" fontSize="12" letterSpacing="0.16em" textAnchor="middle" fill="var(--color-text)">
                    {"NEW ROAD · 2 LANES · BENDS CHECKED BY THE SERVER"}
                  </text>
                </g>
                <g style={{ opacity: v.pvBike, transition: "opacity 0.25s" }}>
                  <line x1="24" y1="94.5" x2="576" y2="94.5" stroke="oklch(0.8 0.13 145)" strokeWidth="5" />
                  <text x="300" y="40" fontFamily="var(--font-heading)" fontSize="12" letterSpacing="0.16em" textAnchor="middle" fill="var(--color-text)">
                    {"BIKE LANE · EASTBOUND · ADDED TO THE LANE TABLE"}
                  </text>
                </g>
                <g style={{ opacity: v.pvSpeed, transition: "opacity 0.25s" }}>
                  <rect x="140" y="92" width="320" height="16" fill="var(--color-accent-300)" opacity="0.4" />
                  <circle cx="300" cy="100" r="17" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="3" />
                  <text x="300" y="105" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="14" fill="var(--color-text)">
                    {"40"}
                  </text>
                  <text x="300" y="40" fontFamily="var(--font-heading)" fontSize="12" letterSpacing="0.16em" textAnchor="middle" fill="var(--color-text)">
                    {"SPEED LIMIT · 40 KM/H · WHOLE RUN"}
                  </text>
                </g>
                <g style={{ opacity: v.pvClosure, transition: "opacity 0.25s" }}>
                  <rect x="252" y="92" width="96" height="8" fill="url(#nadi-hatch-pv)" />
                  <line x1="252" y1="90" x2="252" y2="100" stroke="var(--color-bg)" strokeWidth="2" />
                  <line x1="348" y1="90" x2="348" y2="100" stroke="var(--color-bg)" strokeWidth="2" />
                  <text x="300" y="40" fontFamily="var(--font-heading)" fontSize="12" letterSpacing="0.16em" textAnchor="middle" fill="var(--color-text)">
                    {"LANE CLOSURE · EASTBOUND ONLY · WESTBOUND STAYS OPEN"}
                  </text>
                </g>
                <g style={{ opacity: v.pvIncident, transition: "opacity 0.25s" }}>
                  <polygon points="300,82 318,112 282,112" fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth="2" strokeLinejoin="round" />
                  <text x="300" y="108" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="700" fontSize="14" fill="var(--color-bg)">
                    {"!"}
                  </text>
                  <rect x="200" y="134" width="200" height="4" fill="var(--color-neutral-300)" />
                  <rect x="275" y="134" width="50" height="4" fill="var(--color-accent)" />
                  <text x="200" y="154" textAnchor="start" fontFamily="var(--font-heading)" fontSize="11" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                    {"07:00"}
                  </text>
                  <text x="400" y="154" textAnchor="end" fontFamily="var(--font-heading)" fontSize="11" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                    {"09:00"}
                  </text>
                  <text x="300" y="154" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="11" letterSpacing="0.12em" fill="var(--color-accent-700)">
                    {"07:45 APPLIES · 08:15 REVERTS"}
                  </text>
                  <text x="300" y="40" fontFamily="var(--font-heading)" fontSize="12" letterSpacing="0.16em" textAnchor="middle" fill="var(--color-text)">
                    {"TIMED INCIDENT · PROOF LOG OF APPLY AND REVERT"}
                  </text>
                </g>
                <g style={{ opacity: v.pvSchool, transition: "opacity 0.25s" }}>
                  <rect x="392" y="56" width="136" height="208" fill="var(--color-accent-300)" opacity="0.28" />
                  <rect x="392" y="56" width="136" height="208" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeDasharray="6 4" />
                  <circle cx="420" cy="100" r="11" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="2.5" />
                  <text x="420" y="104" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="11" fill="var(--color-text)">
                    {"30"}
                  </text>
                  <circle cx="500" cy="100" r="11" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="2.5" />
                  <text x="500" y="104" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="11" fill="var(--color-text)">
                    {"30"}
                  </text>
                  <circle cx="460" cy="160" r="11" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="2.5" />
                  <text x="460" y="164" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="11" fill="var(--color-text)">
                    {"30"}
                  </text>
                  <circle cx="420" cy="220" r="11" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="2.5" />
                  <text x="420" y="224" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="11" fill="var(--color-text)">
                    {"30"}
                  </text>
                  <circle cx="500" cy="220" r="11" fill="var(--color-bg)" stroke="var(--color-accent)" strokeWidth="2.5" />
                  <text x="500" y="224" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="11" fill="var(--color-text)">
                    {"30"}
                  </text>
                  <text x="300" y="40" fontFamily="var(--font-heading)" fontSize="12" letterSpacing="0.16em" textAnchor="middle" fill="var(--color-text)">
                    {"SCHOOL ZONE · FIVE STREETS TO 30 KM/H · BELL HOUR"}
                  </text>
                </g>
              </svg>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", padding: "10px 4px 0", fontSize: "12px", lineHeight: "1.4", color: "var(--color-neutral-600)" }}>
              <span>
                {"Each dot is one simulated traveler."}
              </span>
              <span>
                {"A closure lands. The simulator reroutes them. Hover a change below to preview it here."}
              </span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: "72px" }}>
          <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-700)", marginBottom: "14px" }}>
            {"What you can draw · hover to preview"}
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1px", background: "var(--color-divider)", border: "1px solid var(--color-divider)" }}>
            <div className="lh-tile" onMouseEnter={v.hoverRoad} onMouseLeave={v.hoverOff} onClick={v.hoverRoad} style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", cursor: "default", boxShadow: `inset 0 -3px 0 ${v.barRoad}`, transition: "background 0.2s, box-shadow 0.2s" }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="6" cy="19" r="3" />
                <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                <circle cx="18" cy="5" r="3" />
              </svg>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"New road"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Straight or curved. Click along a street to bend it; every bend is checked by the server before it reaches the simulator."}
              </span>
            </div>
            <div className="lh-tile" onMouseEnter={v.hoverBike} onMouseLeave={v.hoverOff} onClick={v.hoverBike} style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", cursor: "default", boxShadow: `inset 0 -3px 0 ${v.barBike}`, transition: "background 0.2s, box-shadow 0.2s" }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="18.5" cy="17.5" r="3.5" />
                <circle cx="5.5" cy="17.5" r="3.5" />
                <circle cx="15" cy="5" r="1" />
                <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
              </svg>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Bike lane"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Added to a real road's lane table, one direction at a time."}
              </span>
            </div>
            <div className="lh-tile" onMouseEnter={v.hoverSpeed} onMouseLeave={v.hoverOff} onClick={v.hoverSpeed} style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", cursor: "default", boxShadow: `inset 0 -3px 0 ${v.barSpeed}`, transition: "background 0.2s, box-shadow 0.2s" }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m12 14 4-4" />
                <path d="M3.34 19a10 10 0 1 1 17.32 0" />
              </svg>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Speed limit"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Dropped onto a street for the whole run; the school-zone macro times it."}
              </span>
            </div>
            <div className="lh-tile" onMouseEnter={v.hoverClosure} onMouseLeave={v.hoverOff} onClick={v.hoverClosure} style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", cursor: "default", boxShadow: `inset 0 -3px 0 ${v.barClosure}`, transition: "background 0.2s, box-shadow 0.2s" }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9.3 6.2a4.55 4.55 0 0 0 5.4 0" />
                <path d="M7.9 10.7c.9.8 2.4 1.3 4.1 1.3s3.2-.5 4.1-1.3" />
                <path d="M13.9 3.5a1.93 1.93 0 0 0-3.8-.1l-3 10c-.1.2-.1.4-.1.6 0 1.7 2.2 3 5 3s5-1.3 5-3c0-.2 0-.4-.1-.5Z" />
                <path d="m7.5 12.2-4.7 2.7c-.5.3-.8.7-.8 1.1s.3.8.8 1.1l7.6 4.5c.9.5 2.1.5 3 0l7.6-4.5c.7-.3 1-.7 1-1.1s-.3-.8-.8-1.1l-4.7-2.8" />
              </svg>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Lane or road closure"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Per direction. The form says which direction it closes before you run."}
              </span>
            </div>
            <div className="lh-tile" onMouseEnter={v.hoverIncident} onMouseLeave={v.hoverOff} onClick={v.hoverIncident} style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", cursor: "default", boxShadow: `inset 0 -3px 0 ${v.barIncident}`, transition: "background 0.2s, box-shadow 0.2s" }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Timed incident"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Applies and reverts inside the run, with a proof log of both."}
              </span>
            </div>
            <div className="lh-tile" onMouseEnter={v.hoverSchool} onMouseLeave={v.hoverOff} onClick={v.hoverSchool} style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", cursor: "default", boxShadow: `inset 0 -3px 0 ${v.barSchool}`, transition: "background 0.2s, box-shadow 0.2s" }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 22v-4a2 2 0 1 0-4 0v4" />
                <path d="m18 10 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7.382a1 1 0 0 1 .553-.894L6 10" />
                <path d="M18 5v17" />
                <path d="m4 6 7.106-3.553a2 2 0 0 1 1.788 0L20 6" />
                <path d="M6 5v17" />
                <circle cx="12" cy="9" r="2" />
              </svg>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"School zone"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"One macro drops several streets to 30 km/h for the bell hour."}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section id="how" data-screen-label="Landing 02 how it works" style={{ background: "var(--color-accent-900)", color: "var(--color-bg)" }}>
      <div style={{ position: "relative", maxWidth: "1200px", margin: "0 auto", boxSizing: "border-box", padding: "96px clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: "56px", alignItems: "start" }}>
        <div aria-hidden style={{ position: "absolute", top: "28px", right: "clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "auto auto", border: "1px solid color-mix(in srgb, var(--color-bg) 45%, transparent)", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", lineHeight: "1", color: "var(--color-accent-100)" }}>
          <span style={{ padding: "6px 10px", borderRight: "1px solid color-mix(in srgb, var(--color-bg) 45%, transparent)" }}>
            {"SHEET"}
          </span>
          <span style={{ padding: "6px 10px", fontWeight: "600", color: "var(--color-bg)" }}>
            {"02 / 05"}
          </span>
        </div>
        <div>
          <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-300)", marginBottom: "14px" }}>
            {"02 · How it works"}
          </span>
          <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "clamp(34px, 4.5vw, 56px)", lineHeight: "1", textTransform: "uppercase", letterSpacing: "0.01em", margin: "0 0 20px", color: "var(--color-bg)" }}>
            {"A run tells its own story, in two acts."}
          </h2>
          <p style={{ fontSize: "16px", lineHeight: "1.6", margin: "0 0 32px", color: "var(--color-accent-100)" }}>
            {"Everything you draw goes into one draft; one Run button submits it as a composite, stating its cost in model calls first, and the run narrates itself through four stages. Watch the console: each stage lights up as the run reaches it."}
          </p>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "96px 1fr", gap: "16px", padding: "14px 12px 14px 14px", marginLeft: "-14px", borderTop: "1px solid color-mix(in srgb, var(--color-bg) 25%, transparent)", background: v.st1Bg, transition: "background 0.35s" }}>
              <i style={{ position: "absolute", left: "0", top: "-1px", bottom: "0", width: "3px", background: v.st1Bar, transition: "background 0.35s" }} />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "18px", letterSpacing: "0.1em", color: v.st1Color, transition: "color 0.35s" }}>
                {"01 BUILD"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.55", color: "var(--color-bg)" }}>
                {"Compose the draft. Drag a change onto a road; a mini-form fed by that road's real lane table opens in place. Blockers surface before you run, in the engine's own words."}
              </span>
            </div>
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "96px 1fr", gap: "16px", padding: "14px 12px 14px 14px", marginLeft: "-14px", borderTop: "1px solid color-mix(in srgb, var(--color-bg) 25%, transparent)", background: v.st2Bg, transition: "background 0.35s" }}>
              <i style={{ position: "absolute", left: "0", top: "-1px", bottom: "0", width: "3px", background: v.st2Bar, transition: "background 0.35s" }} />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "18px", letterSpacing: "0.1em", color: v.st2Color, transition: "color 0.35s" }}>
                {"02 WATCH"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.55", color: "var(--color-bg)" }}>
                {"Act I, the physics. The baseline morning plays on the map while your scenario computes behind it, and four verified beats land."}
              </span>
            </div>
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "96px 1fr", gap: "16px", padding: "14px 12px 14px 14px", marginLeft: "-14px", borderTop: "1px solid color-mix(in srgb, var(--color-bg) 25%, transparent)", background: v.st3Bg, transition: "background 0.35s" }}>
              <i style={{ position: "absolute", left: "0", top: "-1px", bottom: "0", width: "3px", background: v.st3Bar, transition: "background 0.35s" }} />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "18px", letterSpacing: "0.1em", color: v.st3Color, transition: "color 0.35s" }}>
                {"03 READ"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.55", color: "var(--color-bg)" }}>
                {"The run document. Numbers composed from the run's own artifact, each with its caveat. Prose only from the audited report. A per-group scorecard you can open into voices and interviews."}
              </span>
            </div>
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "96px 1fr", gap: "16px", padding: "14px 12px 14px 14px", marginLeft: "-14px", borderTop: "1px solid color-mix(in srgb, var(--color-bg) 25%, transparent)", borderBottom: "1px solid color-mix(in srgb, var(--color-bg) 25%, transparent)", background: v.st4Bg, transition: "background 0.35s" }}>
              <i style={{ position: "absolute", left: "0", top: "-1px", bottom: "0", width: "3px", background: v.st4Bar, transition: "background 0.35s" }} />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "18px", letterSpacing: "0.1em", color: v.st4Color, transition: "color 0.35s" }}>
                {"04 EXPLORE"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.55", color: "var(--color-bg)" }}>
                {"Compare two runs. Interview any voice in character. Put three to five voices in a room. See the two graphs side by side: who influences whom, and what the report's chat agent knows."}
              </span>
            </div>
          </div>
        </div>
        <div className="blueprint" id="how-console" style={{ border: "1px solid color-mix(in srgb, var(--color-bg) 35%, transparent)", padding: "22px 24px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <i className="corner tl" style={{ color: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }} />
          <i className="corner tr" style={{ color: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }} />
          <i className="corner bl" style={{ color: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }} />
          <i className="corner br" style={{ color: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap", paddingBottom: "12px", borderBottom: "1px solid color-mix(in srgb, var(--color-bg) 25%, transparent)" }}>
            <span style={{ display: "flex", gap: "12px", alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-300)" }}>
                {"EXAMPLE RUN"}
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "17px" }}>
                {"Closure at the fire station's doorstep"}
              </span>
            </span>
            <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "11px", letterSpacing: "0.04em", padding: "3px 10px", border: "1px solid color-mix(in srgb, var(--color-bg) 55%, transparent)", color: "var(--color-bg)" }}>
                {"3 members"}
              </span>
              <a className="lh-replay" role="button" onClick={v.replay} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px", letterSpacing: "0.04em", padding: "3px 10px", border: "1px solid color-mix(in srgb, var(--color-bg) 55%, transparent)", color: "var(--color-bg)", cursor: "pointer", textDecoration: "none", transition: "background 0.2s" }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                {"Replay"}
              </a>
            </span>
          </div>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-300)" }}>
            {"ACT I · THE PHYSICS"}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div data-anim="1" style={{ display: "flex", gap: "12px", alignItems: "flex-start", opacity: "0", animation: `0.5s ease 0.2s both ${v.actsName}` }}>
              <span style={{ width: "18px", height: "18px", border: "1px solid var(--color-bg)", display: "grid", placeItems: "center", flex: "none", marginTop: "1px" }}>
                <svg data-anim="1" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--color-bg)" strokeWidth="2.5" aria-hidden style={{ transformOrigin: "center", transform: "scale(0)", animation: `0.3s ease 0.7s both ${v.popName}` }}>
                  <path d="M4 12l5 5L20 6" />
                </svg>
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: "500" }}>
                  {"Demand loaded"}
                </span>
                <span style={{ fontSize: "12px", lineHeight: "1.4", color: "var(--color-accent-100)" }}>
                  {"The corridor’s synthetic morning demand"}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ display: "flex", gap: "12px", alignItems: "flex-start", opacity: "0", animation: `0.5s ease 1.0s both ${v.actsName}` }}>
              <span style={{ width: "18px", height: "18px", border: "1px solid var(--color-bg)", display: "grid", placeItems: "center", flex: "none", marginTop: "1px" }}>
                <svg data-anim="1" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--color-bg)" strokeWidth="2.5" aria-hidden style={{ transformOrigin: "center", transform: "scale(0)", animation: `0.3s ease 1.5s both ${v.popName}` }}>
                  <path d="M4 12l5 5L20 6" />
                </svg>
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: "500" }}>
                  {"Baseline complete"}
                </span>
                <span style={{ fontSize: "12px", lineHeight: "1.4", color: "var(--color-accent-100)" }}>
                  {"The morning rush as the street is today"}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ display: "flex", gap: "12px", alignItems: "flex-start", opacity: "0", animation: `0.5s ease 1.8s both ${v.actsName}` }}>
              <span style={{ width: "18px", height: "18px", border: "1px solid var(--color-bg)", display: "grid", placeItems: "center", flex: "none", marginTop: "1px" }}>
                <svg data-anim="1" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--color-bg)" strokeWidth="2.5" aria-hidden style={{ transformOrigin: "center", transform: "scale(0)", animation: `0.3s ease 2.3s both ${v.popName}` }}>
                  <path d="M4 12l5 5L20 6" />
                </svg>
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: "500" }}>
                  {"Your change applied"}
                </span>
                <span style={{ fontSize: "12px", lineHeight: "1.4", color: "var(--color-accent-100)" }}>
                  {"Read back from the simulator as in force, not assumed"}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ display: "flex", gap: "12px", alignItems: "flex-start", opacity: "0", animation: `0.5s ease 2.6s both ${v.actsName}` }}>
              <span style={{ width: "18px", height: "18px", border: "1px solid var(--color-bg)", display: "grid", placeItems: "center", flex: "none", marginTop: "1px" }}>
                <svg data-anim="1" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--color-bg)" strokeWidth="2.5" aria-hidden style={{ transformOrigin: "center", transform: "scale(0)", animation: `0.3s ease 3.1s both ${v.popName}` }}>
                  <path d="M4 12l5 5L20 6" />
                </svg>
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: "500" }}>
                  {"Change withdrawn and verified"}
                </span>
                <span style={{ fontSize: "12px", lineHeight: "1.4", color: "var(--color-accent-100)" }}>
                  {"Permissions and speed limit compared per lane against the capture taken before it went in"}
                </span>
              </span>
            </div>
          </div>
          <div data-anim="1" style={{ margin: "6px 0", padding: "12px 14px", border: "1px solid var(--color-accent-300)", display: "flex", gap: "12px", alignItems: "baseline", flexWrap: "wrap", opacity: "0", animation: `0.5s ease 3.6s both ${v.actsName}` }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-300)", whiteSpace: "nowrap" }}>
              {"RESULTS COMPLETE"}
            </span>
            <span style={{ fontSize: "13px", lineHeight: "1.45" }}>
              {"The figures and the scorecard come from the simulator. They are readable now. Nothing below is required."}
            </span>
          </div>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-300)" }}>
            {"ACT II · THE INTERPRETATION · OPTIONAL"}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div data-anim="1" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 10px", border: "1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)", opacity: "0", animation: `0.45s ease 4.3s both ${v.actsName}` }}>
              <span style={{ width: "7px", height: "7px", background: "var(--color-accent-300)", flex: "none" }} />
              <span style={{ fontSize: "13px" }}>
                {"A driver on Lawrence Ave E, westbound"}
              </span>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--color-accent-100)", whiteSpace: "nowrap" }}>
                {"one voice, one trip"}
              </span>
            </div>
            <div data-anim="1" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 10px", border: "1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)", opacity: "0", animation: `0.45s ease 5.0s both ${v.actsName}` }}>
              <span style={{ width: "7px", height: "7px", background: "var(--color-accent-300)", flex: "none" }} />
              <span style={{ fontSize: "13px" }}>
                {"A cyclist heading east through the closure"}
              </span>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--color-accent-100)", whiteSpace: "nowrap" }}>
                {"one voice, one trip"}
              </span>
            </div>
            <div data-anim="1" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 10px", border: "1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)", opacity: "0", animation: `0.45s ease 5.7s both ${v.actsName}` }}>
              <span style={{ width: "7px", height: "7px", background: "var(--color-accent-300)", flex: "none" }} />
              <span style={{ fontSize: "13px" }}>
                {"A pedestrian crossing at the detour's end"}
              </span>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--color-accent-100)", whiteSpace: "nowrap" }}>
                {"one voice, one trip"}
              </span>
            </div>
            <div data-anim="1" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 10px", border: "1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)", opacity: "0", animation: `0.45s ease 6.4s both ${v.actsName}` }}>
              <span style={{ width: "7px", height: "7px", background: "var(--color-accent-300)", flex: "none" }} />
              <span style={{ fontSize: "13px" }}>
                {"Toronto Fire Services"}
              </span>
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--color-accent-100)", whiteSpace: "nowrap" }}>
                {"quotes its own mandate, zero model calls"}
              </span>
            </div>
          </div>
          <div data-anim="1" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginTop: "4px", opacity: "0", animation: `0.45s ease 4.3s both ${v.actsName}` }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
              <span data-anim="1" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--color-accent-300)", animation: "nadi-pulse 1.2s ease-in-out infinite" }} />
              {"Voices landed "}
              <strong style={{ fontFamily: "var(--font-heading)", fontSize: "16px", fontWeight: "600" }}>
                {v.voices}
              </strong>
              {" / 212 · every model call metered live"}
            </span>
            <span className="btn" style={{ border: "1px solid color-mix(in srgb, var(--color-bg) 55%, transparent)", color: "var(--color-bg)", fontSize: "13px", padding: "6px 12px", cursor: "default" }}>
              {"Stop interpretation"}
            </span>
          </div>
          <div data-anim="1" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "4px", paddingTop: "12px", borderTop: "1px solid color-mix(in srgb, var(--color-bg) 25%, transparent)", opacity: "0", animation: `0.45s ease 7.6s both ${v.actsName}` }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-300)", marginRight: "6px" }}>
              {"EXPLORE"}
            </span>
            <span className="btn" style={{ border: "1px solid color-mix(in srgb, var(--color-bg) 55%, transparent)", color: "var(--color-bg)", fontSize: "12px", padding: "5px 10px", cursor: "default" }}>
              {"Compare with another run"}
            </span>
            <span className="btn" style={{ border: "1px solid color-mix(in srgb, var(--color-bg) 55%, transparent)", color: "var(--color-bg)", fontSize: "12px", padding: "5px 10px", cursor: "default" }}>
              {"Interview a voice"}
            </span>
            <span className="btn" style={{ border: "1px solid color-mix(in srgb, var(--color-bg) 55%, transparent)", color: "var(--color-bg)", fontSize: "12px", padding: "5px 10px", cursor: "default" }}>
              {"Put four voices in a room"}
            </span>
          </div>
        </div>
      </div>
    </section>
    <section id="findings" data-screen-label="Landing 03 findings" style={{ position: "relative", backgroundColor: "var(--color-bg)", backgroundImage: "linear-gradient(color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px)", backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px", backgroundPosition: "center top" }}>
      <div style={{ position: "relative", maxWidth: "1200px", margin: "0 auto", boxSizing: "border-box", padding: "96px clamp(20px, 5vw, 72px) 96px" }}>
        <div aria-hidden style={{ position: "absolute", top: "28px", right: "clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "auto auto", border: "1px solid var(--color-neutral-500)", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", lineHeight: "1", color: "var(--color-neutral-700)", background: "var(--color-bg)" }}>
          <span style={{ padding: "6px 10px", borderRight: "1px solid var(--color-neutral-500)" }}>
            {"SHEET"}
          </span>
          <span style={{ padding: "6px 10px", fontWeight: "600", color: "var(--color-text)" }}>
            {"03 / 05"}
          </span>
        </div>
        <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-700)", marginBottom: "14px" }}>
          {"03 · Three things it computed"}
        </span>
        <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "clamp(34px, 4.5vw, 56px)", lineHeight: "1", textTransform: "uppercase", letterSpacing: "0.01em", margin: "0 0 20px", maxWidth: "20ch" }}>
          {"Numbers, with their caveats riding along."}
        </h2>
        <p style={{ fontSize: "16px", lineHeight: "1.6", maxWidth: "62ch", margin: "0 0 40px", color: "var(--color-neutral-800)" }}>
          {"Three figures from the study corridor, each carrying the condition it was measured under."}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "24px" }}>
          <div className="blueprint" data-anim="1" style={{ background: "var(--color-bg)", display: "flex", flexDirection: "column", opacity: "0", animation: `0.6s ease 0.05s both ${v.inFindings}` }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <span style={{ padding: "20px 20px 0", fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
              {"A FIRE STATION’S STREET, CLOSED"}
            </span>
            <svg viewBox="0 0 320 190" style={{ width: "100%", height: "auto", display: "block", marginTop: "12px" }} aria-hidden>
              <defs>
                <pattern id="nadi-g1" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="var(--color-neutral-200)" strokeWidth="1" />
                </pattern>
                <pattern id="nadi-h1" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="2.5" height="6" fill="var(--color-bg)" opacity="0.85" />
                </pattern>
              </defs>
              <rect width="320" height="190" fill="url(#nadi-g1)" />
              <line x1="30" y1="100" x2="290" y2="100" stroke="var(--color-accent-900)" strokeWidth="10" strokeLinecap="square" />
              <line x1="30" y1="160" x2="290" y2="160" stroke="var(--color-accent-900)" strokeWidth="10" strokeLinecap="square" />
              <line x1="30" y1="100" x2="30" y2="160" stroke="var(--color-accent-900)" strokeWidth="10" />
              <line x1="290" y1="100" x2="290" y2="160" stroke="var(--color-accent-900)" strokeWidth="10" />
              <line x1="260" y1="36" x2="260" y2="100" stroke="var(--color-accent-900)" strokeWidth="10" />
              <line x1="160" y1="36" x2="160" y2="100" stroke="var(--color-accent-900)" strokeWidth="10" />
              <rect x="120" y="95" width="80" height="10" fill="url(#nadi-h1)" />
              <line x1="120" y1="92" x2="120" y2="108" stroke="var(--color-bg)" strokeWidth="2" />
              <line x1="200" y1="92" x2="200" y2="108" stroke="var(--color-bg)" strokeWidth="2" />
              <path d="M154 78l12 12M166 78l-12 12" stroke="var(--color-bg)" strokeWidth="2.5" />
              <polyline data-anim="1" points="260,36 260,100 290,100" fill="none" stroke="var(--color-accent-300)" strokeWidth="3" strokeLinejoin="round" style={{ strokeDasharray: "94", strokeDashoffset: "94", animation: `6s ease-in-out 0.4s infinite both ${v.drawShort}` }} />
              <polyline data-anim="1" points="260,36 260,100 290,100 290,160 30,160 30,100" fill="none" stroke="var(--color-accent-300)" strokeWidth="3" strokeLinejoin="round" style={{ strokeDasharray: "474", strokeDashoffset: "474", animation: `6s ease-in-out 0.4s infinite both ${v.drawLong}` }} />
              <rect x="153" y="22" width="14" height="14" fill="var(--color-bg)" stroke="var(--color-text)" strokeWidth="1.5" />
              <path d="M160 25v8M156 29h8" stroke="var(--color-text)" strokeWidth="1.5" />
              <rect x="253" y="22" width="14" height="14" fill="var(--color-bg)" stroke="var(--color-text)" strokeWidth="1.5" />
              <path d="M260 25v8M256 29h8" stroke="var(--color-text)" strokeWidth="1.5" />
              <text x="160" y="14" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"STATION 231"}
              </text>
              <text x="260" y="14" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"ANOTHER STATION"}
              </text>
              <text x="160" y="124" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"NO ROUTE IN WINDOW"}
              </text>
              <text x="26" y="90" textAnchor="start" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"WEST END"}
              </text>
              <text x="294" y="90" textAnchor="end" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"EAST END"}
              </text>
              <text x="246" y="72" textAnchor="end" fontFamily="var(--font-heading)" fontWeight="600" fontSize="14" fill="var(--color-accent-700)">
                {"+1.7 s"}
              </text>
              <text x="40" y="150" textAnchor="start" fontFamily="var(--font-heading)" fontWeight="600" fontSize="14" fill="var(--color-accent-700)">
                {"+29.1 s"}
              </text>
            </svg>
            <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", flex: "1" }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "56px", lineHeight: "1" }}>
                  {"+"}
                  {v.fa}
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: "22px" }}>
                  {"s"}
                </span>
                <span style={{ fontSize: "11px", letterSpacing: "0.12em", color: "var(--color-neutral-600)", marginLeft: "6px" }}>
                  {"ADDED RESPONSE TIME, WORST END"}
                </span>
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--color-neutral-800)" }}>
                {"Worst added time for a fire truck to reach the west end of the closed street, routed free-flow from four real Toronto Fire stations, among those that can still reach it."}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"East end: +1.7 s, because a route survives via the street’s other direction. Station 231 itself: no route computable during the window. Labeled per end, never averaged in."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <span>
                  {"Caveat: free-flow routing, a lower bound. Not a dispatch simulation, and no claim about which station would respond."}
                </span>
              </span>
            </div>
          </div>
          <div className="blueprint" data-anim="1" style={{ background: "var(--color-bg)", display: "flex", flexDirection: "column", opacity: "0", animation: `0.6s ease 0.15s both ${v.inFindings}` }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <span style={{ padding: "20px 20px 0", fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
              {"A SCHOOL ZONE AT BELL TIME"}
            </span>
            <svg viewBox="0 0 320 190" style={{ width: "100%", height: "auto", display: "block", marginTop: "12px" }} aria-hidden>
              <defs>
                <pattern id="nadi-g2" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="var(--color-neutral-200)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="320" height="190" fill="url(#nadi-g2)" />
              <rect x="56" y="30" width="208" height="26" fill="var(--color-accent-200)" opacity="0.55" />
              <line x1="56" y1="30" x2="264" y2="30" stroke="var(--color-accent-700)" strokeWidth="1" strokeDasharray="4 3" />
              <line x1="56" y1="56" x2="264" y2="56" stroke="var(--color-accent-700)" strokeWidth="1" strokeDasharray="4 3" />
              <text x="160" y="22" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-accent-700)">
                {"RUN-TO-RUN VARIATION"}
              </text>
              <rect data-anim="1" x="80" y="40" width="56" height="110" fill="none" stroke="var(--color-accent-900)" strokeWidth="1.5" style={{ transformBox: "fill-box", transformOrigin: "50% 100%", transform: "scaleY(0)", animation: `6s cubic-bezier(.2,.7,.2,1) 0.3s infinite both ${v.growName}` }} />
              <rect data-anim="1" x="184" y="47" width="56" height="103" fill="var(--color-accent-700)" style={{ transformBox: "fill-box", transformOrigin: "50% 100%", transform: "scaleY(0)", animation: `6s cubic-bezier(.2,.7,.2,1) 0.5s infinite both ${v.growName}` }} />
              <line x1="40" y1="150" x2="280" y2="150" stroke="var(--color-text)" strokeWidth="1" />
              <text x="108" y="72" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="26" fill="var(--color-text)">
                {v.fb}
              </text>
              <text x="212" y="78" textAnchor="middle" fontFamily="var(--font-heading)" fontWeight="600" fontSize="26" fill="var(--color-bg)">
                {v.fc}
              </text>
              <text x="108" y="170" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"WITHOUT"}
              </text>
              <text x="212" y="170" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"WITH 30 KM/H WINDOW"}
              </text>
            </svg>
            <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", flex: "1" }}>
              <span style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: "6px", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.14em", color: "var(--color-accent-700)", border: "1px solid var(--color-accent-300)", padding: "5px 10px" }}>
                {"DIRECTION: NOT CLAIMED"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--color-neutral-800)" }}>
                {"Pedestrian-vehicle crossing conflicts near the zone, without and with a 30 km/h window at bell time: "}
                {v.fb}
                {" against "}
                {v.fc}
                {"."}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"The tool refuses to read this pair as a direction, and says so next to the numbers."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <span>
                  {"Caveat: single-seed counts. At these small event counts the difference sits within run-to-run variation. The population is pedestrian entities from calibrated demand, not modeled schoolchildren."}
                </span>
              </span>
            </div>
          </div>
          <div className="blueprint" data-anim="1" style={{ background: "var(--color-bg)", display: "flex", flexDirection: "column", opacity: "0", animation: `0.6s ease 0.25s both ${v.inFindings}` }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <span style={{ padding: "20px 20px 0", fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
              {"THE CORRIDOR SATURATES"}
            </span>
            <svg viewBox="0 0 320 190" style={{ width: "100%", height: "auto", display: "block", marginTop: "12px" }} aria-hidden>
              <defs>
                <pattern id="nadi-g3" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="var(--color-neutral-200)" strokeWidth="1" />
                </pattern>
                <pattern id="nadi-h3" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="2" height="6" fill="var(--color-accent-500)" />
                </pattern>
              </defs>
              <rect width="320" height="190" fill="url(#nadi-g3)" />
              <polygon points="40,104 90,70 140,52 190,46 240,56 290,70 290,90 240,84 190,80 140,86 90,96 40,112" fill="url(#nadi-h3)" opacity="0.5" />
              <polyline data-anim="1" points="40,104 90,70 140,52 190,46 240,56 290,70" fill="none" stroke="var(--color-accent-900)" strokeWidth="2.5" strokeLinejoin="round" style={{ strokeDasharray: "300", strokeDashoffset: "300", animation: `6s ease-in-out 0.3s infinite both ${v.drawIn}` }} />
              <polyline data-anim="1" points="40,112 90,96 140,86 190,80 240,84 290,90" fill="none" stroke="var(--color-accent-500)" strokeWidth="2.5" strokeLinejoin="round" style={{ strokeDasharray: "300", strokeDashoffset: "300", animation: `6s ease-in-out 0.3s infinite both ${v.drawOut}` }} />
              <text x="165" y="36" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-accent-900)">
                {"INFLOW"}
              </text>
              <text x="165" y="102" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-accent-700)">
                {"OUTFLOW"}
              </text>
              <text x="40" y="128" textAnchor="start" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"07:00"}
              </text>
              <text x="165" y="128" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"08:00"}
              </text>
              <text x="290" y="128" textAnchor="end" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"09:00"}
              </text>
              <rect x="40" y="148" width="250" height="12" fill="var(--color-neutral-200)" />
              <rect x="252" y="148" width="38" height="12" fill="url(#nadi-h3)" opacity="0.6" />
              <rect x="40" y="148" width={v.fdW} height="12" fill="var(--color-accent-900)" />
              <line x1="252" y1="142" x2="252" y2="166" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeDasharray="3 2" />
              <text x="40" y="178" textAnchor="start" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-700)">
                {"DELIVERED BY 09:00"}
              </text>
              <text x="252" y="178" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-accent-700)">
                {"TEXTBOOK 85%"}
              </text>
            </svg>
            <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", flex: "1" }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: "4px", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "56px", lineHeight: "1" }}>
                  {v.fd}
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: "22px" }}>
                  {"%"}
                </span>
                <span style={{ fontSize: "11px", letterSpacing: "0.12em", color: "var(--color-neutral-600)", marginLeft: "8px" }}>
                  {"OF MORNING DEMAND DELIVERED"}
                </span>
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--color-neutral-800)" }}>
                {"Delivered by 09:00. Inflow exceeds outflow for the whole peak window, so the queue never clears."}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"The calibration is reported with the same discipline: GEH under 5 on "}
                {v.fe}
                {"% of 421 links."}
                <span style={{ display: "block", height: "6px", background: "var(--color-neutral-200)", marginTop: "8px" }}>
                  <span style={{ display: "block", height: "100%", width: v.feW, background: "var(--color-accent-700)" }} />
                </span>
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <span>
                  {"Caveat: the textbook 85% is unreachable on a boundary-clipped extract. Nadi records that instead of tuning until the number flatters it."}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section id="thesis" data-screen-label="Landing thesis interlude" style={{ position: "relative", overflow: "hidden", background: "var(--color-accent-900)", color: "var(--color-bg)" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "96px clamp(20px, 5vw, 72px) 0", boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-300)", marginBottom: "18px" }}>
          {"The thesis"}
        </span>
        <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "clamp(40px, 6.4vw, 88px)", lineHeight: "0.98", textTransform: "uppercase", letterSpacing: "0.01em", margin: "0", color: "var(--color-bg)" }}>
          <span style={{ display: "block" }}>
            {"The tool arranges evidence."}
          </span>
          <span style={{ display: "block", color: "var(--color-accent-300)" }}>
            {"The planner concludes."}
          </span>
        </h2>
        <p style={{ fontSize: "16px", lineHeight: "1.6", maxWidth: "56ch", margin: "24px auto 0", color: "var(--color-accent-100)" }}>
          {"Nadi never votes. It shows who is reached, by how much, and what each of them would say, then leaves the room."}
        </p>
      </div>
      <div style={{ position: "relative", height: "104px", marginTop: "48px" }}>
        <div style={{ position: "absolute", left: "0", right: "0", bottom: "28px", height: "1px", background: "color-mix(in srgb, var(--color-bg) 45%, transparent)" }} />
        {v.parade}
      </div>
    </section>
    <section id="honesty" data-screen-label="Landing 04 honesty" style={{ position: "relative", backgroundColor: "var(--color-bg)", backgroundImage: "linear-gradient(color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px)", backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px", backgroundPosition: "center top" }}>
      <div style={{ position: "relative", maxWidth: "1200px", margin: "0 auto", boxSizing: "border-box", padding: "96px clamp(20px, 5vw, 72px) 96px" }}>
        <div aria-hidden style={{ position: "absolute", top: "28px", right: "clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "auto auto", border: "1px solid var(--color-neutral-500)", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", lineHeight: "1", color: "var(--color-neutral-700)", background: "var(--color-bg)" }}>
          <span style={{ padding: "6px 10px", borderRight: "1px solid var(--color-neutral-500)" }}>
            {"SHEET"}
          </span>
          <span style={{ padding: "6px 10px", fontWeight: "600", color: "var(--color-text)" }}>
            {"04 / 05"}
          </span>
        </div>
        <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-700)", marginBottom: "14px" }}>
          {"04 · Honesty as architecture"}
        </span>
        <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "clamp(34px, 4.5vw, 56px)", lineHeight: "1", textTransform: "uppercase", letterSpacing: "0.01em", margin: "0 0 20px", maxWidth: "22ch" }}>
          {"Built so it cannot become a confident liar."}
        </h2>
        <p style={{ fontSize: "16px", lineHeight: "1.6", maxWidth: "62ch", margin: "0 0 40px", color: "var(--color-neutral-800)" }}>
          {"A simulator plus a language model is an easy way to build something very sure of itself, so every honesty property here is structural: enforced by code and tests, not by asking the model nicely."}
        </p>
        <div className="blueprint" id="strike" style={{ background: "var(--color-bg)", padding: "28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "32px", alignItems: "start" }}>
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
              {"WHAT IT WILL NEVER SAY"}
            </span>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(26px, 3.6vw, 40px)", lineHeight: "1.15", color: "var(--color-neutral-600)" }}>
              <span data-anim="1" style={{ backgroundImage: "linear-gradient(var(--color-accent), var(--color-accent))", backgroundRepeat: "no-repeat", backgroundPosition: "0 56%", backgroundSize: "0% 3px", WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone", animation: `0.7s ease 0.5s both ${v.strikeName}` }}>
                {"“62% of residents support the change.”"}
              </span>
            </span>
            <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
              {"No tallies, averages or winners. A banned-language sweep in 24 of 36 Playwright suites, plus a Python sweep, fails the test suite on tally language."}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
              {"WHAT IT SAYS INSTEAD"}
            </span>
            <div data-anim="1" style={{ display: "flex", flexWrap: "wrap", gap: "3px", opacity: "0", animation: `0.8s ease 0.3s both ${v.inHonesty}` }}>
              {v.voiceDots}
            </div>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(20px, 2.4vw, 26px)", lineHeight: "1.15" }}>
              {"212 voices, each one person’s anticipated reaction to their own measured trip. A conversation preview, not a poll."}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: "11px", letterSpacing: "0.06em", color: "var(--color-neutral-700)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: "9px", height: "9px", background: "var(--color-accent-900)" }} />
                {"Drivers"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: "9px", height: "9px", background: "var(--color-accent-600)" }} />
                {"Cyclists"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: "9px", height: "9px", background: "var(--color-accent-400)" }} />
                {"Pedestrians"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: "9px", height: "9px", background: "var(--color-accent-200)", border: "1px solid var(--color-accent-400)", boxSizing: "border-box" }} />
                {"Transit riders"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: "9px", height: "9px", background: "var(--color-neutral-400)" }} />
                {"Residents and businesses"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <i style={{ width: "9px", height: "9px", border: "1px solid var(--color-text)", boxSizing: "border-box" }} />
                {"Institutions, zero model calls"}
              </span>
            </div>
            <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
              {"Read it like a consultation room, not a ballot box. The grouping above is illustrative; no total is ever drawn from it."}
            </span>
          </div>
        </div>
        <div id="gates" style={{ marginTop: "32px" }}>
          <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-700)", marginBottom: "14px" }}>
            {"Six guards, all structural"}
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "1px", background: "var(--color-divider)", border: "1px solid var(--color-divider)" }}>
            <div data-anim="1" style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", opacity: "0", animation: `0.5s ease 0.05s both ${v.inGates}` }}>
              <div style={{ position: "relative", minHeight: "128px", border: "1px solid var(--color-divider)", boxSizing: "border-box", backgroundImage: "radial-gradient(var(--color-neutral-400) 1.3px, transparent 1.4px)", backgroundSize: "12px 12px", backgroundPosition: "6px 6px" }}>
                <span style={{ position: "absolute", left: "18%", top: "32%", width: "14px", height: "14px", border: "2px solid var(--color-accent-700)", background: "var(--color-bg)", boxSizing: "border-box", transform: "translate(-50%, -50%)" }} />
                <span style={{ position: "absolute", left: "41%", top: "66%", width: "14px", height: "14px", border: "2px solid var(--color-accent-700)", background: "var(--color-bg)", boxSizing: "border-box", transform: "translate(-50%, -50%)" }} />
                <span style={{ position: "absolute", left: "57%", top: "24%", width: "14px", height: "14px", border: "2px solid var(--color-accent-700)", background: "var(--color-bg)", boxSizing: "border-box", transform: "translate(-50%, -50%)" }} />
                <span style={{ position: "absolute", left: "74%", top: "58%", width: "14px", height: "14px", border: "2px solid var(--color-accent-700)", background: "var(--color-bg)", boxSizing: "border-box", transform: "translate(-50%, -50%)" }} />
                <span style={{ position: "absolute", left: "88%", top: "42%", width: "14px", height: "14px", border: "2px solid var(--color-accent-700)", background: "var(--color-bg)", boxSizing: "border-box", transform: "translate(-50%, -50%)" }} />
                <span style={{ position: "absolute", left: "8px", bottom: "6px", fontSize: "10px", letterSpacing: "0.12em", color: "var(--color-neutral-700)", background: "var(--color-bg)", padding: "0 4px" }}>
                  {"67,000 MOVE AS PHYSICS"}
                </span>
                <span style={{ position: "absolute", right: "8px", bottom: "6px", fontSize: "10px", letterSpacing: "0.12em", color: "var(--color-accent-700)", background: "var(--color-bg)", padding: "0 4px" }}>
                  {"212 SPEAK"}
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Physics for everyone, voices for a few"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.55", color: "var(--color-neutral-700)" }}>
                {"SUMO moves all 67,000 travelers; only a few hundred sampled personas reason, each pinned to its own measured trip."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                <span>
                  {"Not: a language model per vehicle."}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", opacity: "0", animation: `0.5s ease 0.1s both ${v.inGates}` }}>
              <svg viewBox="0 0 200 116" style={{ width: "100%", height: "128px", display: "block", minHeight: "128px", border: "1px solid var(--color-divider)", boxSizing: "border-box" }} aria-hidden>
                <path d="M20 96 A80 80 0 0 1 180 96" fill="none" stroke="var(--color-neutral-300)" strokeWidth="10" />
                <path d="M20 96 A80 80 0 0 1 180 96" fill="none" stroke="var(--color-accent-700)" strokeWidth="10" strokeDasharray="151 260" />
                <line x1="100" y1="96" x2="121" y2="32" stroke="var(--color-text)" strokeWidth="2" />
                <circle cx="100" cy="96" r="4" fill="var(--color-text)" />
                <text x="100" y="80" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-accent-700)">
                  {"MAGNITUDE"}
                </text>
                <text x="24" y="112" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-600)">
                  {"WORSE"}
                </text>
                <line x1="6" y1="108" x2="42" y2="108" stroke="var(--color-accent)" strokeWidth="2" />
                <text x="176" y="112" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="10" letterSpacing="0.12em" fill="var(--color-neutral-600)">
                  {"SAFER"}
                </text>
                <line x1="158" y1="108" x2="194" y2="108" stroke="var(--color-accent)" strokeWidth="2" />
              </svg>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Safety is a surrogate, never a crash count"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.55", color: "var(--color-neutral-700)" }}>
                {"Near-miss measures from trajectories (time-to-collision, hard braking, blocked junctions), shown as a magnitude only."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                <span>
                  {"Not: a crash prediction, or a claimed direction."}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", opacity: "0", animation: `0.5s ease 0.15s both ${v.inGates}` }}>
              <div style={{ minHeight: "128px", border: "1px solid var(--color-divider)", boxSizing: "border-box", padding: "10px", display: "grid", gridTemplateColumns: "1fr 46px 46px 46px auto", gridAutoRows: "20px", gap: "2px", alignItems: "center", fontSize: "10px", letterSpacing: "0.06em", color: "var(--color-neutral-700)" }}>
                <span />
                <span style={{ textAlign: "center" }}>
                  {"TIME"}
                </span>
                <span style={{ textAlign: "center" }}>
                  {"SAFETY"}
                </span>
                <span style={{ textAlign: "center" }}>
                  {"ACCESS"}
                </span>
                <span />
                <span style={{ gridColumn: "5", gridRow: "2 / span 4", alignSelf: "center", marginLeft: "12px", fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "30px", lineHeight: "1", color: "var(--color-neutral-500)", textDecoration: "line-through", textDecorationColor: "var(--color-accent)", textDecorationThickness: "3px" }}>
                  {"7.4"}
                  <span style={{ fontSize: "12px", fontWeight: "400" }}>
                    {"/10"}
                  </span>
                </span>
                <span>
                  {"DRIVERS"}
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"+"}
                </span>
                <span style={{ height: "18px", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", padding: "0 4px", boxSizing: "border-box" }}>
                  <i style={{ display: "block", height: "6px", width: "60%", background: "var(--color-accent-500)" }} />
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"·"}
                </span>
                <span>
                  {"CYCLISTS"}
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"−"}
                </span>
                <span style={{ height: "18px", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", padding: "0 4px", boxSizing: "border-box" }}>
                  <i style={{ display: "block", height: "6px", width: "35%", background: "var(--color-accent-500)" }} />
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"+"}
                </span>
                <span>
                  {"PEDESTRIANS"}
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"·"}
                </span>
                <span style={{ height: "18px", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", padding: "0 4px", boxSizing: "border-box" }}>
                  <i style={{ display: "block", height: "6px", width: "50%", background: "var(--color-accent-500)" }} />
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"+"}
                </span>
                <span>
                  {"FIRE"}
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"+"}
                </span>
                <span style={{ height: "18px", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", padding: "0 4px", boxSizing: "border-box" }}>
                  <i style={{ display: "block", height: "6px", width: "20%", background: "var(--color-accent-500)" }} />
                </span>
                <span style={{ height: "18px", display: "grid", placeItems: "center", border: "1px solid var(--color-divider)", fontFamily: "var(--font-heading)", fontSize: "14px", color: "var(--color-text)" }}>
                  {"−"}
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"A scorecard, not a score"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.55", color: "var(--color-neutral-700)" }}>
                {"Travel time, safety surrogate and access, per stakeholder group."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                <span>
                  {"Not: a return on investment, an aggregate or a verdict."}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", opacity: "0", animation: `0.5s ease 0.2s both ${v.inGates}` }}>
              <div style={{ minHeight: "128px", border: "1px solid var(--color-divider)", boxSizing: "border-box", padding: "14px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "34px", lineHeight: "1" }}>
                    {"+29.1 s"}
                  </span>
                  <span style={{ flex: "1", height: "1px", background: "var(--color-accent-700)", minWidth: "16px" }} />
                  <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>
                    {"FREE-FLOW LOWER BOUND"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "monospace", fontSize: "11px", padding: "3px 8px", border: "1px solid var(--color-accent-300)", color: "var(--color-accent-900)" }}>
                    {"audit_prose "}
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "monospace", fontSize: "11px", padding: "3px 8px", border: "1px solid var(--color-accent-300)", color: "var(--color-accent-900)" }}>
                    {"verify_facts "}
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                </div>
                <span style={{ fontSize: "10px", letterSpacing: "0.12em", color: "var(--color-neutral-700)" }}>
                  {"EVERY RENDERED FIGURE RECOMPUTED FROM THE RUN’S ARTIFACT"}
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Numbers carry their own caveats"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.55", color: "var(--color-neutral-700)" }}>
                {"audit_prose strips digits, safety direction and tallies from model prose; verify_facts recomputes every figure from the run’s artifact."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                <span>
                  {"Not: a number without its condition."}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", opacity: "0", animation: `0.5s ease 0.25s both ${v.inGates}` }}>
              <div style={{ minHeight: "128px", border: "1px solid var(--color-divider)", boxSizing: "border-box", padding: "14px", display: "flex", flexDirection: "column", gap: "10px", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "stretch", gap: "8px", flexWrap: "wrap" }}>
                  <span className="btn btn-primary blueprint" style={{ borderRadius: "0", fontSize: "13px", padding: "8px 14px", cursor: "default", pointerEvents: "none" }}>
                    <i className="corner tl" />
                    <i className="corner tr" />
                    <i className="corner bl" />
                    <i className="corner br" />
                    {"Run composite"}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", padding: "6px 12px", border: "1px dashed var(--color-accent-700)", fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.12em", color: "var(--color-accent-700)" }}>
                    {"PROJECTED MODEL CALLS"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "11px", color: "var(--color-neutral-700)", flexWrap: "wrap" }}>
                  <span className="btn btn-secondary" style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "0", cursor: "default", pointerEvents: "none" }}>
                    {"Stop"}
                  </span>
                  <span>
                    {"stop any time; what landed stays"}
                  </span>
                </div>
              </div>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"You consent to the spend first"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.55", color: "var(--color-neutral-700)" }}>
                {"The Run button states its model-call cost up front, pinned to never understate; stop any time and keep what landed."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                <span>
                  {"Not: a run you cannot stop, or a cost you learn afterwards."}
                </span>
              </span>
            </div>
            <div data-anim="1" style={{ background: "var(--color-bg)", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", opacity: "0", animation: `0.5s ease 0.3s both ${v.inGates}` }}>
              <div style={{ minHeight: "128px", border: "1px solid var(--color-divider)", boxSizing: "border-box", padding: "12px 14px", display: "grid", gridTemplateColumns: "auto 1fr", gap: "0 12px", alignContent: "start" }}>
                <span style={{ gridRow: "1 / span 3", fontFamily: "var(--font-heading)", fontSize: "56px", lineHeight: "0.8", color: "var(--color-accent-300)" }}>
                  {"“"}
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: "16px" }}>
                  {"Toronto Fire Services"}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                  <i style={{ display: "block", height: "5px", width: "100%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                  <i style={{ display: "block", height: "5px", width: "88%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                  <i style={{ display: "block", height: "5px", width: "64%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                </span>
                <span style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
                  <span className="tag tag-accent">
                    {"0 MODEL CALLS"}
                  </span>
                  <span className="tag tag-outline">
                    {"BYTE-PINNED"}
                  </span>
                  <span className="tag tag-outline">
                    {"RETRIEVAL DATE KEPT"}
                  </span>
                </span>
              </div>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "19px", lineHeight: "1.1" }}>
                {"Institutions are never impersonated"}
              </span>
              <span style={{ fontSize: "13px", lineHeight: "1.55", color: "var(--color-neutral-700)" }}>
                {"Toronto Fire Services, the TDSB and Transportation Services speak only their published mandate, byte-pinned, with zero model calls, citing only facts this run computed."}
              </span>
              <span style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-600)", borderTop: "1px solid var(--color-divider)", paddingTop: "10px", marginTop: "auto" }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none", marginTop: "2px" }}>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                <span>
                  {"Not: impersonation. No facts, no voice."}
                </span>
              </span>
            </div>
          </div>
        </div>
        <div id="real" data-anim="1" style={{ marginTop: "32px", display: "flex", flexDirection: "column", gap: "12px", opacity: "0", animation: `0.5s ease 0.05s both ${v.inReal}` }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", color: "var(--color-accent-700)", marginRight: "8px", whiteSpace: "nowrap" }}>
              {"ALSO REAL"}
            </span>
            <span className="tag tag-accent">
              {"Count-calibrated demand from Toronto open data"}
            </span>
            <span className="tag tag-accent">
              {"Four real Toronto Fire station locations"}
            </span>
            <span className="tag tag-accent">
              {"Windowed changes with proof logs"}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", color: "var(--color-accent-700)", marginRight: "8px", whiteSpace: "nowrap" }}>
              {"ALSO NOT"}
            </span>
            <span className="tag tag-outline">
              {"Dispatch simulation: response times are free-flow lower bounds"}
            </span>
            <span className="tag tag-outline">
              {"Region-scale claims: bounded to one corridor"}
            </span>
          </div>
        </div>
        <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", color: "var(--color-accent-700)", marginRight: "8px" }}>
            {"UNDER THE HOOD"}
          </span>
          <span className="tag tag-outline">
            {"SUMO 1.27 + TraCI"}
          </span>
          <span className="tag tag-outline">
            {"FastAPI"}
          </span>
          <span className="tag tag-outline">
            {"DeepSeek + Groq"}
          </span>
          <span className="tag tag-outline">
            {"LightRAG"}
          </span>
          <span className="tag tag-outline">
            {"OASIS / CAMEL"}
          </span>
          <span className="tag tag-outline">
            {"networkx"}
          </span>
          <span className="tag tag-outline">
            {"Next.js + TypeScript"}
          </span>
          <span className="tag tag-outline">
            {"deck.gl + MapLibre"}
          </span>
          <span className="tag tag-outline">
            {"trajectory contract v0.10.0"}
          </span>
        </div>
      </div>
    </section>
    <section id="demo" data-screen-label="Landing 05 demo" style={{ borderTop: "1px solid var(--color-divider)", position: "relative", backgroundColor: "var(--color-bg)", backgroundImage: "linear-gradient(color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 9%, transparent) 1px, transparent 1px), linear-gradient(color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-text) 4%, transparent) 1px, transparent 1px)", backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px", backgroundPosition: "center top" }}>
      <div style={{ position: "relative", maxWidth: "1200px", margin: "0 auto", boxSizing: "border-box", padding: "96px clamp(20px, 5vw, 72px)" }}>
        <div aria-hidden style={{ position: "absolute", top: "28px", right: "clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "auto auto", border: "1px solid var(--color-neutral-500)", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", lineHeight: "1", color: "var(--color-neutral-700)", background: "var(--color-bg)" }}>
          <span style={{ padding: "6px 10px", borderRight: "1px solid var(--color-neutral-500)" }}>
            {"SHEET"}
          </span>
          <span style={{ padding: "6px 10px", fontWeight: "600", color: "var(--color-text)" }}>
            {"05 / 05"}
          </span>
        </div>
        <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: "13px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-accent-700)", marginBottom: "14px" }}>
          {"05 · See it live"}
        </span>
        <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "clamp(34px, 4.5vw, 56px)", lineHeight: "1", textTransform: "uppercase", letterSpacing: "0.01em", margin: "0 0 20px" }}>
          {"Three stops in the demo."}
        </h2>
        <p style={{ fontSize: "16px", lineHeight: "1.6", maxWidth: "62ch", margin: "0 0 40px", color: "var(--color-neutral-800)" }}>
          {"A read-only replay of finished SUMO runs on the real Toronto corridor; editing, chat and interviews need the local backend, and the demo says so instead of failing quietly."}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "24px" }}>
          <a className="blueprint lh-tile" data-anim="1" href="/app/" style={{ background: "var(--color-bg)", display: "flex", flexDirection: "column", color: "inherit", textDecoration: "none", transition: "background 0.2s", opacity: "0", animation: `0.5s ease 0.05s both ${v.inDemo}` }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div style={{ position: "relative", height: "150px", margin: "12px 12px 0", overflow: "hidden", border: "1px solid var(--color-divider)", backgroundImage: "linear-gradient(var(--color-neutral-200) 1px, transparent 1px), linear-gradient(90deg, var(--color-neutral-200) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
              <div style={{ position: "absolute", left: "14%", right: "14%", top: "14px", bottom: "-2px", background: "var(--color-bg)", border: "1px solid var(--color-neutral-500)", display: "flex", flexDirection: "column", gap: "7px", padding: "12px 14px" }}>
                <i style={{ display: "block", height: "5px", width: "34%", background: "var(--color-accent-700)" }} />
                <i style={{ display: "block", height: "9px", width: "72%", background: "var(--color-text)" }} />
                <i style={{ display: "block", height: "5px", width: "100%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                <i style={{ display: "block", height: "5px", width: "92%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                <i style={{ display: "block", height: "5px", width: "61%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "2px", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "18px", lineHeight: "1" }}>
                    {"+29.1 s"}
                  </span>
                  <span style={{ fontSize: "8px", letterSpacing: "0.1em", color: "var(--color-accent-700)", border: "1px solid var(--color-accent-300)", padding: "1px 5px", whiteSpace: "nowrap" }}>
                    {"FREE-FLOW LOWER BOUND"}
                  </span>
                </div>
                <i style={{ display: "block", height: "5px", width: "84%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
              </div>
            </div>
            <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", flex: "1" }}>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
                {"01 · READ"}
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "26px", lineHeight: "1.05" }}>
                {"The run document"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Closure at the fire station’s doorstep: a three-member composite, abstract first, every number carrying its caveat. Walk the four stages from here."}
              </span>
              <span style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: "var(--color-accent-700)" }}>
                {"Open "}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </div>
          </a>
          <a className="blueprint lh-tile" data-anim="1" href="/app/?run=multimodal-scenario-20260702T044134Z" style={{ background: "var(--color-bg)", display: "flex", flexDirection: "column", color: "inherit", textDecoration: "none", transition: "background 0.2s", opacity: "0", animation: `0.5s ease 0.15s both ${v.inDemo}` }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div style={{ position: "relative", height: "150px", margin: "12px 12px 0", overflow: "hidden", border: "1px solid var(--color-divider)", backgroundImage: "linear-gradient(var(--color-neutral-200) 1px, transparent 1px), linear-gradient(90deg, var(--color-neutral-200) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
              <div style={{ position: "absolute", left: "0", right: "0", top: "58px", height: "14px", background: "var(--color-accent-900)" }} />
              <div style={{ position: "absolute", left: "62%", top: "0", bottom: "0", width: "12px", background: "var(--color-accent-900)" }} />
              <div style={{ position: "absolute", left: "0", right: "0", top: "64px", height: "0", borderTop: "1px dashed color-mix(in srgb, var(--color-bg) 60%, transparent)" }} />
              <span style={{ position: "absolute", left: "12%", top: "61px", width: "8px", height: "8px", background: "var(--color-bg)", border: "1.5px solid var(--color-accent-300)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "24%", top: "63px", width: "8px", height: "8px", background: "var(--color-bg)", border: "1.5px solid var(--color-accent-300)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "50%", top: "61px", width: "8px", height: "8px", background: "var(--color-bg)", border: "1.5px solid var(--color-accent-300)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "80%", top: "63px", width: "8px", height: "8px", background: "var(--color-bg)", border: "1.5px solid var(--color-accent-300)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "90%", top: "61px", width: "8px", height: "8px", background: "var(--color-bg)", border: "1.5px solid var(--color-accent-300)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "calc(62% + 2px)", top: "30px", width: "8px", height: "8px", background: "var(--color-bg)", border: "1.5px solid var(--color-accent-300)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "calc(62% + 2px)", top: "100px", width: "8px", height: "8px", background: "var(--color-bg)", border: "1.5px solid var(--color-accent-300)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "38%", top: "61px", width: "8px", height: "8px", background: "var(--color-accent-300)", border: "1.5px solid var(--color-bg)", boxSizing: "border-box" }} />
              <span style={{ position: "absolute", left: "calc(38% + 12px)", top: "26px", fontSize: "9px", letterSpacing: "0.06em", padding: "3px 6px", background: "var(--color-bg)", border: "1px solid var(--color-text)", whiteSpace: "nowrap" }}>
                {"A driver, westbound · one voice"}
              </span>
              <span style={{ position: "absolute", left: "calc(38% + 4px)", top: "44px", width: "1px", height: "16px", background: "var(--color-text)" }} />
              <div style={{ position: "absolute", left: "10px", right: "10px", bottom: "10px", height: "22px", background: "var(--color-bg)", border: "1px solid var(--color-neutral-500)", display: "flex", alignItems: "center", gap: "8px", padding: "0 8px", boxSizing: "border-box" }}>
                <i style={{ width: "0", height: "0", borderLeft: "7px solid var(--color-text)", borderTop: "4.5px solid transparent", borderBottom: "4.5px solid transparent" }} />
                <i style={{ flex: "1", height: "2px", background: "var(--color-neutral-300)", position: "relative", display: "block" }}>
                  <i style={{ position: "absolute", left: "0", top: "0", height: "100%", width: "42%", background: "var(--color-accent-700)", display: "block" }} />
                </i>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: "10px", letterSpacing: "0.1em" }}>
                  {"07:42"}
                </span>
              </div>
            </div>
            <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", flex: "1" }}>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
                {"02 · WATCH"}
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "26px", lineHeight: "1.05" }}>
                {"The 212-voice run"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Replay the simulated traffic, click a dot to hear its voice, then open Discourse and Graphs."}
              </span>
              <span style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: "var(--color-accent-700)" }}>
                {"Open "}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </div>
          </a>
          <a className="blueprint lh-tile" data-anim="1" href="/app/?run=multimodal-scenario-20260702T044134Z&compare=multimodal-scenario-20260814T063253Z" style={{ background: "var(--color-bg)", display: "flex", flexDirection: "column", color: "inherit", textDecoration: "none", transition: "background 0.2s", opacity: "0", animation: `0.5s ease 0.25s both ${v.inDemo}` }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div style={{ position: "relative", height: "150px", margin: "12px 12px 0", overflow: "hidden", border: "1px solid var(--color-divider)", backgroundImage: "linear-gradient(var(--color-neutral-200) 1px, transparent 1px), linear-gradient(90deg, var(--color-neutral-200) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
              <div style={{ position: "absolute", left: "10px", right: "10px", top: "40px", bottom: "-2px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-neutral-500)", padding: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "9px", letterSpacing: "0.12em", color: "var(--color-accent-700)" }}>
                    {"RUN A"}
                  </span>
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "18px", lineHeight: "1" }}>
                    {"+29.1 s"}
                  </span>
                  <i style={{ display: "block", height: "5px", width: "100%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                  <i style={{ display: "block", height: "5px", width: "80%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                </div>
                <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-neutral-500)", padding: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "9px", letterSpacing: "0.12em", color: "var(--color-accent-700)" }}>
                    {"RUN B"}
                  </span>
                  <i style={{ display: "block", height: "18px", width: "56%", background: "repeating-linear-gradient(45deg, var(--color-neutral-400) 0 3px, transparent 3px 7px)" }} />
                  <i style={{ display: "block", height: "5px", width: "100%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                  <i style={{ display: "block", height: "5px", width: "80%", background: "repeating-linear-gradient(90deg, var(--color-neutral-400) 0 9px, transparent 9px 12px)" }} />
                </div>
              </div>
              <div style={{ position: "absolute", left: "10px", right: "10px", top: "8px", height: "24px", border: "1px solid var(--color-accent-700)", background: "var(--color-bg)", display: "flex", alignItems: "center", gap: "6px", padding: "0 8px", boxSizing: "border-box", fontSize: "9px", letterSpacing: "0.1em", color: "var(--color-accent-900)", whiteSpace: "nowrap", overflow: "hidden" }}>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}>
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
                {"PROVENANCE MISMATCH · FLAGGED"}
              </div>
            </div>
            <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", flex: "1" }}>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
                {"03 · EXPLORE"}
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "26px", lineHeight: "1.05" }}>
                {"Compare two runs"}
              </span>
              <span style={{ fontSize: "14px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Side by side, including the provenance-mismatch guard doing its job on a mismatched pair."}
              </span>
              <span style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "500", color: "var(--color-accent-700)" }}>
                {"Open "}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </div>
          </a>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginTop: "40px" }}>
          <a className="btn btn-primary blueprint" href="/app/" style={{ padding: "10px 18px", fontSize: "15px", borderRadius: "0", gap: "8px" }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            {"Open the live demo"}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </a>
          <a className="btn btn-secondary" href="https://github.com/AzizSyed27/Nadi-GTA-Infrastructure-Impact-Simulator" target="_blank" rel="noopener" style={{ padding: "10px 18px", fontSize: "15px", borderRadius: "0", gap: "8px" }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {"Star on GitHub"}
          </a>
        </div>
        <div className="blueprint" id="run" data-anim="1" style={{ background: "var(--color-bg)", marginTop: "56px", padding: "24px", display: "flex", flexDirection: "column", gap: "20px", opacity: "0", animation: `0.5s ease 0.05s both ${v.inRun}` }}>
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "12px", letterSpacing: "0.16em", color: "var(--color-accent-700)" }}>
              {"RUN IT YOURSELF"}
            </span>
            <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-600)" }}>
              {"Two complete runs ship with the repo, so the map renders before you ever run SUMO."}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: "1px", background: "var(--color-divider)", border: "1px solid var(--color-divider)" }}>
            <div style={{ background: "var(--color-bg)", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", color: "var(--color-accent-700)" }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect width="18" height="11" x="3" y="11" rx="0" />
                  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                </svg>
                {"NO KEYS"}
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "18px", lineHeight: "1.1" }}>
                {"Simulate, then scorecard"}
              </span>
              <span style={{ fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"The whole quant pipeline. Figures and the per-group scorecard, readable with nothing configured."}
              </span>
            </div>
            <div style={{ background: "var(--color-bg)", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", color: "var(--color-accent-700)" }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect width="18" height="11" x="3" y="11" rx="0" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {"ONE KEY"}
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "18px", lineHeight: "1.1" }}>
                {"Voices, report and chat"}
              </span>
              <span style={{ fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"The interpretation layer: persona voices, the audited report and its chat agent."}
              </span>
            </div>
            <div style={{ background: "var(--color-bg)", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-heading)", fontSize: "11px", letterSpacing: "0.14em", color: "var(--color-accent-700)" }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect width="18" height="11" x="3" y="11" rx="0" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {"ONE KEY"}
              </span>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "18px", lineHeight: "1.1" }}>
                {"Discourse"}
              </span>
              <span style={{ fontSize: "12px", lineHeight: "1.5", color: "var(--color-neutral-700)" }}>
                {"Three to five voices in a room, and the two graphs side by side."}
              </span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "20px", alignItems: "stretch" }}>
            <div style={{ fontFamily: "monospace", fontSize: "13px", lineHeight: "1.8", color: "var(--color-neutral-800)", background: "var(--color-surface)", padding: "14px 16px", border: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", gap: "4px", justifyContent: "center", overflowWrap: "break-word" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ flex: "none", color: "var(--color-neutral-500)" }}>
                  {"$"}
                </span>
                <span style={{ minWidth: "0" }}>
                  {"cd python/src && uvicorn server:app --port 8000"}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ flex: "none", color: "var(--color-neutral-500)" }}>
                  {"$"}
                </span>
                <span style={{ minWidth: "0" }}>
                  {"cd web && npm run dev"}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "1px", background: "var(--color-divider)", border: "1px solid var(--color-divider)" }}>
              <div style={{ background: "var(--color-bg)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "2px", flex: "1" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "28px", lineHeight: "1" }}>
                  {v.cPytest}
                </span>
                <span style={{ fontSize: "10px", letterSpacing: "0.12em", color: "var(--color-neutral-600)" }}>
                  {"PYTEST"}
                </span>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "2px", flex: "1" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "28px", lineHeight: "1" }}>
                  {v.cPlaywright}
                </span>
                <span style={{ fontSize: "10px", letterSpacing: "0.12em", color: "var(--color-neutral-600)" }}>
                  {"PLAYWRIGHT"}
                </span>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "2px", flex: "1" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "28px", lineHeight: "1" }}>
                  {v.cDemo}
                </span>
                <span style={{ fontSize: "10px", letterSpacing: "0.12em", color: "var(--color-neutral-600)" }}>
                  {"STATIC-DEMO"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <footer data-screen-label="Landing footer" style={{ borderTop: "1px solid var(--color-divider)" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px clamp(20px, 5vw, 72px)", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <rect x="2.5" y="2.5" width="19" height="19" />
            <line x1="2.5" y1="12" x2="21.5" y2="12" />
            <line x1="12" y1="2.5" x2="12" y2="21.5" />
            <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
          </svg>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: "600", fontSize: "18px", letterSpacing: "0.04em" }}>
            {"NADI"}
          </span>
          <span style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--color-neutral-600)", maxWidth: "60ch" }}>
            {"A stakeholder-reaction preview. Not a referendum, not a recommendation, not a crash predictor. Bounded to one corridor, and it says so."}
          </span>
        </div>
        <div style={{ display: "flex", gap: "20px", fontSize: "13px", flexWrap: "wrap" }}>
          <a href="https://github.com/AzizSyed27/Nadi-GTA-Infrastructure-Impact-Simulator" target="_blank" rel="noopener">
            {"GitHub"}
          </a>
          <a href="/app/">
            {"Live demo"}
          </a>
          <a href="#top">
            {"Back to top"}
          </a>
        </div>
      </div>
    </footer>
    </>
  );
}
