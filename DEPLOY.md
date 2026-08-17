# Deploying the static demo

The demo is a fully static bundle — no server, no keys. Build it, then hand the directory to
Cloudflare Pages.

## 1. Build

```bash
node scripts/build-static-demo.mjs
```

This runs the `NEXT_STATIC_EXPORT=1` export build, prunes `web/out/` to the demo set (the pinned
212-voice run's triple, the modern institutional run, `network.json`, `latest-report.*`), writes
the `out/latest.json` pointer (build-written, never committed), and prints the manifest with a
per-file size check. Expect **~44 MB total, every file under 25 MiB** — that last number is
Cloudflare Pages' hard per-file cap, and the script fails loudly if any file crosses it.

Sanity-check locally before deploying (any static server works):

```bash
cd web/out && python -m http.server 8080    # → http://localhost:8080
```

The three walkthrough stops from the README should all render, and the edit/chat/interview
affordances should show the read-only sentence.

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
