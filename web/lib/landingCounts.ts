// V2.8 — the landing page's "Run it yourself" card prints the three suite sizes. They are the
// ONLY test counts any product surface carries (the run document's colophon deliberately derives
// and prints none), so they live in ONE constant, and a pytest (test_landing_counts.py) pins it
// against the numbers CLAUDE.md's Tests bullet documents — update both at a phase close or the
// pin fails.
export const LANDING_TEST_COUNTS = { pytest: 761, playwright: 284, staticDemo: 12 } as const;
