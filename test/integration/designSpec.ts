/**
 * The redesign, written down as facts a test can check.
 *
 * This exists because a whole UI redesign once landed with the integration suite green: the
 * suite covered file writes and renames, so nothing it ran could tell whether the interface
 * described by the prototype had actually been built. Every entry here is a value taken from
 * the prototype (`Visp Notes - Redesign.dc.html`), so a change that drifts from the design is
 * a failing test rather than something somebody has to notice in a screenshot.
 *
 * It deliberately checks structure and measurement, not appearance. A test cannot tell whether
 * a panel looks right; it can tell whether the panel exists, is the size the design gives it,
 * and is built from the parts the design is built from.
 */

/** A rule the stylesheets must declare, as `selector` → one required declaration. */
export interface StyleRule {
  readonly file: string;
  readonly selector: string;
  readonly declaration: string;
  /** Why the design fixes this value, so a failure explains itself. */
  readonly because: string;
}

/**
 * The measurements the prototype fixes. Everything else about a view may be tuned; these are
 * the numbers that decide whether it is the same interface.
 */
export const STYLE_RULES: readonly StyleRule[] = [
  {
    file: "base.css",
    selector: "html,\nbody",
    declaration: "padding: 0",
    because:
      "VS Code injects `body { padding: 0 20px }` into every webview it hosts. Left in place " +
      "it insets a side-bar view from both edges, costing it about a sixth of its width, and " +
      "the prototype's own reset zeroes it.",
  },
  {
    file: "base.css",
    selector: ".view-toolbar",
    declaration: "min-height: 44px",
    because: "The tasks and graph views share one 44px header row.",
  },
  {
    file: "base.css",
    selector: ".segmented-control",
    declaration: "height: 26px",
    because: "The Open/All/Done and hop switches are a 26px track with 22px segments.",
  },
  {
    file: "base.css",
    selector: ".search-field",
    declaration: "height: 26px",
    because: "Filter and find fields match the segmented controls beside them.",
  },
  {
    file: "editor.css",
    selector: ".editor-toolbar",
    declaration: "height: 38px",
    because: "The note's whole chrome is one 38px row; it used to be a toolbar plus a strip.",
  },
  {
    file: "editor.css",
    selector: ".editor-body",
    declaration: "grid-template-columns: minmax(0, 1fr) 300px",
    because: "The note inspector is a 300px column beside the note, not an overlay on it.",
  },
  {
    file: "editor.css",
    selector: ".editor-menu",
    declaration: "width: 262px",
    because: "The overflow menu is a 262px popover anchored to the header row.",
  },
  {
    file: "editor.css",
    selector: ".editor-host[data-content-width=\"readable\"]",
    declaration: "--editor-content-max-width: 720px",
    because: "Readable prose is measured at 720px in the prototype.",
  },
  {
    file: "tasks.css",
    selector: ".task-row",
    declaration: "height: 34px",
    because:
      "A task is one 34px row. It was a 63px bordered card, which is why a week of work did " +
      "not fit on a screen.",
  },
  {
    file: "tasks.css",
    selector: ".task-row",
    declaration: "grid-template-columns: 3px 18px minmax(0, 1fr) auto",
    because: "Priority bar, checkbox, text, then the metadata columns.",
  },
  {
    file: "tasks.css",
    selector: ".task-priority",
    declaration: "width: 3px",
    because: "Priority is a bar in the margin, costing the row no horizontal space.",
  },
  {
    file: "graph.css",
    selector: ".graph-details",
    declaration: "width: 290px",
    because: "The selected node is a 290px card floating over the canvas.",
  },
  {
    file: "graph.css",
    selector: ".graph-chip",
    declaration: "height: 26px",
    because: "Graph filters are 26px pills over the top-left of the canvas.",
  },
  {
    file: "editor.css",
    selector: ".is-live-mode .live-frontmatter-line.is-first",
    declaration: "border-radius: 6px 6px 0 0",
    because: "Frontmatter is one rounded property card, not four tinted lines.",
  },
  {
    file: "editor.css",
    selector: ".editor-host.is-live-mode .live-frontmatter-line",
    declaration: "padding-inline: 14px",
    because: "The card is inset from the measure; `.cm-line` holds every other line flush.",
  },
  {
    file: "editor.css",
    selector: ".is-live-mode .live-frontmatter-line .live-frontmatter-key",
    declaration: "min-width: 76px",
    because: "The prototype's card is a 76px key column beside a value column.",
  },
  {
    file: "editor.css",
    selector: ".editor-host.is-live-mode .live-code-line",
    declaration: "padding-inline: 14px",
    because: "A fenced block is a box the code sits inside, not text running to the measure.",
  },
  {
    file: "editor.css",
    selector: ".is-live-mode .live-callout-line.is-first",
    declaration: "padding-top: 12px",
    because: "A callout is padded 12px 14px as one block, not per line.",
  },
  {
    file: "editor.css",
    selector: ".is-live-mode .live-heading-1",
    declaration: "padding-block: 34px 14px",
    because: "The prototype gives h1 a 34px approach and 14px below it.",
  },
  {
    file: "editor.css",
    selector: ".editor-host .cm-tooltip-autocomplete",
    declaration: "width: min(330px, 94vw)",
    because: "The wiki-link popup is a 330px panel in the prototype.",
  },
  {
    file: "workspace.css",
    selector: ".workspace-shell",
    declaration: "--row: 30px",
    because: "Every navigable row in the panel is one height, which the prototype fixes at 30px.",
  },
  {
    file: "workspace.css",
    selector: '.workspace-shell[data-density="compact"]',
    declaration: "--row: 26px",
    because: "The prototype exposes a compact density that drops every row to 26px.",
  },
  {
    file: "workspace.css",
    selector: ".workspace-tag",
    declaration: "height: 22px",
    because: "Tags are 22px pills with a coloured dot and a count.",
  },
  {
    file: "workspace.css",
    selector: ".workspace-status",
    declaration: "min-height: 26px",
    because: "The panel closes with a 26px status line above a top border.",
  },
  {
    file: "base.css",
    selector: ".icon-button",
    declaration: "border-radius: 5px",
    because: "The prototype's icon buttons are 26px on a 5px radius with a 16px glyph.",
  },
  {
    file: "base.css",
    selector: ".segment",
    declaration: "font-weight: 500",
    because:
      "Both segments carry the weight; only background, colour and shadow move, so the " +
      "selection lifts rather than jumping as the text reflows.",
  },
  {
    file: "base.css",
    selector: ".view-footer",
    declaration: "height: 24px",
    because: "The footer is a fixed 24px row, not one that grows with its content.",
  },
  {
    file: "graph.css",
    selector: ".graph-node.is-selected .node-shape,\n.graph-node:focus-visible .node-shape",
    declaration: "stroke-width: 5",
    because: "The selection is a flat 5px ring flush against the dot, not a blurred bloom.",
  },
  {
    file: "editor.css",
    selector: ".editor-host .wiki-completion-footer",
    declaration: "border-top: 1px solid var(--visp-hairline)",
    because: "The popup closes with the three suffixes a wiki link accepts.",
  },
  {
    file: "graph.css",
    selector: ".graph-node.is-orphan .node-shape",
    declaration: "fill: var(--visp-muted)",
    because:
      "An orphan is the solid muted disc its filter chip advertises. It shared the dashed " +
      "outline that means unresolved, so two states looked the same and neither matched " +
      "the legend beside them.",
  },
  {
    file: "graph.css",
    selector: ".graph-canvas",
    declaration: "background-image: radial-gradient(circle at 46% 48%, var(--visp-brand-soft), transparent 55%)",
    because: "The canvas carries the prototype's centre-weighted glow, not a vignette.",
  },
];

/** The prose palette, exactly as the prototype declares it for each polarity. */
export const PALETTE: readonly { readonly token: string; readonly dark: string; readonly light: string }[] = [
  { token: "--visp-hue-structure", dark: "#7fb6d8", light: "#1f5f84" },
  { token: "--visp-hue-reference", dark: "#ad86dd", light: "#6a3f9e" },
  { token: "--visp-hue-string", dark: "#6fc99a", light: "#186b46" },
  { token: "--visp-hue-declare", dark: "#dcc978", light: "#7a5a0d" },
  { token: "--visp-hue-literal", dark: "#f2965f", light: "#a8480f" },
  { token: "--visp-hue-accentuate", dark: "#e88aa5", light: "#a32d55" },
];

/** A part of a view the design requires, identified by the hook the code renders it with. */
export interface MarkupRequirement {
  readonly hook: string;
  readonly what: string;
}

export const EDITOR_MARKUP: readonly MarkupRequirement[] = [
  { hook: 'id="note-title"', what: "the note's title in the header row" },
  { hook: 'id="note-breadcrumb"', what: "the folder the note lives in" },
  { hook: 'id="note-tags"', what: "the note's tag chips" },
  { hook: 'id="note-tags-summary"', what: "the collapsed tag pill for a narrow pane" },
  { hook: 'id="toggle-inspector"', what: "the inspector toggle carrying the backlink count" },
  { hook: 'id="live-mode"', what: "the Live segment" },
  { hook: 'id="markdown-mode"', what: "the Markdown segment" },
  { hook: 'id="sync-status"', what: "the save-state pill" },
  { hook: 'id="editor-menu"', what: "the overflow menu" },
  { hook: 'data-command="insertLink"', what: "Insert Link in the overflow menu" },
  { hook: 'data-command="newTask"', what: "New Task in the overflow menu" },
  { hook: 'data-command="renameNote"', what: "Rename Note in the overflow menu" },
  { hook: 'data-command="findBrokenLinks"', what: "Find Broken Links in the overflow menu" },
  { hook: 'data-command="openLocalGraph"', what: "Open Local Graph in the overflow menu" },
  { hook: 'data-command="rebuildIndex"', what: "Rebuild Index in the overflow menu" },
  { hook: 'data-width="readable"', what: "the Readable content width" },
  { hook: 'data-width="wide"', what: "the Wide content width" },
  { hook: 'data-width="full"', what: "the Full content width" },
  { hook: 'id="note-inspector"', what: "the inspector column" },
  { hook: 'id="inspector-outline"', what: "the inspector's Outline section" },
  { hook: 'id="inspector-backlinks"', what: "the inspector's Backlinks section" },
  { hook: 'id="inspector-tasks"', what: "the inspector's Tasks in this note section" },
  { hook: 'id="inspector-links"', what: "the inspector's Links out section" },
  { hook: 'class="editor-body view-body"', what: "the growing region of the shell" },
];

export const TASKS_MARKUP: readonly MarkupRequirement[] = [
  { hook: 'id="task-summary"', what: "the open/due-today summary beside the title" },
  { hook: 'id="task-search"', what: "the filter field" },
  { hook: 'data-status="open"', what: "the Open status segment" },
  { hook: 'data-status="all"', what: "the All status segment" },
  { hook: 'data-status="completed"', what: "the Done status segment" },
  { hook: 'id="task-group-by"', what: "the grouping control" },
  { hook: 'class="view-footer"', what: "the footer reporting how much is shown" },
  { hook: "Space toggles", what: "the footer's keyboard hint" },
];

export const GRAPH_MARKUP: readonly MarkupRequirement[] = [
  { hook: 'id="graph-summary"', what: "the scope and size line beside the title" },
  { hook: 'id="graph-search"', what: "the find-a-node field" },
  { hook: 'data-depth="1"', what: "the 1 hop segment" },
  { hook: 'data-depth="2"', what: "the 2 hops segment" },
  { hook: 'class="graph-filters"', what: "the filter chips over the canvas" },
  { hook: 'data-kind="note"', what: "the Notes filter" },
  { hook: 'data-kind="tag"', what: "the Tags filter" },
  { hook: 'data-kind="unresolved"', what: "the Unresolved filter" },
  { hook: 'data-kind="task"', what: "the Tasks filter" },
  { hook: 'id="show-orphans"', what: "the Orphans filter" },
  { hook: 'class="graph-viewport-controls"', what: "the zoom cluster" },
  { hook: 'id="graph-zoom-status"', what: "the zoom percentage" },
  { hook: 'id="graph-fit"', what: "fit all nodes" },
  { hook: 'id="graph-center"', what: "center the selection" },
  { hook: 'id="graph-reset"', what: "restart the layout" },
  { hook: 'id="graph-details"', what: "the selected-node card" },
  { hook: 'id="graph-details-close"', what: "the card's dismiss control" },
  { hook: 'id="open-selected"', what: "the card's Open note button" },
];

/** The parts the workspace panel is built from, as the prototype draws it. */
export const WORKSPACE_MARKUP: readonly MarkupRequirement[] = [
  { hook: 'id="workspace-filter"', what: "the search field inside the panel" },
  { hook: 'id="workspace-views"', what: "the Views section" },
  { hook: 'id="workspace-notes"', what: "the Notes section" },
  { hook: 'id="workspace-note-count"', what: "the note count beside the Notes label" },
  { hook: 'id="workspace-tags"', what: "the Tags section" },
  { hook: 'id="workspace-status"', what: "the footer reporting what the index holds" },
  { hook: 'id="workspace-status-indexed"', what: "how fresh the index is" },
  { hook: 'class="section-rule workspace-section"', what: "the labelled section rules" },
  { hook: 'id="workspace-menu"', what: "the menu a note offers besides opening it" },
  { hook: 'data-action="rename"', what: "Rename Note in that menu" },
  { hook: 'data-action="graph"', what: "Open Local Graph in that menu" },
];

/** The Views section, in the order the prototype lists it — today's work first. */
export const TREE_VIEWS: readonly { readonly label: string; readonly icon: string }[] = [
  { label: "Due Today", icon: "calendar" },
  { label: "All Tasks", icon: "checklist" },
  { label: "Knowledge Graph", icon: "type-hierarchy" },
  { label: "Broken Links", icon: "warning" },
  { label: "Orphan Notes", icon: "circle-slash" },
];

/** The hues the tree paints tags with, which must be the ones package.json contributes. */
export const CONTRIBUTED_COLOUR_IDS: readonly string[] = [
  "vispNotes.hueStructure",
  "vispNotes.hueReference",
  "vispNotes.hueString",
  "vispNotes.hueDeclare",
  "vispNotes.hueLiteral",
  "vispNotes.hueAccentuate",
];
