# Blender topology report for a geometry-only campus GLB (qa/topology/strip.mjs writes it).
# Run: Blender -b --factory-startup --python blender_topology.py -- <in.glb> <out.json> [--merge] [--editable <out.blend>]
# --editable makes the file an artist edits: vertices welded by position (0.1 mm), Tris to Quads, coplanar faces of one
# material and continuous UVs dissolved into n-gons, sharp edges marked at 30 deg; it is measured and saved as .blend.
# Each mesh is imported as an artist would open the file (Blender glTF importer defaults; --merge adds the
# importer's "Merge Vertices"), then joined with Tris to Quads at the operator defaults (40 deg face and shape
# thresholds). Reported per mesh and per root node: triangles in, quads/tris/ngons out, quad share of the source
# triangles, boundary and non-manifold edges, and face islands (a face soup has one island per quad).
import json
import math
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
source, output = argv[0], argv[1]
merge = "--merge" in argv
editable = argv[argv.index("--editable") + 1] if "--editable" in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source, merge_vertices=merge)


def root_name(obj):
    while obj.parent is not None:
        obj = obj.parent
    return obj.name


def islands(bm):
    parent = list(range(len(bm.verts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for edge in bm.edges:
        a, b = find(edge.verts[0].index), find(edge.verts[1].index)
        if a != b:
            parent[a] = b
    return len({find(face.verts[0].index) for face in bm.faces})


rows = []
seen = set()
for obj in bpy.data.objects:
    if obj.type != "MESH" or obj.data.name in seen:
        continue
    seen.add(obj.data.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    triangles = sum(len(f.verts) - 2 for f in bm.faces)
    if editable:
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)
    bmesh.ops.join_triangles(bm, faces=list(bm.faces), angle_face_threshold=math.radians(40),
                             angle_shape_threshold=math.radians(40))
    if editable:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=list(bm.verts), edges=list(bm.edges),
                                 delimit={"NORMAL", "MATERIAL", "SEAM", "UV"})
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    quads = sum(1 for f in bm.faces if len(f.verts) == 4)
    tris = sum(1 for f in bm.faces if len(f.verts) == 3)
    rows.append({
        "mesh": obj.data.name,
        "root": root_name(obj),
        "vertices": len(bm.verts),
        "trianglesIn": triangles,
        "quads": quads,
        "tris": tris,
        "ngons": sum(1 for f in bm.faces if len(f.verts) > 4),
        "quadShare": round(2 * quads / triangles, 4) if triangles else 0,
        "boundaryEdges": sum(1 for e in bm.edges if e.is_boundary),
        "nonManifoldEdges": sum(1 for e in bm.edges if not e.is_manifold),
        "islands": islands(bm),
    })
    if editable:
        bm.to_mesh(obj.data)
        obj.data.validate()
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj.data.set_sharp_from_angle(angle=math.radians(30))
    bm.free()

if editable:
    bpy.ops.wm.save_as_mainfile(filepath=editable, compress=True)

with open(output, "w") as handle:
    json.dump({"source": source, "merge": merge, "meshes": rows}, handle, indent=1)
print(f"TOPOLOGY {len(rows)} meshes -> {output}")
