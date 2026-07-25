import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  DraftRecoveryStore,
} from "../../src/application/draftRecoveryStore";
import type { KeyValueState } from "../../src/application/draftRecoveryStore";

test("persists and hydrates workspace-scoped draft recovery", async () => {
  const state = new FakeState();
  const store = new DraftRecoveryStore(state);
  store.set("file:///notes/one.md", { source: "local draft", saveRequested: true });
  await store.flush();

  const restored = new DraftRecoveryStore(state);
  assert.deepEqual(restored.get("file:///notes/one.md"), {
    source: "local draft",
    saveRequested: true,
  });
});

test("rejects malformed or unsupported recovery envelopes", () => {
  const malformed = new FakeState({
    schemaVersion: 2,
    entries: [{ uri: "file:///note.md", source: "draft", saveRequested: true }],
  });
  assert.equal(new DraftRecoveryStore(malformed).get("file:///note.md"), undefined);
});

test("serializes recovery updates so a later delete cannot be resurrected", async () => {
  const state = new FakeState();
  const store = new DraftRecoveryStore(state);
  store.set("file:///notes/one.md", { source: "draft", saveRequested: false });
  store.delete("file:///notes/one.md");
  await store.flush();

  assert.equal(new DraftRecoveryStore(state).get("file:///notes/one.md"), undefined);
  assert.equal(state.updateCount, 2);
});

test("continues writing after a persistence rejection", async () => {
  const errors: unknown[] = [];
  const state = new FakeState(undefined, 1);
  const store = new DraftRecoveryStore(state, (error) => errors.push(error));
  store.set("file:///notes/one.md", { source: "first", saveRequested: false });
  store.set("file:///notes/one.md", { source: "latest", saveRequested: true });
  await store.flush();

  assert.equal(errors.length, 1);
  assert.equal(new DraftRecoveryStore(state).get("file:///notes/one.md")?.source, "latest");
});

test("flush waits for writes queued while it is already waiting", async () => {
  const state = new FakeState();
  const store = new DraftRecoveryStore(state);
  const flushing = store.flush();
  store.set("file:///notes/late.md", { source: "late draft", saveRequested: false });
  await flushing;

  assert.equal(new DraftRecoveryStore(state).get("file:///notes/late.md")?.source, "late draft");
});

test("flush retries a lone rejected recovery write", async () => {
  const state = new FakeState(undefined, 1);
  const store = new DraftRecoveryStore(state);
  store.set("file:///notes/retry.md", { source: "recover me", saveRequested: false });
  await store.flush();

  assert.equal(state.updateCount, 2);
  assert.equal(new DraftRecoveryStore(state).get("file:///notes/retry.md")?.source, "recover me");
});

class FakeState implements KeyValueState {
  public updateCount = 0;

  public constructor(
    private value: unknown = undefined,
    private failures = 0,
  ) {}

  public get<T>(_key: string): T | undefined {
    return this.value as T | undefined;
  }

  public async update(_key: string, value: unknown): Promise<void> {
    this.updateCount += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("simulated persistence failure");
    }
    this.value = value;
  }
}
