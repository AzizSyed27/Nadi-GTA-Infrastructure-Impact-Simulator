'use client';

// V2.3d STEP-1 SPIKE PAGE (temporary — deleted before the feature lands).
import dynamic from 'next/dynamic';

const SpikeGraphs = dynamic(() => import('@/components/SpikeGraphs'), { ssr: false });

export default function SpikePage() {
  return <SpikeGraphs />;
}
