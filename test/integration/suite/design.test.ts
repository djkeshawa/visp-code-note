import * as vscode from "vscode";
import { assert, integrationTest, waitFor, writeFileText } from "../harness";
import {
  CONTRIBUTED_COLOUR_IDS,
  EDITOR_MARKUP,
  GRAPH_MARKUP,
  PALETTE,
  STYLE_RULES,
  TASKS_MARKUP,
  TREE_VIEWS,
  WORKSPACE_MARKUP,
} from "../designSpec";
import type { MarkupRequirement } from "../designSpec";
import {
  createEditorHtml,
  createGraphHtml,
  createTasksHtml,
  createWorkspaceHtml,
} from "../../../src/ui";
import { WorkspaceIndex } from "../../../src/indexing/workspaceIndex";
import { WorkspacePanel } from "../../../src/vscode/providers/workspacePanel";
import { IndexStatusItem } from "../../../src/vscode/providers/indexStatusItem";

/**
 * Does the interface the prototype describes actually exist?
 *
 * The rest of this suite proves the extension writes the right bytes to the right files. None
 * of it could tell whether the views were the ones that were designed — which is how a whole
 * redesign shipped with a side-bar panel inset by VS Code's injected body padding, invisible
 * to every test and to a browser preview that never applies that padding.
 *
 * These run in the extension host because that is the only place the real thing exists: the
 * tree is built by VS Code's own API, and the pages are generated against a real `Webview`
 * whose `asWebviewUri` resolves the stylesheets they are supposed to load.
 */

function extensionUri(): vscode.Uri {
  const extension = vscode.extensions.getExtension("visp-code-note.visp-notes");
  if (extension === undefined) throw new Error("The Visp Notes extension is not loaded.");
  return extension.extensionUri;
}

function workspaceRoot(): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root === undefined) throw new Error("The integration workspace is not open.");
  return root.uri;
}

/** Generates a page against a real webview, so its asset URLs are the ones VS Code will serve. */
function renderPage(
  build: (options: { webview: vscode.Webview; extensionUri: vscode.Uri }) => string,
): string {
  const panel = vscode.window.createWebviewPanel(
    "vispNotes.designConformance",
    "Design conformance",
    { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
    { enableScripts: false, localResourceRoots: [vscode.Uri.joinPath(extensionUri(), "media")] },
  );
  try {
    return build({ webview: panel.webview, extensionUri: extensionUri() });
  } finally {
    panel.dispose();
  }
}

function assertMarkup(
  page: string,
  html: string,
  requirements: readonly MarkupRequirement[],
): void {
  const missing = requirements.filter((requirement) => !html.includes(requirement.hook));
  assert.deepEqual(
    missing.map((requirement) => `${requirement.what} (${requirement.hook})`),
    [],
    `${page} is missing parts the design requires`,
  );
}

async function readStylesheet(file: string): Promise<string> {
  const uri = vscode.Uri.joinPath(extensionUri(), "media", file);
  const bytes = await vscode.workspace.fs.readFile(uri);
  // Comments explain the design; they must not be able to satisfy a check about it.
  return new TextDecoder().decode(bytes).replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Every declaration made for `selector`, from all of its rules.
 *
 * A selector is routinely written more than once — `body.vscode-light` sets the colour scheme
 * in one block and the light palette in another — so reading only the first block answers a
 * question about the second one wrongly.
 */
function ruleBody(css: string, selector: string): string | undefined {
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const wanted = normalize(selector);
  const bodies: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map(normalize);
    if (selectors.includes(wanted) || normalize(match[1] ?? "") === wanted) {
      bodies.push(match[2] ?? "");
    }
  }
  return bodies.length === 0 ? undefined : bodies.join("\n");
}

integrationTest("every view is built from the parts the design gives it", () => {
  assertMarkup("The note editor", renderPage(createEditorHtml), EDITOR_MARKUP);
  assertMarkup("The task list", renderPage(createTasksHtml), TASKS_MARKUP);
  assertMarkup("The graph", renderPage(createGraphHtml), GRAPH_MARKUP);
  assertMarkup("The workspace panel", renderPage(createWorkspaceHtml), WORKSPACE_MARKUP);
  return Promise.resolve();
});

integrationTest("every view loads the stylesheets that carry the design", () => {
  const pages: readonly [string, string, readonly string[]][] = [
    ["The note editor", renderPage(createEditorHtml), ["base.css", "editor.css", "editor-drafts.css"]],
    ["The task list", renderPage(createTasksHtml), ["base.css", "tasks.css"]],
    ["The graph", renderPage(createGraphHtml), ["base.css", "graph.css"]],
    ["The workspace panel", renderPage(createWorkspaceHtml), ["base.css", "workspace.css"]],
  ];
  for (const [name, html, stylesheets] of pages) {
    for (const stylesheet of [...stylesheets, "codicons/codicon.css"]) {
      assert.ok(html.includes(stylesheet), `${name} does not load ${stylesheet}`);
    }
  }
  return Promise.resolve();
});

integrationTest("the design's fixed measurements are the ones the stylesheets declare", async () => {
  const sheets = new Map<string, string>();
  const failures: string[] = [];
  for (const rule of STYLE_RULES) {
    let css = sheets.get(rule.file);
    if (css === undefined) {
      css = await readStylesheet(rule.file);
      sheets.set(rule.file, css);
    }
    const body = ruleBody(css, rule.selector);
    if (body === undefined) {
      failures.push(`${rule.file} declares no rule for \`${rule.selector}\` — ${rule.because}`);
      continue;
    }
    const wanted = rule.declaration.replace(/\s+/g, " ");
    if (!body.replace(/\s+/g, " ").includes(wanted)) {
      failures.push(
        `${rule.file} \`${rule.selector}\` does not declare \`${rule.declaration}\` — ${rule.because}`,
      );
    }
  }
  assert.deepEqual(failures, [], "the stylesheets have drifted from the design");
});

integrationTest("the prose palette is the one the design specifies, in both polarities", async () => {
  const css = await readStylesheet("base.css");
  const root = ruleBody(css, ":root");
  const light = ruleBody(css, "body.vscode-light");
  assert.ok(root !== undefined, "base.css declares no :root token block");
  assert.ok(light !== undefined, "base.css declares no light-theme override block");
  for (const hue of PALETTE) {
    assert.ok(
      root.includes(`${hue.token}: ${hue.dark}`),
      `${hue.token} is not ${hue.dark} in the dark palette`,
    );
    assert.ok(
      light.includes(`${hue.token}: ${hue.light}`),
      `${hue.token} is not ${hue.light} in the light palette`,
    );
  }
});

/*
 * The regression that prompted this suite. VS Code injects `body { padding: 0 20px }` into
 * every webview; a reset that only zeroes margin leaves it, and a side-bar view loses about a
 * sixth of its width to an inset nothing in the design asks for. A browser preview cannot
 * catch it — the injected rule only exists inside VS Code.
 */
integrationTest("no view inherits VS Code's injected body padding", async () => {
  const body = ruleBody(await readStylesheet("base.css"), "html,\nbody");
  assert.ok(body !== undefined, "base.css declares no html/body reset");
  assert.ok(
    /padding:\s*0\b/.test(body),
    "the reset does not zero body padding, so every webview is inset by VS Code's default",
  );
});

/** Builds the status item against the live index and reads back what it would display. */
function indexStatusText(index: WorkspaceIndex): string {
  const status = new IndexStatusItem(index);
  try {
    return status.presentation.text;
  } finally {
    status.dispose();
  }
}

/** Builds the panel against the live index and reads back the state it would render. */
async function panelState(): Promise<ReturnType<WorkspacePanel["stateForTests"]>> {
  const index = new WorkspaceIndex();
  try {
    await index.initialize();
    const panel = new WorkspacePanel(extensionUri(), index, {
      openNote: () => Promise.resolve(),
      openTasks: () => {},
      openGraph: () => {},
      revealTask: () => Promise.resolve(),
      toggleTask: () => Promise.resolve(),
    });
    try {
      return panel.stateForTests();
    } finally {
      panel.dispose();
    }
  } finally {
    index.dispose();
  }
}

integrationTest("the workspace panel leads with today's work and the design's icons", async () => {
  const state = await panelState();
  assert.deepEqual(
    state.views.map((view) => ({ label: view.label, icon: view.icon })),
    [...TREE_VIEWS],
    "the Views section drifted from the design",
  );
});

integrationTest("a note row reports how connected it is", async () => {
  const root = workspaceRoot();
  await writeFileText(
    vscode.Uri.joinPath(root, "design", "hub.md"),
    "# Hub\n\nSee [[Spoke]] and [[Spoke]] again.\n",
  );
  await writeFileText(vscode.Uri.joinPath(root, "design", "spoke.md"), "# Spoke\n");
  await writeFileText(vscode.Uri.joinPath(root, "design", "alone.md"), "# Alone\n");
  await waitFor("the design fixtures to reach the index", async () => {
    const state = await panelState();
    return state.notes.filter((note) => note.path.startsWith("design/")).length === 3;
  });

  const state = await panelState();
  const rows = new Map(state.notes.map((note) => [note.title, note]));
  // Linked twice, but one neighbour: the count is 1, not 2.
  assert.equal(rows.get("Hub")?.links, 1, "Hub should report one neighbour");
  assert.equal(rows.get("Spoke")?.links, 1, "Spoke should report one neighbour");
  assert.equal(rows.get("Alone")?.links, 0, "a note linked to nothing reports nothing");
  assert.ok(state.folders.some((folder) => folder.path === "design"));
});

integrationTest("the panel footer and the status bar report the same two figures", async () => {
  const index = new WorkspaceIndex();
  try {
    await index.initialize();
    const { notes, tasks } = index.snapshot;
    const expected = `${notes.length} note${notes.length === 1 ? "" : "s"} · ${
      tasks.length
    } task${tasks.length === 1 ? "" : "s"}`;
    /*
     * The status bar prints the same phrase. It used to count open tasks while the panel
     * counted all of them, so the two said "6 tasks" and "7 tasks" a few pixels apart.
     */
    assert.ok(
      indexStatusText(index).endsWith(expected),
      "the status bar and the panel footer disagree about the workspace",
    );
  } finally {
    index.dispose();
  }
});

integrationTest("every hue the panel paints with is a colour the extension contributes", () => {
  const packageJson = vscode.extensions.getExtension("visp-code-note.visp-notes")?.packageJSON as
    { readonly contributes?: { readonly colors?: readonly { readonly id: string }[] } };
  const contributed = new Set((packageJson.contributes?.colors ?? []).map((colour) => colour.id));
  const missing = CONTRIBUTED_COLOUR_IDS.filter((id) => !contributed.has(id));
  assert.deepEqual(missing, [], "the panel names colours package.json does not contribute");
  return Promise.resolve();
});
