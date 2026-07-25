import assert = require("node:assert/strict");
import { test } from "node:test";
import { DocumentSyncModel } from "../../src/webview/editor/documentSync";
import type {
  DocumentSyncAction,
  HostDocumentState,
} from "../../src/webview/editor/documentSync";
import { applyTextPatch } from "../../src/application/textPatch";

test("loads initial state and distinguishes metadata from clean external changes", () => {
  const model = new DocumentSyncModel();
  assert.deepEqual(model.onHostState(host("one", 1, false)), {
    kind: "initial",
    actions: [{ type: "replace-local", source: "one" }],
  });
  assert.deepEqual(model.onHostState(host("one", 1, true)), {
    kind: "metadata",
    actions: [],
  });
  assert.deepEqual(model.onHostState(host("external", 2, true)), {
    kind: "external",
    actions: [{ type: "replace-local", source: "external" }],
  });
  assert.equal(model.snapshot.localSource, "external");
});

test("emits ordered incremental edits and acknowledges the latest source", () => {
  const model = new DocumentSyncModel(host("one", 1, false));
  const first = onlyEdit(model.onLocalChange("one!"));
  assert.equal(applyTextPatch("one", first.patch), "one!");
  const second = onlyEdit(model.onLocalChange("one!!"));
  assert.equal(second.expectedVersion, 1);
  assert.equal(applyTextPatch("one!", second.patch), "one!!");

  const acknowledged = model.onHostState(host("one!!", 3, true));
  assert.equal(acknowledged.kind, "ack");
  assert.deepEqual(acknowledged.actions, []);
  assert.equal(model.snapshot.localDirty, false);
  assert.equal(model.snapshot.editPending, false);
});

test("accepts an intermediate host acknowledgement while newer typing is queued", () => {
  const model = new DocumentSyncModel(host("base", 1, false));
  const first = onlyEdit(model.onLocalChange("draft A"));
  const second = onlyEdit(model.onLocalChange("draft B"));

  const intermediate = model.onHostState({
    ...host("draft A", 2, true),
    acknowledgedSequence: first.sequence,
  });
  assert.equal(intermediate.kind, "ack");
  assert.equal(model.snapshot.conflict, undefined);
  assert.equal(model.snapshot.editPending, true);
  assert.equal(model.snapshot.localSource, "draft B");

  const latest = model.onHostState({
    ...host("draft B", 3, true),
    acknowledgedSequence: second.sequence,
  });
  assert.equal(latest.kind, "ack");
  assert.equal(model.snapshot.editPending, false);
});

test("settles an edit sequence that returns to the unchanged host source", () => {
  const model = new DocumentSyncModel(host("base", 1, false));
  model.onLocalChange("changed");
  const reverted = onlyEdit(model.onLocalChange("base"));

  const acknowledged = model.onHostState({
    ...host("base", 1, false),
    acknowledgedSequence: reverted.sequence,
  });
  assert.equal(acknowledged.kind, "ack");
  assert.equal(model.snapshot.editPending, false);
});

test("continues edit sequencing after a webview reload handshake", () => {
  const model = new DocumentSyncModel({
    ...host("base", 7, false),
    acknowledgedSequence: 12,
  });
  assert.equal(onlyEdit(model.onLocalChange("next")).sequence, 13);
});

test("enters conflict on an external change and explicitly accepts either side", () => {
  const useExternal = new DocumentSyncModel(host("base", 1, false));
  useExternal.onLocalChange("local");
  assert.equal(useExternal.onHostState(host("external", 2, true)).kind, "conflict");
  assert.equal(useExternal.snapshot.localSource, "local");
  assert.deepEqual(useExternal.useExternal(), [{ type: "replace-local", source: "external" }]);
  assert.equal(useExternal.snapshot.localSource, "external");
  assert.equal(useExternal.snapshot.conflict, undefined);

  const keepLocal = new DocumentSyncModel(host("base", 1, false));
  keepLocal.onLocalChange("local");
  keepLocal.onHostState(host("external", 2, true));
  const retry = onlyEdit(keepLocal.keepLocal());
  assert.equal(retry.expectedVersion, 2);
  assert.equal(applyTextPatch("external", retry.patch), "local");
});

test("updates a conflict with the newest host state and ignores stale states", () => {
  const model = new DocumentSyncModel(host("base", 3, false));
  model.onLocalChange("local");
  model.onHostState(host("external", 4, true));
  assert.equal(model.onHostState(host("stale", 2, true)).kind, "stale");
  assert.equal(model.snapshot.conflict?.source, "external");
  assert.equal(model.onHostState(host("newer external", 5, true)).kind, "conflict");
  assert.equal(model.snapshot.conflict?.source, "newer external");
});

test("queues save until the latest local source is acknowledged", () => {
  const model = new DocumentSyncModel(host("one", 1, false));
  model.onLocalChange("one!");
  assert.deepEqual(model.requestSave(), []);
  const latest = onlyEdit(model.onLocalChange("one!!"));
  assert.equal(latest.save, true);
  assert.equal(applyTextPatch("one!", latest.patch), "one!!");

  const saved = model.onHostState(host("one!!", 3, false));
  assert.equal(saved.kind, "ack");
  assert.equal(model.snapshot.saveRequested, false);
  assert.equal(model.snapshot.savePending, false);
});

test("saves an already synchronized dirty document and observes save metadata", () => {
  const model = new DocumentSyncModel(host("one", 7, true));
  assert.deepEqual(model.requestSave(), [{ type: "save-document" }]);
  assert.equal(model.snapshot.savePending, true);
  assert.equal(model.onHostState(host("one", 7, false)).kind, "metadata");
  assert.equal(model.snapshot.savePending, false);
  assert.equal(model.snapshot.saveRequested, false);
});

test("clears a reported save failure when authoritative state confirms the save", () => {
  const model = new DocumentSyncModel(host("one", 7, true));
  model.requestSave();
  assert.equal(model.markSubmissionFailed(), true);
  assert.equal(model.snapshot.failed, true);
  assert.equal(model.onHostState(host("one", 7, false)).kind, "metadata");
  assert.equal(model.snapshot.failed, false);
  assert.equal(model.snapshot.saveRequested, false);
});

test("does not immediately retry a rejected edit and retries the latest source explicitly", () => {
  const model = new DocumentSyncModel(host("base", 1, false));
  model.onLocalChange("first draft");
  assert.equal(model.markSubmissionFailed(), true);
  assert.deepEqual(model.onLocalChange("latest draft"), []);

  const rejected = model.onHostState(host("base", 1, false));
  assert.equal(rejected.kind, "rejected");
  assert.deepEqual(rejected.actions, []);
  assert.equal(model.snapshot.failed, true);
  assert.equal(model.snapshot.editPending, false);

  const retry = onlyEdit(model.retry());
  assert.equal(applyTextPatch("base", retry.patch), "latest draft");
});

test("preserves the latest local source when only an earlier edit was applied", () => {
  const model = new DocumentSyncModel(host("base", 1, false));
  model.onLocalChange("submitted");
  model.onLocalChange("queued");
  model.markSubmissionFailed();

  const transition = model.onHostState(host("submitted", 2, true));
  assert.equal(transition.kind, "conflict");
  assert.equal(model.snapshot.localSource, "queued");
  const retry = onlyEdit(model.keepLocal());
  assert.equal(applyTextPatch("submitted", retry.patch), "queued");
});

test("produces raw UTF-16 patches for CRLF and emoji edits", () => {
  const before = "# Title\r\nA 😀 note\r\n";
  const after = "# Title\r\nA 😁 note\r\n";
  const model = new DocumentSyncModel(host(before, 10, false));
  const action = onlyEdit(model.onLocalChange(after));
  assert.equal(action.patch.start, before.indexOf("😀"));
  assert.equal(action.patch.end - action.patch.start, 2);
  assert.equal(action.patch.expectedSource, "😀");
  assert.equal(applyTextPatch(before, action.patch), after);
});

test("ignores a submission failure when no write is pending", () => {
  const model = new DocumentSyncModel(host("one", 1, false));
  assert.equal(model.markSubmissionFailed(), false);
  assert.equal(model.snapshot.failed, false);
});

test("rejects a locally invalid edit without leaving synchronization in flight", () => {
  const model = new DocumentSyncModel(host("base", 1, false));
  model.onLocalChange("oversized draft");

  assert.equal(model.rejectCurrentEdit(), true);
  assert.equal(model.snapshot.editPending, false);
  assert.equal(model.snapshot.failed, true);
  assert.deepEqual(model.onLocalChange("latest oversized draft"), []);

  const retry = onlyEdit(model.retry());
  assert.equal(applyTextPatch("base", retry.patch), "latest oversized draft");
});

test("does not leave a prior save in flight when a newer edit is acknowledged", () => {
  const model = new DocumentSyncModel(host("base", 4, true));
  assert.deepEqual(model.requestSave(), [{ type: "save-document" }]);
  const edit = onlyEdit(model.onLocalChange("latest"));

  const acknowledged = model.onHostState({
    ...host("latest", 5, true),
    acknowledgedSequence: edit.sequence,
  });
  assert.equal(acknowledged.kind, "ack");
  assert.equal(model.snapshot.savePending, true);
  assert.deepEqual(acknowledged.actions, [{ type: "save-document" }]);
});

test("allows retry when an edit and an earlier save fail together", () => {
  const model = new DocumentSyncModel(host("base", 4, true));
  model.requestSave();
  model.onLocalChange("latest");

  assert.equal(model.markSubmissionFailed(), true);
  assert.equal(model.snapshot.savePending, false);
  assert.equal(model.onHostState(host("base", 4, true)).kind, "rejected");
  assert.equal(onlyEdit(model.retry()).save, true);
});

test("accepts save-time formatting as the acknowledgement for the latest edit", () => {
  const model = new DocumentSyncModel(host("base", 1, false));
  const edit = onlyEdit(model.onLocalChange("draft"));
  model.requestSave();

  const formatted = model.onHostState({
    ...host("draft\n", 3, false),
    acknowledgedSequence: edit.sequence,
  });
  assert.equal(formatted.kind, "ack");
  assert.deepEqual(formatted.actions, [{ type: "replace-local", source: "draft\n" }]);
  assert.equal(model.snapshot.localSource, "draft\n");
  assert.equal(model.snapshot.conflict, undefined);
});

test("surfaces a recovered host draft as an explicit local-versus-external conflict", () => {
  const model = new DocumentSyncModel(host("external", 5, true));
  const recovered = model.recoverDraft("recovered local", true);

  assert.equal(recovered.kind, "conflict");
  assert.deepEqual(recovered.actions, [{ type: "replace-local", source: "recovered local" }]);
  const retry = onlyEdit(model.keepLocal());
  assert.equal(retry.save, true);
  assert.equal(applyTextPatch("external", retry.patch), "recovered local");
});

function host(source: string, version: number, dirty: boolean): HostDocumentState {
  return { source, version, dirty };
}

function onlyEdit(actions: readonly DocumentSyncAction[]) {
  assert.equal(actions.length, 1);
  const action = actions[0];
  assert.ok(action?.type === "submit-edit");
  return action;
}
