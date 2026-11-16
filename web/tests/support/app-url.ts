// V2.8 — the shell's route. The landing page took `/`; the four-stage shell lives at `/app/`
// (trailing slash: `next.config.ts` sets `trailingSlash`, so the static export emits
// `app/index.html`). Every spec that opens the shell navigates through this ONE constant —
// `page.goto(APP)`, `page.goto(`${APP}?run=<id>`)` — so the next route move is a one-line edit.
export const APP = '/app/';
