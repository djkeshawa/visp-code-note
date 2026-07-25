# Changelog

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
