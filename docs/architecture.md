# Architecture

Visp Notes is split around a dependency rule: the domain and Markdown parser know nothing about VS Code, while host adapters translate VS Code events into application operations.

## Modules

- `src/domain`: immutable data shapes, normalization, and typed host/webview protocols.
- `src/markdown`: dependency-free parsing of blocks, wiki links, headings, and explicit block references with exact UTF-16 offsets.
- `src/indexing`: workspace discovery, serialized incremental updates, note/heading/block reference resolution, backlinks, and graph projections.
- `src/application`: pure edit planning, draft buffering, text patches, and suggestion ranking for links, note metadata, and tasks.
- `src/vscode`: commands and adapters for documents, trees, diagnostics, custom editors, and panels.
- `src/ui`: CSP-safe host-side HTML templates.
- `src/webview`: browser-side TypeScript for the continuous Markdown editor, task dashboard, graph, and backlinks.
- `test`: pure unit and projection tests using Node's built-in test runner.

## Runtime flow

1. `extension.ts` creates the composition root and registers VS Code contributions.
2. `WorkspaceIndex` discovers Markdown and parses each file into a `NoteRecord`.
3. Pure projections resolve links and derive backlinks, tasks, broken links, and graphs.
4. Index snapshots are immutable and published through one change event.
5. Native providers and webview panels render the latest snapshot.
6. UI actions return typed messages to the extension host.
7. Each editor transaction sends an ordered UTF-16 patch to the host. The host retains the latest projected draft, coalesces rapid input, validates the authoritative source, and applies narrow serialized `WorkspaceEdit` ranges.

## Design choices

The extension uses an in-memory index because Markdown is authoritative and the MVP workspace size does not justify database lifecycle or migration complexity. Index mutations are serialized so watcher bursts cannot commit stale projections out of order.

Webviews contain presentation only. File access, URI resolution, editing, and command execution remain in the extension host. A restrictive content security policy permits only local extension assets.

Host and browser message types are deliberately separated by the compilation boundary, with a compile-time conformance test preventing the two wire contracts from drifting.

The parser returns offsets rather than VS Code ranges. This keeps it independently testable; adapters convert offsets against the current `TextDocument` only at the mutation boundary.

Wiki references are resolved in stages: the note target is selected deterministically, then optional heading and block anchors are validated against the parsed target. Completion candidates share the same normalized note metadata across the native Markdown provider and custom editor, including aliases and source-aware local anchors.

The custom editor uses one CodeMirror 6 document for both Live and Markdown modes. Compartments reconfigure live-preview decorations without replacing the editor, so selection, scrolling, history, Markdown keymaps, and completion remain continuous. Focused modules own document synchronization, raw/CodeMirror offset conversion, line-ending serialization, preview decorations, theme integration, wiki completion, and navigation.

Every local transaction is converted directly to a narrow raw-source patch, assigned a monotonic sequence, and sent immediately. A host-side draft buffer projects those patches in order while a serialized writer coalesces them into the fewest practical `WorkspaceEdit` calls. Acknowledged sequences allow intermediate host states to arrive without being mistaken for external edits. Divergent unsequenced states become explicit conflicts, preserving the local draft until the user chooses a side. Failed and conflicted drafts are checkpointed in versioned workspace-scoped extension state and delivered atomically with the next initial editor state.

Graph interaction is split into pure viewport, filtering, connection, spatial-navigation, and live-force models plus small DOM controllers. A requestAnimationFrame controller drives spring, repulsion, collision, and momentum updates through a cached SVG position updater; reduced-motion preferences keep the deterministic static seed layout. The current viewport, selection, and surviving node positions are retained when the same graph scope refreshes.

Workspace search is a disposable projection over the in-memory snapshot. It searches note metadata, bodies, and tasks while returning only bounded snippets and exact UTF-16 reveal offsets to the UI.

## Extension points

New metadata parsers belong under `src/markdown`. New derived workspace views should be pure projection functions under `src/indexing`. New VS Code surfaces consume those contracts through an adapter rather than importing webview code into the domain.
