# Changelog

## 0.3.0 - 2026-07-26

### Performance

- **Replaced the graph's repulsion algorithm with Barnes–Hut quadtree repulsion.** Past 140 nodes the previous code stopped comparing each node with its actual neighbours and instead repelled it against a fixed 42 nodes picked by hash order, so large workspaces stopped separating and piled up. On a 3,342-node graph, overlapping node pairs fall from 1,345 to 156 and the median gap between neighbours rises from 19px to 48px, at an unchanged per-frame cost.
- The layout area now grows with the node count. A few thousand nodes cannot fit in the old fixed 960×640 canvas whatever the algorithm does, so repulsion and the boundary force were fighting each other.
- The simulation runs on reusable typed arrays instead of one object per node per frame, removing the main source of garbage-collection pauses during animation.
- Hover, selection, and search emphasis now diff against the state already on screen instead of re-querying the SVG and rewriting every class. On a 3,342-node graph a hover costs 0.5ms instead of 12.7ms.
- Per-frame position writes are skipped for nodes that moved less than the rounding threshold, so the closing frames of a large layout are nearly free.
- Standing graph labels are capped at a fixed budget given to the most connected nodes. A degree threshold still labelled 52% of a large workspace; the budget keeps it at roughly 1%.
- Node lookups during hover and selection use a map rather than scanning the node list.
- With reduced motion the graph now settles to rest in one bounded pass. Previously the animation loop simply never ran, leaving those viewers looking at the unfinished opening layout.
- Added `test/benchmarks/graphPerformance.bench.ts`, which reports layout cost *and* layout quality so a change that trades correctness for speed cannot pass unnoticed.

### Changed

- **The Visp Notes editor is now opt-in.** Installing the extension no longer replaces VS Code's text editor for every `.md` file in the workspace. The custom editor is offered through **Reopen Editor With…**, and **Visp Notes: Use Visp Notes as the Default Markdown Editor** turns it on for all Markdown by writing the standard `workbench.editorAssociations` setting. Extension-driven opens (New Note, tree items, wiki links, local graph) still use it directly.
- Slimmed the note editor's chrome to one compact row: removed the redundant Save button in favour of `Ctrl/Cmd+S` and the tab's dirty indicator, and moved the width control into a new document context strip. A Retry button now appears only when a change could not be applied.
- Note content defaults to a readable measure rather than a wide one, and the choice is stored in the new `vispNotes.editor.contentWidth` setting so every open note agrees instead of each tab remembering its own.
- Graph node labels are granted to focus, selection, and hub nodes, and to every node in a small graph; in a crowded graph the rest reveal their label on hover, focus, or search match.
- Consolidated CodeMirror styling into `media/editor.css`. The JS theme now only owns Lezer token colors, which removes the competing `.cm-line`, `.cm-content`, and `.cm-tooltip` rules whose winner depended on stylesheet injection order.
- Replaced text glyphs (`↗`, `⌕`, `−`) with Codicons across the editor, tasks, and graph views.

### Added

- A document context strip in the note editor showing the note's folder breadcrumb, tags, backlink count, links out, and open tasks.
- Live presentation for callouts (`> [!note]`, `> [!warning]`, and aliases across six tones), inline code pills, thematic breaks, and frontmatter rendered as a property block.
- Tasks appear directly in the Activity Bar under **All Tasks** and **Due Today** with checkboxes, so a task can be completed without opening its note.
- A group-by control in the Tasks view: by due date, by note, or by tag.
- `vispNotes.editor.contentWidth` setting.
- Extension manifest now declares `capabilities.untrustedWorkspaces` and `capabilities.virtualWorkspaces`, plus Marketplace gallery metadata.
- ESLint with type-aware rules, an `.editorconfig`, and a GitHub Actions workflow running lint, type-check, tests, build, and packaging.

### Fixed

- Restored the `MIT` value in the package manifest's `license` field, which had regressed to `SEE LICENSE IN LICENSE` and showed as an unknown license on the Marketplace.
- The Tasks view no longer double-counts a task that carries several tags when grouping by tag.
- Theme tokens fall back to CSS system colors instead of fixed dark hex values, so a theme that omits a token can no longer paint dark chrome into a light window.
- `withoutDefaultEditor` leaves a Markdown editor association alone when another extension owns it.

## 0.2.1 - 2026-07-26

- Added the Visp Notes Marketplace icon and publication metadata.
- Expanded the Live and Markdown editors with responsive page widths and a persisted Readable, Wide, or Full layout control.

## 0.2.0 - 2026-07-22

- Improved graph navigation with a live force simulation, spring-connected draggable nodes, collision spacing, momentum and natural settling, layout reset, connection-scaled nodes, hover neighborhoods, brighter graph states, drag-to-pan, cursor-centered zoom, fit/center controls, persistent viewport and selection, non-destructive search, spatial keyboard navigation, and responsive connection details.
- Replaced per-block text boxes with one continuous CodeMirror Markdown document and instant Live/Markdown presentation switching.
- Added host-retained ordered drafts, durable failed-draft recovery, coalesced narrow edits, save ordering, explicit external-change resolution, and mixed-line-ending-safe input.
- Added live heading, list, quote, code, task, and wiki-link presentation while keeping Markdown directly editable; expanded completion across titles, aliases, paths, headings, and block IDs.
- Added exact heading and block-reference resolution, navigation, broken-link detection, and distinct diagnostics for missing anchors.
- Fixed note and due-task Explorer items becoming unresponsive after index refreshes by using stable VS Code command descriptors.
- Fixed graph node clicks and double-clicks being retargeted to the canvas by drag pointer capture, restoring selection and note opening.

## 0.1.0

- Initial Markdown-first notes workspace.
- Added rendered/source editing, wiki links, backlinks, tasks, graphs, diff-previewed rename transactions, diagnostics, full-text search, and Activity Bar navigation.
