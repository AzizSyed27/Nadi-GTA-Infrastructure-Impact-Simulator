'use client';

// V2.8 — the front door. The landing page owns `/`; the four-stage shell lives at `/app/`.
// Markup = LandingMarkup (the ratified canvas, transcribed); behaviour = useLanding.
//
// THE DEEP-LINK FORWARD IS PERMANENT: before V2.8 the shell owned `/`, so the README's published
// stops and every shared link read `/?run=<id>[&compare=<id>]`. A visit carrying either
// parameter is forwarded to `/app/` with its query intact and the landing never paints
// (app-shell.spec pins it).
import { useEffect, useSyncExternalStore } from 'react';
import LandingMarkup from './LandingMarkup';
import { useLanding } from './useLanding';

const isDeepLink = () => {
  const q = new URLSearchParams(window.location.search);
  return q.has('run') || q.has('compare');
};
const noop = () => () => {};

function LandingPage() {
  const v = useLanding();
  return (
    <div className="nadi-landing" data-testid="landing">
      <LandingMarkup v={v} />
    </div>
  );
}

export default function Landing() {
  // read once on the client; the server render (and the static export) always paint the landing
  const forward = useSyncExternalStore(noop, isDeepLink, () => false);
  useEffect(() => {
    if (forward) window.location.replace(`/app/${window.location.search}`);
  }, [forward]);
  if (forward) return null;
  return <LandingPage />;
}
