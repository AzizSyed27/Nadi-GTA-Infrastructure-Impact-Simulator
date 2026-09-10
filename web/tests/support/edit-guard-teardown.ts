// globalTeardown half of the edit guard — see edit-guard.ts for why this is a separate file
// (globalSetup's returned teardown does not fire on this install; verified with a live probe).
import { editGuardTeardown } from './edit-guard';

export default function globalTeardown(): void {
  editGuardTeardown();
}
