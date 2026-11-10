// Crowns in photo geometry for scripts/perf/canopy-cover.mjs (local QA only; nothing here ships). The photo canopy
// mask shows each crown displaced by relief lean, so an inventory's trunks are moved forward by the same lean its
// fetch/treeInventory.mjs revert removed before they are compared with the mask:
//   - inventories with a "photoLean" column (todo 16 on): the recorded [east, north] offset of each tree;
//   - older inventories: the registration lean field at 0.6 x height (the revert of treeInventory.mjs up to 30e01326).
//     This is an approximation: the height may have been refitted after the revert and the field is read at the trunk,
//     not the crown. A strict comparison rebakes the old code with the photoLean column added, so both sides use the
//     recorded offset; the fallback is for a quick look only.

// Relief lean of the NGII mosaic as fetch/treeInventory.mjs used it up to 30e01326 (registration study field).
export const LEGACY_LEAN_FIELD = Object.freeze({ E: [-0.02, -0.01285, -0.00121], N: [-0.0549, -0.01201, -0.06335], E0N0: [243835.0182316025, 263760.97123001737] });
export const LEGACY_CROWN_CENTRE = 0.6;

export function legacyLeanOffset(east, north, heightM) {
  const de = (east - LEGACY_LEAN_FIELD.E0N0[0]) / 100;
  const dn = (north - LEGACY_LEAN_FIELD.E0N0[1]) / 100;
  const h = LEGACY_CROWN_CENTRE * heightM;
  const f = LEGACY_LEAN_FIELD;
  return [h * (f.E[0] + f.E[1] * de + f.E[2] * dn), h * (f.N[0] + f.N[1] * de + f.N[2] * dn)];
}

/** Photo-geometry position [east, north] of every tree row of a data/trees.json document. */
export function photoPositions(inventory) {
  const col = inventory.columns ?? [];
  const lean = col.indexOf('photoLean');
  const height = col.indexOf('heightM') >= 0 ? col.indexOf('heightM') : 3;
  return inventory.trees.map((row) => {
    const [le, ln] = lean >= 0 && Array.isArray(row[lean]) ? row[lean] : legacyLeanOffset(row[0], row[1], row[height]);
    return [row[0] + le, row[1] + ln];
  });
}
