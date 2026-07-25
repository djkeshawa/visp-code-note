import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { parseMarkdown } from "../../markdown/parser";
import { planTaskLine } from "../../application/taskLine";
import { toggleTaskInSource } from "../../application/taskEditing";
import type { CommandIndex } from "./contracts";
import { activeMarkdownUri, pickNote } from "./commandUtils";
import { revealOffset, toRange } from "../documentEdits";

export async function createTask(index: CommandIndex, customEditorUri?: vscode.Uri): Promise<void> {
  const activeUri = activeMarkdownUri() ?? customEditorUri;
  const target = activeUri
    ? index.findNote(activeUri)
    : await pickNote(index.snapshot.notes, "Choose the note that will own this task");
  if (!target) {
    void vscode.window.showInformationMessage("Create or open a Markdown note before adding a task.");
    return;
  }

  const text = await vscode.window.showInputBox({
    title: "New Visp Task",
    prompt: `Add a task to ${target.title}`,
    validateInput: (value) => (value.trim() ? undefined : "Task text is required."),
  });
  if (!text?.trim()) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.uri));
  const source = document.getText();
  const prefix = source.length === 0 || source.endsWith("\n") ? "" : "\n";
  const taskId = randomUUID();
  const taskLine = `${prefix}- [ ] ${text.trim()} <!-- task:${taskId} -->\n`;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(source.length), taskLine);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("VS Code could not add the task to the note.");
  }
  await index.refresh(document.uri);
  await revealOffset(document.uri, source.length + prefix.length);
}

export async function toggleTask(
  index: CommandIndex,
  noteUri: string,
  indexedStart: number,
  expectedId: string | undefined,
  expectedCompleted: boolean,
  expectedVersion: number,
): Promise<void> {
  const uri = vscode.Uri.parse(noteUri);
  if (index.snapshot.version !== expectedVersion) {
    void vscode.window.showWarningMessage("The task dashboard changed. Visp Notes refreshed it before editing.");
    await index.refresh(uri);
    return;
  }
  const indexedTask = index.snapshot.tasks.find(
    (task) =>
      task.noteUri === noteUri &&
      task.range.start === indexedStart &&
      task.id === expectedId &&
      task.completed === expectedCompleted,
  );
  const indexedNote = index.snapshot.notes.find((note) => note.uri === noteUri);
  if (!indexedTask || !indexedNote) {
    void vscode.window.showWarningMessage("This task changed since the dashboard rendered. Nothing was edited.");
    await index.refresh(uri);
    return;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const currentSource = document.getText();
  const expectedSource = indexedNote.content.slice(indexedTask.range.start, indexedTask.range.end);
  if (currentSource.slice(indexedTask.range.start, indexedTask.range.end) !== expectedSource) {
    void vscode.window.showWarningMessage("This task moved or changed. Visp Notes refreshed instead of risking the wrong edit.");
    await index.refresh(uri);
    return;
  }
  const currentTask = parseMarkdown(currentSource).tasks.find(
    (task) =>
      task.range.start === indexedTask.range.start &&
      task.id === indexedTask.id &&
      task.text === indexedTask.text &&
      task.completed === indexedTask.completed,
  );
  if (!currentTask) {
    await index.refresh(uri);
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const toggledSource = toggleTaskInSource(currentSource, currentTask);
  edit.replace(
    uri,
    toRange(document, currentTask.checkboxRange),
    toggledSource.slice(currentTask.checkboxRange.start, currentTask.checkboxRange.end),
  );
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("VS Code could not update the task checkbox.");
  }
  await index.refresh(uri);
}

export async function toggleTaskAtEditor(index: CommandIndex): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") {
    void vscode.window.showInformationMessage("Open a Markdown document before toggling a task.");
    return;
  }

  const startLine = editor.selection.start.line;
  const endLine = editor.selection.end.line > startLine && editor.selection.end.character === 0
    ? editor.selection.end.line - 1
    : editor.selection.end.line;
  let singleCaret: vscode.Position | undefined;
  const plans = Array.from({ length: endLine - startLine + 1 }, (_, indexOffset) => {
    const lineNumber = startLine + indexOffset;
    const line = editor.document.lineAt(lineNumber);
    return { line, plan: planTaskLine(line.text, randomUUID()) };
  });

  const applied = await editor.edit((builder) => {
    for (const { line, plan } of plans) {
      if (plan.kind === "toggle") {
        builder.replace(
          new vscode.Range(line.lineNumber, plan.start, line.lineNumber, plan.end),
          plan.text,
        );
      } else {
        builder.replace(line.range, plan.text);
        if (plans.length === 1 && plan.caretOffset !== undefined) {
          singleCaret = new vscode.Position(line.lineNumber, plan.caretOffset);
        }
      }
    }
  });
  if (!applied) {
    throw new Error("VS Code could not toggle the selected task line.");
  }
  if (singleCaret) {
    editor.selection = new vscode.Selection(singleCaret, singleCaret);
  }
  await index.refresh(editor.document.uri);
}
