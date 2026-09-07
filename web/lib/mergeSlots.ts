/**
 * V2.7b C9 — the report, composing in front of you.
 *
 * `report.py` writes the facts-only document the instant the physics ends (zero model calls), then
 * fills its narrative slots one at a time. This merges the slots that have landed into a copy of
 * that document so the SAME `RunDocument` the reader lands in can be fed a report whose prose
 * grows. "The same document" becomes true rather than a resemblance.
 *
 * THE MERGE IS SCAFFOLDING, AND THE FILE WINS. At the report stage's `stage_end` the client fetches
 * the real per-run report and swaps it in. The two SHOULD be identical — `slot_landed` carries the
 * post-retry final text — but "should" is not a rule, and one merge bug or one missed event would
 * otherwise leave the projection diverging from the persisted document forever. Everything the
 * vintage guard and the rendered-equals-file pins check runs against the file, never against this.
 *
 * FOUR TRAPS, each verified against the producer rather than assumed:
 *
 *   1. `discourse` IS SKIPPED. `sections.discourse` is `null` on a facts-only report even when a
 *      cascade ran. Merging `{synthesis}` into it makes the object truthy, and RunDocument then
 *      immediately calls `.cascade_ids.map` and indexes `shifts[cid]` — a crash. The discourse
 *      section arrives with the file.
 *   2. `prose` IS DROPPED, not rewritten. Left at `not_composed`, RunDocument renders "No narrative
 *      has been composed for this run" directly above the framing paragraph just merged in. Absent
 *      is the honest key state (the pre-V2.7b vintage the type already documents as legitimately
 *      carrying prose), and it avoids composing a server-authored sentence client-side — the
 *      `PROSE_NOTES` verbatim rule.
 *   3. BUCKET LABELS live only in Python (`report.BUCKET_LABEL`). The map below is a fourth copy of
 *      a Python constant, so it carries a pytest lockstep pin (test_bucket_labels_lockstep.py) —
 *      the `test_event_vocabulary` / `compactTime` precedent.
 *   4. `text` IS UNSTRIPPED on the wire and `.strip()`ed into the file, so every slot is trimmed
 *      here. Otherwise the paragraph visibly reflows at the swap for no reason a reader could name.
 */

import type { PerRunReport, SynthGroup } from '@/lib/reportData';
import type { SlotState } from '@/lib/runFeed';

/**
 * MIRROR of `report.BUCKET_LABEL` (python/src/report.py). The `slot_landed` event carries a
 * bucket's synthesis TEXT and nothing else, but `SynthGroup` needs a label — so this map exists.
 * Pinned to the Python source by python/tests/test_bucket_labels_lockstep.py; change both or the
 * suite fails.
 */
export const BUCKET_LABEL: Record<string, string> = {
  drivers: 'Drivers',
  cyclists: 'Cyclists',
  pedestrians: 'Pedestrians',
  community: 'Community voices',
};

/** Slots whose text has a home in the merged document. `discourse` is deliberately absent (trap 1). */
const MERGEABLE = /^(framing|caveat_intro|gloss:|synthesis:)/;

export function mergeableSlots(slots: SlotState[]): SlotState[] {
  return slots.filter((s) => MERGEABLE.test(s.slot) && s.status !== 'failed');
}

/**
 * Fold the landed slots into a copy of the facts-only report. Pure; never mutates its input.
 * Returns `null` when there is no base to merge into — the caller then renders nothing rather than
 * inventing a document.
 */
export function mergeSlots(base: PerRunReport | null, slots: SlotState[]): PerRunReport | null {
  if (!base) return null;

  const glosses: Record<string, string> = { ...base.sections.who_affected.glosses };
  const groups: SynthGroup[] = [...base.sections.what_they_say.groups];
  let framing = base.sections.what_tested.framing;
  let caveatIntro = base.sections.cannot_tell.intro;

  for (const s of mergeableSlots(slots)) {
    const text = s.text.trim();
    if (!text) continue;
    if (s.slot === 'framing') {
      framing = text;
    } else if (s.slot === 'caveat_intro') {
      caveatIntro = text;
    } else if (s.slot.startsWith('gloss:')) {
      glosses[s.slot.slice('gloss:'.length)] = text;
    } else if (s.slot.startsWith('synthesis:')) {
      const key = s.slot.slice('synthesis:'.length);
      // quotes and sample_size are NOT on the event — the code injects them after the slot returns,
      // so they arrive with the file. Empty here is honest: no quote is invented to fill the gap.
      const row: SynthGroup = {
        key,
        label: BUCKET_LABEL[key] ?? key,
        synthesis: text,
        quotes: [],
        sample_size: 0,
      };
      const at = groups.findIndex((g) => g.key === key);
      if (at >= 0) groups[at] = { ...groups[at], ...row };
      else groups.push(row);
    }
  }

  const merged: PerRunReport = {
    ...base,
    sections: {
      ...base.sections,
      what_tested: { framing },
      who_affected: { ...base.sections.who_affected, glosses },
      what_they_say: { groups },
      cannot_tell: { ...base.sections.cannot_tell, intro: caveatIntro },
    },
  };
  // trap 2 — the prose note would contradict the prose now on screen
  delete merged.prose;
  return merged;
}
