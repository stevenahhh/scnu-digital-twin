// todo23 canonical ID handoff. This adapter does not infer road ownership,
// rewrite geometry, or derive identity from coordinates/width/global order.
// QA bindings are { ownerId, segmentId, verified, refs }, independent of the
// canonical schema. Unreviewed nearest-RD associations never prove existence.
const OWNER = /^(RS|JA)_[0-9a-f]{16}$/;
const byId = (a, b) => a.id.localeCompare(b.id, "en");

export function roadObjectInventory(pieces, bindings) {
  const segmentsByOwner = new Map();
  for (const { ownerId, segmentId, verified, refs } of bindings) {
    if (!OWNER.test(ownerId) || !/^RD_\d{3}$/.test(segmentId)) throw new TypeError(`invalid owner binding ${ownerId}: ${segmentId}`);
    if (segmentsByOwner.has(ownerId)) throw new RangeError(`duplicate owner binding ${ownerId}`);
    const reviewed = verified === true && refs?.some(ref => typeof ref === "string" && ref.trim());
    segmentsByOwner.set(ownerId, reviewed ? segmentId : null);
  }
  const groups = new Map(), partIds = new Set();
  for (const piece of pieces) {
    const { objectId, ownerId, partId } = piece;
    if (![objectId, ownerId, partId].every(v => typeof v === "string") || !OWNER.test(ownerId)) {
      throw new TypeError("piece needs canonical identity: objectId, ownerId, partId");
    }
    if (!objectId.startsWith(`${ownerId}/`)) throw new TypeError(`${objectId}: mismatched owner ${ownerId}`);
    if (!partId.startsWith(`${objectId}/`) || !/\/part\/(0|[1-9]\d*)$/.test(partId)) {
      throw new TypeError(`${objectId}: invalid part ${partId}`);
    }
    if (partIds.has(partId)) throw new RangeError(`duplicate part ${partId}`);
    partIds.add(partId);
    if (!groups.has(objectId)) groups.set(objectId, { id: objectId, ownerId, pieces: [] });
    groups.get(objectId).pieces.push(piece);
  }
  const objects = [...groups.values()].sort(byId).map(object => ({
    ...object, pieces: object.pieces.toSorted((a, b) => a.partId.localeCompare(b.partId, "en")),
  }));
  const segmentIds = new Set(), unassignedOwners = new Set(), crossings = [];
  for (const object of objects) {
    const segment = segmentsByOwner.get(object.ownerId);
    if (segment) segmentIds.add(segment);
    else unassignedOwners.add(object.ownerId);
    if (object.id !== `${object.ownerId}/crossing`) continue;
    if (!object.ownerId.startsWith("JA_")) throw new TypeError(`${object.id}: crossing owner must be an approach`);
    const barIds = new Set();
    for (const piece of object.pieces) {
      const suffix = piece.partId.slice(object.id.length + 1);
      const grid = /^(0|[1-9]\d*)\/part\/(?:0|[1-9]\d*)$/.exec(suffix);
      if (!grid) throw new TypeError(`${object.id}: invalid crossing grid ${piece.partId}`);
      barIds.add(`${object.id}/${grid[1]}`);
    }
    crossings.push({ id: object.id, barIds: [...barIds].sort() });
  }
  return { objects, segmentIds: [...segmentIds].sort(), crossings, unassignedOwners: [...unassignedOwners].sort() };
}
