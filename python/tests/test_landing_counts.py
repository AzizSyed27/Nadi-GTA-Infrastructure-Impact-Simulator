"""V2.8 - the landing page prints the three suite sizes ("Run it yourself"). They are the only
test counts any product surface carries, so they live in ONE TypeScript constant
(web/lib/landingCounts.ts) and this pin holds it equal to the numbers CLAUDE.md's Tests bullet
documents. Update both at a phase close; a landing page that advertises a stale count fails here.
(The cross-language lockstep idiom - the compactTime / display-label precedent.)
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _landing_counts() -> dict[str, int]:
    src = (ROOT / "web" / "lib" / "landingCounts.ts").read_text(encoding="utf-8")
    m = re.search(
        r"LANDING_TEST_COUNTS = \{ pytest: (\d+), playwright: (\d+), staticDemo: (\d+) \} as const;", src
    )
    assert m, "LANDING_TEST_COUNTS moved or changed shape - update this pin with it"
    return {"pytest": int(m[1]), "playwright": int(m[2]), "staticDemo": int(m[3])}


def _documented_counts() -> dict[str, int]:
    doc = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    py = re.search(r"`python -m pytest python/tests` \((\d+) tests", doc)
    pw = re.search(r"\((\d+) chromium \+ (\d+) static-demo tests across", doc)
    assert py and pw, "CLAUDE.md's Tests bullet changed shape - update this pin with it"
    return {"pytest": int(py[1]), "playwright": int(pw[1]), "staticDemo": int(pw[2])}


def test_landing_counts_equal_the_documented_suite_sizes():
    assert _landing_counts() == _documented_counts()


def test_the_pin_reads_literals_not_each_other():
    # mutation guard: both readers return three positive, distinct-source integers
    landing, documented = _landing_counts(), _documented_counts()
    assert set(landing) == set(documented) == {"pytest", "playwright", "staticDemo"}
    assert all(v > 0 for v in landing.values())
