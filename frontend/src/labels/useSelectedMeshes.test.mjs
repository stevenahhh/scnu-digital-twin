import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Group, Mesh } from "three";
import { collectSelectedMeshes } from "./useSelectedMeshes.mjs";

function mesh(name, userData = {}) {
  const object = new Mesh();
  object.name = name;
  Object.assign(object.userData, userData);
  return object;
}

function campus() {
  const scene = new Group();
  const library = mesh("BLD_C1", { selectableElementId: "BLD_C1" });
  const libraryAnnex = mesh("BLD_C1001", { selectableElementId: "BLD_C1" });
  const proxy = mesh("BLD_SCNU_A6", { pickProxy: true });
  const other = mesh("BLD_E1", { selectableElementId: "BLD_E1" });
  const ground = mesh("Topography", { selectableElementId: null });
  const nested = new Group();
  nested.add(libraryAnnex);
  scene.add(library, nested, proxy, other, ground);
  return { scene, library, libraryAnnex, proxy, other };
}

describe("collectSelectedMeshes", () => {
  it("returns every mesh of the selected building, nested ones included", () => {
    const { scene, library, libraryAnnex } = campus();
    assert.deepEqual(collectSelectedMeshes(scene, "BLD_C1"), [library, libraryAnnex]);
  });

  it("returns a pick proxy by its node name", () => {
    const { scene, proxy } = campus();
    assert.deepEqual(collectSelectedMeshes(scene, "BLD_SCNU_A6"), [proxy]);
  });

  it("returns nothing without a selection, a scene, or a match", () => {
    const { scene } = campus();
    assert.deepEqual(collectSelectedMeshes(scene, null), []);
    assert.deepEqual(collectSelectedMeshes(null, "BLD_C1"), []);
    assert.deepEqual(collectSelectedMeshes(scene, "BLD_Z9"), []);
  });
});
