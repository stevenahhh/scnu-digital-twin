import assert from "node:assert/strict";
import test from "node:test";
import { renderPorts } from "./renderPorts.mjs";

test("render ports preserve defaults and accept isolated lane ports", () => {
  assert.deepEqual(renderPorts({}), { server: 5242, devtools: 9382 });
  assert.deepEqual(renderPorts({ MODEL_QA_PORT: "5246", MODEL_QA_DEVTOOLS_PORT: "9386" }),
    { server: 5246, devtools: 9386 });
});

test("invalid or colliding render ports fail before starting servers", () => {
  for (const value of ["", "abc", "1.5", "0", "65536"]) {
    assert.throws(() => renderPorts({ MODEL_QA_PORT: value }), /MODEL_QA_PORT/);
  }
  assert.throws(() => renderPorts({ MODEL_QA_PORT: "9382" }), /distinct/);
});
