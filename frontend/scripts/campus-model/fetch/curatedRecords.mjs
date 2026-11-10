// Building records that were curated as a whole (curation.mode "replace-building-record", e.g. BLD_D4's ground-truth
// rebuild) are not reproduced by the generator: a regeneration keeps the previous record of such a building in place
// of the regenerated one. A curated building that is no longer generated fails the run, so no curation is lost silently.
export function keepReplacedRecords(regenerated, previous) {
  const whole = new Map(previous.filter((r) => r.curation?.mode === "replace-building-record").map((r) => [r.key, r]));
  const missing = [...whole.keys()].filter((key) => !regenerated.some((r) => r.key === key));
  if (missing.length) throw new Error(`building forms: curated records with no regenerated building: ${missing.join(", ")}`);
  return { records: regenerated.map((r) => whole.get(r.key) ?? r), kept: regenerated.filter((r) => whole.has(r.key)).map((r) => r.key) };
}
