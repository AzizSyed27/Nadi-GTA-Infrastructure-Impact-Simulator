// V2.7a — run-provenance labels, extracted VERBATIM from CompareView's provenance strip so the
// run document's spec table and Compare speak the same sentences (one wording, two surfaces).

export function demandLabel(profile: string | undefined): string {
  return profile === 'calibrated_am_peak'
    ? 'calibrated AM peak (07:00–09:00, count-anchored)'
    : 'synthetic demo demand';
}

export function assignmentLabel(
  asn: { mode: string; converged?: boolean | null; iterations?: number | null } | null | undefined,
): string {
  return asn?.mode === 'settled'
    ? `settled response (iterated assignment, drivers only)${
        asn.converged != null
          ? ` · ${asn.converged ? `converged in ${asn.iterations} iterations` : 'iteration cap reached'}`
          : ''
      }`
    : 'day-one response — today’s route habits, no assignment iteration';
}
