import assert = require("node:assert/strict");
import { test } from "node:test";
import type {
  EditorToHostMessage,
  GraphToHostMessage,
  HostToEditorMessage,
  HostToGraphMessage,
  HostToTasksMessage,
  HostToWorkspaceMessage,
  TasksToHostMessage,
  WorkspaceToHostMessage,
} from "../../src/domain/protocol";
import type {
  EditorToHostWire,
  GraphToHostWire,
  HostToEditorWire,
  HostToGraphWire,
  HostToTasksWire,
  HostToWorkspaceWire,
  TasksToHostWire,
  WorkspaceToHostWire,
} from "../../src/webview/contracts";

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2)
    ? (<Type>() => Type extends Right ? 1 : 2) extends
      (<Type>() => Type extends Left ? 1 : 2) ? true : false
    : false;

const conformance: readonly [
  Equal<HostToEditorMessage, HostToEditorWire>,
  Equal<EditorToHostMessage, EditorToHostWire>,
  Equal<HostToTasksMessage, HostToTasksWire>,
  Equal<TasksToHostMessage, TasksToHostWire>,
  Equal<HostToGraphMessage, HostToGraphWire>,
  Equal<GraphToHostMessage, GraphToHostWire>,
  Equal<HostToWorkspaceMessage, HostToWorkspaceWire>,
  Equal<WorkspaceToHostMessage, WorkspaceToHostWire>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

test("browser wire contracts conform to extension-host protocols", () => {
  assert.equal(conformance.every(Boolean), true);
});
