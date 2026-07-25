# Visp Notes

Visp Notes turns ordinary workspace Markdown files into a connected note system inside VS Code. Markdown remains the source of truth: there is no proprietary note database and no network service.

## Features

- Continuous Markdown editing with one natural CodeMirror document, Live/Markdown modes, undo history, search, bracket matching, list continuation, and explicit sync/conflict status
- `[[wiki links]]`, aliases, heading links, block references, context-aware completion, exact-anchor navigation, and missing-anchor diagnostics
- Backlinks with source context
- Standard Markdown checkbox tasks, Toggle Task, and all/due-today dashboards
- Interactive one- and two-hop local graphs plus a live force-directed workspace graph, with spring motion, connection-scaled nodes, hover neighborhoods, pan, cursor-centered zoom, fit/center controls, non-destructive search, and connection details
- Safe note rename choices with a native before/after diff preview
- Broken-link diagnostics
- Note folders, smart views, tags, full-text search, and index status in the Activity Bar

## Getting started

1. Open a folder containing Markdown files.
2. Open **Visp Notes** from the Activity Bar.
3. Run **Visp Notes: New Note**, or open an existing `.md` file. The editor opens in Live mode; use the toolbar to switch to raw Markdown without changing editors or losing your selection and undo history.
4. Type `[[` anywhere to fuzzy-search notes and aliases. Continue with `#` for headings or `^` for block IDs. You can also press `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS) to insert a note link at the active caret.

New notes are created under `notes/` by default. Change `vispNotes.notesFolder` to use another workspace-relative folder.

## Markdown conventions

Wiki links support aliases, headings, and block IDs:

```md
[[Architecture decisions]]
[[Architecture decisions|system design choices]]
[[Architecture decisions#Indexing]]
[[Architecture decisions^parser-block]]
[[Architecture decisions#Indexing^parser-block]]
```

Add an explicit block ID after a paragraph or heading to make it addressable:

```md
The index is rebuilt from Markdown. ^parser-block
```

In the graph, nodes settle through a live force simulation. Drag any visible dot or label to reshape the graph: linked nodes respond through springs, nearby nodes repel each other, and released nodes settle with momentum. Select a node to keep its neighborhood visible, or use **Reset** to restart the automatic layout. Larger dots indicate more visible connections. Drag empty canvas space to pan, use the wheel or trackpad to zoom around the pointer, and use **Fit** or **Center** to recover the view. Search highlights matches without removing their surrounding context; press Enter or Shift+Enter to cycle through results.

Tasks stay valid Markdown. Optional metadata is read without changing the line:

```md
- [ ] Prototype live editing @due(2026-07-22) @priority(high) #product
      <!-- task:stable-id -->
```

Frontmatter can supply a title, aliases, and tags:

```yaml
---
title: Architecture decisions
aliases: [ADRs, Design records]
tags: [engineering, architecture]
---
```

## Commands

- `Visp Notes: New Note`
- `Visp Notes: New Task`
- `Visp Notes: Toggle Task`
- `Visp Notes: Insert Link`
- `Visp Notes: Show Backlinks`
- `Visp Notes: Open Local Graph`
- `Visp Notes: Open Workspace Graph`
- `Visp Notes: Toggle Live / Markdown`
- `Visp Notes: Rename Note and Update Links`
- `Visp Notes: Find Broken Links`
- `Visp Notes: Rebuild Index`
- `Visp Notes: Search Notes and Tasks`

## Data safety

The index is an in-memory, disposable projection rebuilt from workspace Markdown. Editor changes cross into the extension host as ordered, narrow UTF-16 patches. The host retains the newest draft, coalesces rapid typing, serializes `WorkspaceEdit` calls, and validates the authoritative document before each write. External changes never silently replace local typing: the editor presents an explicit choice to keep the local draft or use the external version. A draft that cannot be applied is stored in workspace-scoped extension state so it can be recovered after a panel or VS Code reload.

Live and Markdown modes are two presentations of the same CodeMirror document. Switching modes therefore preserves the caret, selection, scroll position, and undo history. `Ctrl+S` waits for the latest queued edit before saving.

Heading and block references are validated against their target note. A link is considered healthy only when both the note and every requested anchor exist.

Rename operations are staged: Visp Notes opens a native before/after diff, confirms the destination and affected files, performs an exclusive file rename, revalidates every affected source, and then applies one atomic text-only edit. If validation or content editing fails, it automatically rolls the file name back.

## Development

Requirements: Node.js 20 or newer and VS Code 1.96 or newer.

```sh
npm install
npm run check
npm test
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host. See `docs/architecture.md` for module boundaries and data flow.

## Current scope

Version 0.2 is local-first and workspace-scoped. Collaboration, cloud sync, recurring tasks, semantic search, AI features, spatial canvases, and an external extension API are intentionally outside this release.
