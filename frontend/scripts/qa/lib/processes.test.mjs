import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { portInUse, startVite } from "./processes.mjs";

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("portInUse sees a listener and a freed port", async () => {
  const server = await listen();
  const { port } = server.address();
  assert.equal(await portInUse("127.0.0.1", port), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await portInUse("127.0.0.1", port), false);
});

test("startVite refuses a port another server already holds instead of measuring it", async () => {
  const server = await listen();
  const { port } = server.address();
  try {
    await assert.rejects(startVite({ port }), new RegExp(`port ${port} is already in use`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
