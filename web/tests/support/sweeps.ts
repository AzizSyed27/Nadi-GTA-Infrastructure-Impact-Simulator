// V2.7a — the referendum-guard sweep regexes, single-sourced for NEW specs (the document view,
// the run list, the app shell). Byte-identical to the copies discourse.spec.ts:21-23 originated
// (existing specs keep their local literals and migrate only when a commit touches them anyway —
// the anti-drift pin is that these ARE the discourse.spec bytes).
export const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
export const STANCE_TALLY =
  /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;
// graphs.spec.ts:24 — no centrality leaderboards, no influencer ranking
export const GRAPHS_BANNED =
  /\b(centrality|most influential|top voices?|influencers?|leaderboard|rank(ed|ing)?)\b/i;
// compare.spec.ts:86 — no winners, no recommendations, no net benefit
export const COMPARE_BANNED =
  /\b(winner|wins|recommended?|net benefit|overall (score|better)|better option)\b/i;
