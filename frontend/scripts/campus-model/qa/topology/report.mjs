// Pure summary of qa/topology/blender_topology.py rows (one per mesh) and the limits campus-v2.blend must meet.
const round = (value, digits = 4) => Number(value.toFixed(digits));

function totals(rows) {
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const trianglesIn = sum("trianglesIn");
  const [quads, tris, ngons, islands] = [sum("quads"), sum("tris"), sum("ngons"), sum("islands")];
  const faces = quads + tris + ngons;
  return {
    meshes: rows.length, trianglesIn, faces, quads, tris, ngons, islands, boundaryEdges: sum("boundaryEdges"),
    triFaceShare: faces ? round(tris / faces) : 0,
    islandsPerThousandTriangles: trianglesIn ? round((1000 * islands) / trianglesIn, 2) : 0,
  };
}

// rows: blender_topology.py "meshes"; meshes: mesh names also reported one by one.
export function summarizeTopology(rows, { meshes = [] } = {}) {
  const roots = {};
  for (const root of new Set(rows.map((row) => row.root))) roots[root] = totals(rows.filter((row) => row.root === root));
  const named = {};
  for (const name of meshes) {
    const own = rows.filter((row) => row.mesh === name);
    if (own.length) named[name] = totals(own);
  }
  return { roots, meshes: named };
}

// limits: { roots: { <root>: { <metric>: max } }, meshes: { <mesh>: { <metric>: max } } }. Returns failure lines.
export function topologyFailures(summary, limits) {
  const failures = [];
  for (const [kind, group] of [["root", "roots"], ["mesh", "meshes"]]) {
    for (const [name, maxima] of Object.entries(limits[group] ?? {})) {
      const values = summary[group][name];
      if (!values) {
        failures.push(`${kind} ${name}: missing from the report`);
        continue;
      }
      for (const [metric, max] of Object.entries(maxima)) {
        if (!(values[metric] <= max)) failures.push(`${kind} ${name}: ${metric} ${values[metric]} > ${max}`);
      }
    }
  }
  return failures;
}
