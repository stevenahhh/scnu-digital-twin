import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const designDoc = readFileSync(new URL("../../../DESIGN.md", import.meta.url), "utf8");
const FAMILIES = "colors|text|rounded|shadow|motion|layer";

const declared = new Set([...tokensCss.matchAll(new RegExp(`(--(?:${FAMILIES})-[a-z0-9-]*[a-z0-9]):`, "g"))].map((m) => m[1]));
const documented = new Set([...designDoc.matchAll(new RegExp(`(--(?:${FAMILIES})-[a-z0-9-]*[a-z0-9])`, "g"))].map((m) => m[1]));

test("tokens.css declares the token families DESIGN.md documents", () => {
  assert.ok(declared.size > 0, "no tokens found in tokens.css");
});

test("every token declared in tokens.css is documented in DESIGN.md", () => {
  const undocumented = [...declared].filter((name) => !documented.has(name));
  assert.deepEqual(undocumented, [], `undocumented token ${undocumented.join(", ")}`);
});

test("every token named in DESIGN.md exists in tokens.css", () => {
  const unknown = [...documented].filter((name) => !declared.has(name));
  assert.deepEqual(unknown, [], `DESIGN.md names a token tokens.css does not declare: ${unknown.join(", ")}`);
});
