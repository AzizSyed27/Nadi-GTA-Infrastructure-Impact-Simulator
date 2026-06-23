'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { Layer } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { TrajectoryArtifact, Vehicle } from '@/lib/types';
import { Timeline } from '@/components/Timeline';

// Token-free CARTO positron style (no API key).
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Attaches a deck.gl MapboxOverlay to the MapLibre map and re-pushes layers each render. */
function DeckOverlay({ layers }: { layers: Layer[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  overlay.setProps({ layers });
  return null;
}

export default function MapView() {
  const [artifact, setArtifact] = useState<TrajectoryArtifact | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const mapRef = useRef<MapRef | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/run.json')
      .then((r) => r.json())
      .then((data: TrajectoryArtifact) => {
        if (cancelled) return;
        setArtifact(data);
        setCurrentTime(data.meta.sim_start);
      })
      .catch((e) => console.error('failed to load /run.json', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Stable reference: only `currentTime` changes per frame, so deck.gl updates one uniform
  // instead of re-tessellating + re-uploading all 300 vehicles every animation tick.
  const vehicles: Vehicle[] = useMemo(() => artifact?.vehicles ?? [], [artifact]);

  if (!artifact) {
    return <div style={loading}>Loading trajectory…</div>;
  }

  const { meta } = artifact;
  const [minLon, minLat, maxLon, maxLat] = meta.bbox;

  const trips = new TripsLayer<Vehicle>({
    id: 'trips',
    data: vehicles,
    getPath: (d) => d.path,
    getTimestamps: (d) => d.timestamps,
    getColor: [253, 128, 93],
    widthMinPixels: 2,
    trailLength: 180, // sim seconds (same units as timestamps / currentTime)
    fadeTrail: true,
    currentTime,
    capRounded: true,
    jointRounded: true,
  });

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: (minLon + maxLon) / 2,
          latitude: (minLat + maxLat) / 2,
          zoom: 12,
        }}
        mapStyle={POSITRON}
        style={{ width: '100%', height: '100%' }}
        onLoad={() => {
          // Fit exactly to the corridor bbox read from the artifact's meta.
          mapRef.current?.getMap().fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
            { padding: 40, duration: 0 },
          );
        }}
      >
        <DeckOverlay layers={[trips]} />
      </Map>
      <Timeline
        simStart={meta.sim_start}
        simEnd={meta.sim_end}
        currentTime={currentTime}
        onSeek={setCurrentTime}
        vehicleCount={vehicles.length}
      />
    </div>
  );
}

const loading: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'system-ui, sans-serif',
  color: '#555',
};
