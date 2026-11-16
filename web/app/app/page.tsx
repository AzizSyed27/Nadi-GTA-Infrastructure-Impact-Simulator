'use client';

import dynamic from 'next/dynamic';

// V2.8: the four-stage shell lives at /app/ (the landing page took `/`).
// deck.gl + maplibre-gl touch `window`, so the map must be client-only.
// 'use client' alone is not enough under the App Router - disable SSR for this component.
// (Next 16 docs: `ssr: false` only works inside a Client Component, which this is.)
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

export default function ShellPage() {
  return <MapView />;
}
