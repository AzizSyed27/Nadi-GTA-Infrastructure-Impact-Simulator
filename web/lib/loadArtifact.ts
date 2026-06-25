// Runtime loader + validator for the frozen trajectory contract (v0.2.0).
//
// Validates against the SAME authority Python uses — contract/trajectory_schema.json — via ajv,
// so the TS and Python sides cannot drift. The schema is JSON Schema draft 2020-12, so we use
// ajv's Ajv2020 build; ajv-formats supplies the "date-time" format used by meta.created_at.

import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
// The canonical schema lives outside web/ — import it directly so there is one source of truth.
import schema from '../../contract/trajectory_schema.json';
import type { TrajectoryArtifact } from './types';

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile<TrajectoryArtifact>(schema);

/** Thrown when a fetched artifact does not satisfy the frozen contract. */
export class ArtifactValidationError extends Error {
  constructor(public readonly errors: ErrorObject[]) {
    super(
      'Trajectory artifact failed contract validation:\n' +
        (errors ?? []).map((e) => `  ${e.instancePath || '(root)'} ${e.message}`).join('\n'),
    );
    this.name = 'ArtifactValidationError';
  }
}

/**
 * Fetch a trajectory artifact and validate it against the frozen schema before returning it typed.
 * @param url path to the artifact JSON (e.g. '/sample_v0_2_0.json' from web/public).
 */
export async function loadArtifact(url: string): Promise<TrajectoryArtifact> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to fetch artifact ${url}: ${res.status} ${res.statusText}`);
  }
  const data: unknown = await res.json();
  if (!validate(data)) {
    throw new ArtifactValidationError(validate.errors ?? []);
  }
  return data; // validate is a type guard for TrajectoryArtifact
}
