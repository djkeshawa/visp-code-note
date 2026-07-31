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

const DAY = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "vispNotes.noteDraftRecoveries.v1";

test("drops the oldest drafts rather than carrying every note ever stranded", async () => {
  const state = new FakeState();
  const store = new DraftRecoveryStore(state);
  for (let index = 0; index < 20; index += 1) {
    store.set(`file:///notes/${index}.md`, { source: `draft ${index}`, saveRequested: false });
  }
  await store.flush();

  const restored = new DraftRecoveryStore(state);
  assert.equal(restored.get("file:///notes/0.md"), undefined);
  assert.equal(restored.get("file:///notes/3.md"), undefined);
  assert.equal(restored.get("file:///notes/4.md")?.source, "draft 4");
  assert.equal(restored.get("file:///notes/19.md")?.source, "draft 19");
  assert.equal(readEntries(state).length, 16);
});

test("drops the oldest drafts once they outweigh the size budget", async () => {
  const state = new FakeState();
  const store = new DraftRecoveryStore(state);
  for (const name of ["first", "second", "third"]) {
    store.set(`file:///notes/${name}.md`, { source: "x".repeat(3_000_000), saveRequested: false });
  }
  await store.flush();

  assert.deepEqual(readEntries(state).map((entry) => entry.uri), [
    "file:///notes/second.md",
    "file:///notes/third.md",
  ]);
});

test("keeps the newest draft even when it alone exceeds the size budget", async () => {
  const state = new FakeState();
  const store = new DraftRecoveryStore(state);
  store.set("file:///notes/huge.md", { source: "x".repeat(9_000_000), saveRequested: true });
  await store.flush();

  assert.equal(new DraftRecoveryStore(state).get("file:///notes/huge.md")?.saveRequested, true);
});

test("forgets a draft nobody came back for", () => {
  const state = new FakeState({
    schemaVersion: 1,
    entries: [
      { uri: "file:///notes/stale.md", source: "abandoned", saveRequested: false, updatedAt: Date.now() - 15 * DAY },
      { uri: "file:///notes/recent.md", source: "still wanted", saveRequested: false, updatedAt: Date.now() - 1 * DAY },
    ],
  });
  const store = new DraftRecoveryStore(state);

  assert.equal(store.get("file:///notes/stale.md"), undefined);
  assert.equal(store.get("file:///notes/recent.md")?.source, "still wanted");
});

test("an unrelated write does not reset how old the other drafts are", async () => {
  /*
   * Every entry used to be restamped with the current time whenever the envelope was written,
   * so editing any note aged all the others forward and none of them ever reached the cutoff.
   * The stamp has to record when this draft was stranded, not when the envelope was serialized.
   */
  const stranded = Date.now() - 13 * DAY;
  const state = new FakeState({
    schemaVersion: 1,
    entries: [
      { uri: "file:///notes/old.md", source: "old draft", saveRequested: false, updatedAt: stranded },
    ],
  });
  const store = new DraftRecoveryStore(state);
  store.set("file:///notes/new.md", { source: "new draft", saveRequested: false });
  await store.flush();

  const kept = readEntries(state).find((entry) => entry.uri === "file:///notes/old.md");
  assert.equal(kept?.updatedAt, stranded);
});

function readEntries(state: FakeState): readonly { uri: string; updatedAt: number }[] {
  const envelope = state.get<{ entries: readonly { uri: string; updatedAt: number }[] }>(STORAGE_KEY);
  return envelope?.entries ?? [];
}

class FakeState implements KeyValueState {
  public updateCount = 0;

  public constructor(
    private value: unknown = undefined,
    private failures = 0,
  ) {}

  public get<T>(_key: string): T | undefined {
    return this.value as T | undefined;
  }

  public update(_key: string, value: unknown): Promise<void> {
    this.updateCount += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error("simulated persistence failure"));
    }
    this.value = value;
    return Promise.resolve();
  }
}
