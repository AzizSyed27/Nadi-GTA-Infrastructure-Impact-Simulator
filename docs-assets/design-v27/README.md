# V2.7 ratified design — the in-repo record

The visual source of truth for the V2.7 frontend restructure is the Claude Design project
**"Nadi traffic simulation redesign"** (id `36ad50f3-6288-4000-b294-d736cbc0d9ed`):

  https://claude.ai/design/p/36ad50f3-6288-4000-b294-d736cbc0d9ed

## The ratified screens per step

| Screen | Source file in the design project | Step |
| --- | --- | --- |
| The shell + the Read-stage run document (abstract-first, spec table, findings with stat callouts, three-bucket 2.4, notes on method, colophon) | `Nadi Shell v2.dc.html` | V2.7a |
| The run list (closed: one run name; expanded: 560px blueprint popover, CLONE TO DRAFT as the primary action, inventory-not-a-ranking) + clone's one-step result | `Nadi Map & Build.dc.html` §2b / §2c | V2.7a |
| The Build stage (read-only composition view for the example; fresh-draft steps) | `Nadi Shell v2.dc.html` | V2.7a (frame) / V2.7d (restyle) |
| Scorecard section candidate forms — **form 1d (MOVED / UNCLAIMED / NOT MEASURED) is the ratified one** | `Scorecard Section.dc.html` | V2.7a |
| The run experience (two acts) | `Nadi Run Experience.dc.html` | V2.7b |
| Map styling, zoom ladder, editor | `Nadi Map & Build.dc.html` (rest) | V2.7c/d |
| The design system (Barlow / Barlow Condensed, #f2f2f3 ground, steel accent #5980a6, blueprint corners) | `_ds/industry-…/styles.css` + `readme.md` | all |

## Why there are no PNG exports here

Static exports were attempted from the design project's `uploads/` (2026-08-30): the two
files that survived transfer intact are design *inputs* (an external-tool reference and a
crop of the pre-V2.7 app), not renders of the ratified screens; every full-screen upload
exceeds the transfer cap and arrives truncated. Rather than commit corrupt or misleading
images, this record points at the live canvases above — the acceptance's looked-at checks
compare the implemented app against the design project directly.

## The two import rules (from the V2.7a brief — they govern every comparison)

1. **Every number, counter, and test count in the design files is an ILLUSTRATIVE
   PLACEHOLDER.** All values derive from run data at implementation — never transcribe a
   literal from the mockup HTML.
2. **The import governs APPEARANCE; the written brief governs scope, architecture, data
   flow, migration strategy, and process.** Where they appear to conflict, the brief wins
   (e.g. method note 4 carries only the settled-basis caveat, and the colophon derives or
   omits test counts — both are deliberate divergences from the mockup text).
