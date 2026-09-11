// V2.7c C4 — the three mode glyphs (car / bicycle / pedestrian) for the icons band (z ≥ 16), drawn ONCE
// on a Canvas2D atlas and handed to deck as a PNG data URL — synchronous, deterministic, no binary asset
// in the repo, and the layer's colour applies because every glyph is a MASK (white on transparent).
// Top-down, heading NORTH at angle 0 (the arrow.png / chevron convention), so `getAngle = 360 − bearing`.
// Sizes are in METRES on the layer (a car ~4.6 m, a bicycle ~1.9, a walker ~1.0) with a pixel floor so a
// walker at z16 is still a glyph — mode is legible from the SHAPE, never from colour (TRAVELER is one hue).

export type TravelerMode = 'car' | 'bicycle' | 'pedestrian';

export const ICON_PX = 32;
export const ICON_MAPPING: Record<TravelerMode, { x: number; y: number; width: number; height: number; mask: boolean; anchorX: number; anchorY: number }> = {
  car: { x: 0, y: 0, width: ICON_PX, height: ICON_PX, mask: true, anchorX: 16, anchorY: 16 },
  bicycle: { x: ICON_PX, y: 0, width: ICON_PX, height: ICON_PX, mask: true, anchorX: 16, anchorY: 16 },
  pedestrian: { x: 2 * ICON_PX, y: 0, width: ICON_PX, height: ICON_PX, mask: true, anchorX: 16, anchorY: 16 },
};
/** On-map glyph height in metres per mode (sizeUnits: 'meters'). */
export const ICON_SIZE_M: Record<TravelerMode, number> = { car: 4.6, bicycle: 1.9, pedestrian: 1.0 };

let cachedUrl: string | null = null;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The atlas as a PNG data URL (null on the server — the layer is client-only anyway). Built once. */
export function modeAtlasUrl(): string | null {
  if (typeof document === 'undefined') return null;
  if (cachedUrl) return cachedUrl;
  const c = document.createElement('canvas');
  c.width = 3 * ICON_PX;
  c.height = ICON_PX;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // car: a rounded body, nose up; a clear band for the windshield so the front reads
  roundRect(g, 9, 3, 14, 26, 4);
  g.fill();
  g.clearRect(10, 10, 12, 2);
  // bicycle: two wheels on a vertical axis (front wheel up) joined by a frame, a handlebar across the front
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(48, 9, 4.5, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(48, 23, 4.5, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(48, 13);
  g.lineTo(48, 19);
  g.moveTo(43, 9);
  g.lineTo(53, 9);
  g.stroke();
  // pedestrian: a head and a shoulder-width body, facing up
  g.beginPath();
  g.arc(80, 9, 4.5, 0, Math.PI * 2);
  g.fill();
  roundRect(g, 74, 15, 12, 13, 5);
  g.fill();
  cachedUrl = c.toDataURL('image/png');
  return cachedUrl;
}
