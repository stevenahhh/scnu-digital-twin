// Independent photo/VR labels, never derived from the generated inventory.
// `expected` is true (present), false (observed absent), or null (unknown).
// Missing refs make a label unknown. Unknowns remain in the denominator.
// Crossing bar IDs are stable evidence IDs, not array positions in a build.
const supported = r => typeof r.expected === "boolean" && r.refs?.some(ref => typeof ref === "string" && ref.trim());

function uniqueIds(ids, label) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new RangeError(`${label}: duplicate ${id}`);
    seen.add(id);
  }
}

export function compareRoadInventory(reference, generated) {
  uniqueIds(reference.segments.map(r => r.id), "reference segments");
  uniqueIds(reference.crossings.map(r => r.id), "reference crossings");
  uniqueIds(generated.segmentIds, "generated segments");
  uniqueIds(generated.crossings.map(r => r.id), "generated crossings");
  for (const r of [...reference.crossings, ...generated.crossings]) uniqueIds(r.barIds, r.id);
  const drawn = new Set(generated.segmentIds);
  const expectedIds = new Set(reference.segments.map(r => r.id));
  const counts = { tp: 0, tn: 0, fp: 0, fn: 0, unknown: 0 };
  const rows = reference.segments.map(r => {
    if (!supported(r)) {
      counts.unknown += 1;
      return { id: r.id, status: "unknown", over: false };
    }
    const exists = drawn.has(r.id);
    const status = r.expected ? (exists ? "tp" : "fn") : (exists ? "fp" : "tn");
    counts[status] += 1;
    return { id: r.id, status, over: status === "fp" || status === "fn" };
  });
  for (const id of drawn) {
    if (expectedIds.has(id)) continue;
    counts.unknown += 1;
    rows.push({ id, status: "unreferenced", over: true });
  }
  const judged = counts.tp + counts.tn + counts.fp + counts.fn;
  const denominator = judged + counts.unknown;
  const accuracy = judged ? (counts.tp + counts.tn) / judged : null;
  const lowerBound = denominator ? (counts.tp + counts.tn) / denominator : null;
  const segments = {
    rows, counts, denominator, judged, accuracy, lowerBound,
    precision: counts.tp + counts.fp ? counts.tp / (counts.tp + counts.fp) : null,
    recall: counts.tp + counts.fn ? counts.tp / (counts.tp + counts.fn) : null,
    threshold: 0.95,
    pass: counts.unknown === 0 && lowerBound !== null && lowerBound >= 0.95,
  };

  const crossingMap = new Map(generated.crossings.map(r => [r.id, r]));
  const crossingIds = new Set(reference.crossings.map(r => r.id));
  const crossingRows = reference.crossings.map(r => {
    const actual = crossingMap.get(r.id);
    const known = supported(r);
    const missingBarIds = known && r.expected ? r.barIds.filter(id => !actual?.barIds.includes(id)) : [];
    const extraBarIds = known ? (actual?.barIds ?? []).filter(id => !r.barIds.includes(id)) : [];
    const status = !known ? "unknown"
      : r.expected && !actual ? "missing"
        : !r.expected && actual ? "extra"
          : r.expected && r.barIds.length === 0 ? "unknown"
            : missingBarIds.length || extraBarIds.length ? "incomplete" : "matched";
    return {
      id: r.id, status, missingBarIds, extraBarIds,
      over: !["matched", "unknown"].includes(status),
      // Inventory completeness is not a substitute for raster overlap.
      geometryAssessed: false, iou: null,
    };
  });
  for (const id of crossingMap.keys()) {
    if (crossingIds.has(id)) continue;
    crossingRows.push({ id, status: "unreferenced", over: true, geometryAssessed: false, iou: null });
  }
  return {
    segments,
    crossings: {
      rows: crossingRows,
      pass: crossingRows.length > 0 && crossingRows.every(r => r.status === "matched"),
    },
  };
}
