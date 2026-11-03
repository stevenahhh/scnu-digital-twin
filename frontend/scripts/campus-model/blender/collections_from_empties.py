# Turns the campus GLB's collection nodes into Blender collections.
#
# campus-v2.glb groups every object under empty nodes marked extras.collection (lib/glb.mjs groupRoots):
# Buildings, Pick_Proxies, Context/{Buildings,Ground}, Ground/{Terrain,Surfaces,Kerbs,Markings}, Vegetation,
# Furniture, Lighting. Blender's glTF importer brings those in as Empties with their children parented under them.
# Run this once after File > Import > glTF (Scripting workspace > Run Script): each marked Empty becomes a collection
# of the same name (nested like the Empties), its direct children move into it, and the Empties are removed.
# Object transforms are unchanged (the collection nodes carry identity transforms).
import bpy


def is_collection_empty(obj):
    return obj.type == "EMPTY" and bool(obj.get("collection"))


def convert(empty, parent_collection):
    collection = bpy.data.collections.new(empty.name)
    parent_collection.children.link(collection)
    for child in list(empty.children):
        if is_collection_empty(child):
            convert(child, collection)
            continue
        matrix = child.matrix_world.copy()
        child.parent = None
        child.matrix_world = matrix
        for users in list(child.users_collection):
            users.objects.unlink(child)
        collection.objects.link(child)
        for descendant in child.children_recursive:
            for users in list(descendant.users_collection):
                users.objects.unlink(descendant)
            collection.objects.link(descendant)
    bpy.data.objects.remove(empty)


scene_collection = bpy.context.scene.collection
for obj in [o for o in bpy.context.scene.objects if is_collection_empty(o) and o.parent is None]:
    convert(obj, scene_collection)
