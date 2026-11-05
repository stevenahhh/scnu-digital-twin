import assert from "node:assert/strict";
import test from "node:test";
import { tmToScene, sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { splitD4GroundPolygon, d4NaturalTile, LANDCOVER } from "./landcover.mjs";

test("D4 natural ground cuts all four scope edges with no lost area", () => {
  const ring=[[243400,263700],[243650,263700],[243650,264050],[243400,264050]];
  const result=splitD4GroundPolygon(ring.map(p=>tmToScene(...p)));
  const area=poly=>{
    const tm=poly.map(p=>sceneToTm(...p));
    const origin=tm[0];
    return Math.abs(tm.reduce((sum,p,i)=>{
      const q=tm[(i+1)%tm.length];
      return sum+(p[0]-origin[0])*(q[1]-origin[1])-(q[0]-origin[0])*(p[1]-origin[1]);
    },0))/2;
  };
  assert.equal(result.outside.length,4);
  assert.ok(Math.abs(area(result.inside)-169.32*223.48)<1e-5);
  assert.ok(Math.abs([result.inside,...result.outside].reduce((sum,p)=>sum+area(p),0)-250*350)<1e-5);
  for(const [x,y] of result.inside.map(p=>sceneToTm(...p))) {
    assert.ok(x>=243422.55-1e-7 && x<=243591.87+1e-7);
    assert.ok(y>=263767.58-1e-7 && y<=263991.06+1e-7);
  }
});

test("D4 natural ground uses classification for soil and vegetation tiles", () => {
  assert.equal(d4NaturalTile(LANDCOVER.SOIL),"d4-soil");
  assert.equal(d4NaturalTile(LANDCOVER.GRASS),"d4-grass");
  assert.equal(d4NaturalTile(LANDCOVER.TREE),"d4-grass");
});
