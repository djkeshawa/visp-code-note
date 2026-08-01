import assert = require("node:assert/strict");
import { test } from "node:test";
import { ReminderStore } from "../../src/application/reminderStore";
import type { KeyValueState } from "../../src/application/draftRecoveryStore";

/** An in-memory KeyValueState whose writes can be made to fail on demand. */
function memoryState(failures: { count: number }): KeyValueState & { readonly store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: (key, value) => {
      if (failures.count > 0) {
        failures.count -= 1;
        return Promise.reject(new Error("disk full"));
      }
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

test("a delivered reminder survives a round trip through storage", async () => {
  const failures = { count: 0 };
  const state = memoryState(failures);
  const first = new ReminderStore(state);
  first.markDelivered(["file:///a.md  1000"]);
  await first.flush();

  const second = new ReminderStore(state);
  assert.equal(second.has("file:///a.md  1000"), true);
});

test("flush retries a failed write once, so shutdown does not lose the envelope", async () => {
  const failures = { count: 1 };
  const state = memoryState(failures);
  const store = new ReminderStore(state);
  store.markDelivered(["file:///a.md  1000"]);
  await store.flush();

  assert.equal(
    new ReminderStore(state).has("file:///a.md  1000"),
    true,
    "the retry landed the write the first attempt lost",
  );
});

test("forgetting a reminder lets it be recorded again", async () => {
  const store = new ReminderStore(memoryState({ count: 0 }));
  store.markDelivered(["key"]);
  assert.equal(store.has("key"), true);
  store.forget("key");
  assert.equal(store.has("key"), false);
  store.markDelivered(["key"]);
  assert.equal(store.has("key"), true);
  await store.flush();
});

test("a store with no backing state still answers, and never throws", async () => {
  const store = new ReminderStore(undefined);
  store.markDelivered(["key"]);
  assert.equal(store.has("key"), true);
  await store.flush();
});
