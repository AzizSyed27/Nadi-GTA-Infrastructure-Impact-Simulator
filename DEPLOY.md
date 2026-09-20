# Deploying the static demo

The demo is a fully static bundle — no server, no keys. Build it, then hand the directory to
Cloudflare Pages.

## 1. Build

```bash
node scripts/build-static-demo.mjs
```

This runs the `NEXT_STATIC_EXPORT=1` export build, prunes `web/out/` to the demo set (the pinned
212-voice run's triple, the example run's artifact + per-run report + graphs sidecar (V2.7f),
`network.json`), writes the `out/latest.json` pointer (build-written, never committed, aimed at the
example run), and prints the manifest with a per-file size check. Expect **~45 MB total, every
file under 25 MiB** — that last number is Cloudflare Pages' hard per-file cap, and the script sets
a failing exit code if any file crosses it (check the exit code, not only the log).

Run the build BETWEEN Playwright chunks, never during one: it writes `web/.next`, which the dev
server on :3000 also uses.

Verify the bundle before deploying — the `static-demo` Playwright project (V2.7f) serves `web/out`
on :3001 with python's `http.server` and pins the read-only rule surface by surface (Build locked
with the why, the document's doors, the run list, chat, the Compare pickers, the demo discourse
caption, the example's graphs, and ZERO requests to `/api/*` across a landing → Watch → Explore
walk):

```bash
cd web && npm run e2e:demo
```

The project is SKIPPED with a printed line when `web/out/latest.json` is absent — build first. The
three walkthrough stops from the README should also render by hand at `http://localhost:3001`
(`cd web && python -m http.server 3001 --directory out`); every live affordance shows the read-only
sentence rather than failing.

## 2. Deploy to Cloudflare Pages

Either path works; both need a (free) Cloudflare account.

**One-off, from this machine:**

```bash
npx wrangler login
npx wrangler pages deploy web/out --project-name nadi-demo
```

**Or connect the repo** in the Cloudflare dashboard (Workers & Pages → Create → Pages →
connect to git): build command `node scripts/build-static-demo.mjs`, output directory `web/out`.
Connected builds redeploy on push; the wrangler path redeploys when you rerun the two commands.

After the first deploy, open the `*.pages.dev` URL and re-run the three-stop walkthrough once
against the real host. Two things worth confirming in the network tab: the big artifact fetches
arrive with `content-encoding: br` or `gzip` (Pages negotiates this itself — the ~20 MB JSON
files travel at roughly a third of their size), and deep links with query strings
(`/?run=…&compare=…`) resolve — they're client-side, so they should.

Then put the live URL in README.md's **See it live** section.

## Why not GitHub Pages

A GitHub Pages *project* site serves from `/<repo-name>/`, and the app fetches its data with
root-absolute URLs (`/latest.json`, `/<run_id>.json`, `/network.json`) — every fetch would 404
unless the whole app were rebuilt with a `basePath`, which would then break local dev and the
perf harness. Cloudflare Pages (or any host serving from the domain root) avoids the problem
outright. A GitHub Pages *user* site (`<user>.github.io`) would also work, but it can only host
one project.

## Rebuilding after changes

The bundle snapshots whatever is committed in `web/public/` at build time. After changing the
frontend or the demo runs: rerun `node scripts/build-static-demo.mjs`, re-check the printed
manifest, redeploy.
