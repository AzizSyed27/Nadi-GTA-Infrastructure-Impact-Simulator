// Client-side persona → stakeholder mapping. The frozen contract trims runtime `agent.persona` to
// {id, label} only (no mode/stakeholder), so the group + display mode must be resolved here from the
// persona id. Mirrors python/src/personas.json + scorecard.py's group ids. Sign/values live in the
// artifact's scorecard; this file is purely the id→{group, mode, label} lookup the front-end joins on.

import type { Agent } from '@/lib/types';

/** The seven scorecard groups (canonical render order — matches the artifact's scorecard.groups order). */
export const SCORECARD_GROUP_ORDER = [
  'car_commuter',
  'cyclist',
  'pedestrian',
  'local_resident',
  'business_owner',
  'accessibility',
  'transit_riders',
] as const;

export type ScorecardGroupId = (typeof SCORECARD_GROUP_ORDER)[number];

/** Persona id → the group whose voices it belongs to. `taxpayer` is a real bucket but has NO scorecard
 *  row (the skeptical taxpayer) — it surfaces under the "other voices" affordance, never as a 7×3 row. */
export const PERSONA_GROUP: Record<string, string> = {
  // car (mode → car_commuter)
  time_pressed: 'car_commuter',
  gig_driver: 'car_commuter',
  steady_regular: 'car_commuter',
  resident_driver: 'car_commuter',
  safety_first_parent: 'car_commuter',
  // bicycle → cyclist
  bike_commuter: 'cyclist',
  cautious_cyclist: 'cyclist',
  bike_courier: 'cyclist',
  // pedestrian → pedestrian
  school_run_parent: 'pedestrian',
  senior_walker: 'pedestrian',
  transit_walker: 'pedestrian',
  // inferred (stakeholder field IS the group id verbatim)
  longtime_resident: 'local_resident',
  shop_owner: 'business_owner',
  accessibility_advocate: 'accessibility',
  transit_rider: 'transit_riders',
  // no scorecard row — the "other voices" bucket
  skeptical_taxpayer: 'taxpayer',
};

/** Sentinel group id for voices with no scorecard row (currently just the skeptical taxpayer). */
export const OTHER_VOICES_GROUP = 'taxpayer';

export type PersonaMode = 'car' | 'bicycle' | 'pedestrian' | 'community';

/** Persona id → transport mode, for the feed's mode icon. Inferred personas are "community" voices. */
export const PERSONA_MODE: Record<string, PersonaMode> = {
  time_pressed: 'car',
  gig_driver: 'car',
  steady_regular: 'car',
  resident_driver: 'car',
  safety_first_parent: 'car',
  bike_commuter: 'bicycle',
  cautious_cyclist: 'bicycle',
  bike_courier: 'bicycle',
  school_run_parent: 'pedestrian',
  senior_walker: 'pedestrian',
  transit_walker: 'pedestrian',
  longtime_resident: 'community',
  shop_owner: 'community',
  accessibility_advocate: 'community',
  transit_rider: 'community',
  skeptical_taxpayer: 'community',
};

const MODE_ICON: Record<PersonaMode, string> = {
  car: '🚗',
  bicycle: '🚴',
  pedestrian: '🚶',
  community: '💬',
};

/** A small emoji for a persona's mode (feed row prefix). Falls back to the community glyph. */
export function modeIcon(personaId: string): string {
  return MODE_ICON[PERSONA_MODE[personaId] ?? 'community'];
}

/** Human-friendly group labels (scorecard rows, filter chip). Includes the no-row "taxpayer" bucket. */
export const GROUP_LABEL: Record<string, string> = {
  car_commuter: 'Car commuters',
  cyclist: 'Cyclists',
  pedestrian: 'Pedestrians',
  local_resident: 'Local residents',
  business_owner: 'Business owners',
  accessibility: 'Accessibility',
  transit_riders: 'Transit riders',
  taxpayer: 'Other voices',
};

/** The group an agent's voice belongs to (or null if its persona id is unmapped — never expected). */
export function groupOfAgent(a: Agent): string | null {
  return PERSONA_GROUP[a.persona.id] ?? null;
}
