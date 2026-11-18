import assert from "node:assert/strict";
import test from "node:test";
import { statusTabAlerts, totalTabAlerts } from "./tabAlerts.mjs";

const up = { status: "live" };
const down = { status: "down" };

test("the status tab counts broken feeds and active restrictions", () => {
  assert.deepEqual(statusTabAlerts({ weather: down, traffic: up, energy: down }, [{ id: "a" }]), { status: 3 });
});

test("nothing to look at leaves no alert, and the total adds the tabs", () => {
  assert.deepEqual(statusTabAlerts({ weather: up, traffic: up, energy: up }, []), {});
  assert.equal(totalTabAlerts({}), 0);
  assert.equal(totalTabAlerts({ status: 2, building: 1 }), 3);
});
