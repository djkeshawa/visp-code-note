# Changelog

## Unreleased

### Fixed — outlining plain lines, not just bullets

- **A line of prose could not be collapsed.** Folding recognised headings and list items only,
  so nesting a line with `Tab` gave it no fold control and no outline at all. A fold now keys on
  indentation: any line collapses whatever is indented beneath it, which is what an outliner
  does, and a bullet is simply the case that already worked.
- **Nesting a line of prose turned it into a grey code block.** Two presses of `Tab` make a
  four-space indent, and that was read as an indented code block. CommonMark is explicit that an
  indented code block cannot interrupt a paragraph, so the indented lines under prose are
  continuations of it. Indented code after a blank line is still code.
- **The fold chevron sat at the far-left margin** whatever the line's depth, several levels away
  from the block it belonged to. It is now anchored after the line's indentation, so it hangs
  beside the text it collapses. Measured at 1200px: a top-level chevron at -16px against its
  text at 0, a nested one at 6px against its text at 22px.
- **`Tab` on a line of prose moved it about seven pixels**, the width of two spaces in a
  proportional face, because only list lines were given a per-level indent width. Prose now
  steps by the same 22px as bullets — measured 22px and 44px for both — including on the empty
  line the caret lands on after `Enter`, so the step is visible before anything is typed.

## 0.3.0 - 2026-07-26

### Fixed — nesting, and tables that actually line up

- **A bullet indented three levels became a grey code block.** `Tab` twice produces a
  four-space indent, which CommonMark reads as an indented code block — correct at the top
  level, wrong inside a list, where indentation is measured from the parent item. A marker at
  any depth now continues an open list. A checkbox drawn inside a genuine top-level indented
  code block still stays code.
- **A checkbox nested more than one level deep was not a task at all** — absent from the
  Activity Bar, the Tasks view and the index, because the task pattern shared the same
  three-space cap.
- **Nesting was almost invisible.** Indentation rendered as literal spaces in a proportional
  face, about seven pixels a level, so pressing `Tab` looked like it had done nothing. Each
  level is now a clear 22px step, measured: 233, 255, 277, 299 across four levels. The
  characters stay in the document, so the caret still moves through them.
- **Table columns did not align.** Monospace alone aligns nothing, because the source is never
  padded — the pipes landed at 233/318/458 on one row and 233/280/326 on the next. Each cell
  now carries the width of the widest cell in its column, and every row lands on 241/365/504.

### Added — collapsible outline, tables, and Markdown links

- **Headings and list items collapse.** `@codemirror/lang-markdown` folds every block except
  headings and lists, so fenced code and quotes already collapsed while an outline did not. A
  heading now collapses to the next heading of the same or higher level, and a list item
  collapses its nested children, at any depth. Folding is presentation only: unlike Logseq,
  nothing writes `collapsed:: true` into the file, so view state stays out of notes and diffs.
- The control is an inline chevron in the left margin of its own line, not a fold gutter. A
  gutter was wrong twice over: horizontally it is pinned to the scroller's edge while note
  content is centred on a reading measure, which stranded the chevrons 218px from their text;
  vertically its rows use the editor's base line height while live mode sets its own on the
  content, so markers drifted out of step — rows 25px apart against markers 14px apart, two
  overlapping — and a chevron folded a different line from the one it sat beside, which is what
  made deeper nesting appear not to work. The chevron is now a zero-width inline box shifted by
  a transform, so it sits on each line's own baseline and shifts no text.
- **Tables render as a grid.** They previously showed as raw pipes. Rows stay editable text
  given a monospace grid so columns align, a header rule where the delimiter row was, and
  receding pipes; the delimiter row itself is hidden unless the caret is on it. A pipe in
  ordinary prose, and a table drawn inside a fence, are both left alone.
- **Markdown links and images render their label.** `[label](url)` and `![alt](src)` showed
  their full syntax; the brackets and target are now hidden until the caret enters them, read
  from the syntax tree so nested brackets and escapes are handled by the parser.

### Added — prose font setting

- `vispNotes.editor.fontFamily` sets the font for rendered note prose. Empty follows VS
  Code's interface font, which is the default. Fenced code and inline code continue to follow
  `editor.fontFamily`, so a font configured there was always already in use for code.
- The value is validated against an allow-list on both the extension host and in the webview.
  It is a window-scoped setting, which means workspace settings — a cloned repository — can
  supply it, and it reaches a stylesheet; the extension declares support for untrusted
  workspaces, so it is treated as attacker-controlled. Letters of any script are accepted so
  a CJK or Cyrillic font name works, while semicolons, braces, brackets, slashes and the rest
  are refused rather than escaped.

### Added — a colour scheme for rendered notes

- **Fenced code blocks are syntax highlighted.** They previously rendered as flat monospace
  text: the editor never passed `codeLanguages` to the Markdown parser, so a ```ts block got
  no highlighting at all. TypeScript/JavaScript, JSON, Python, YAML, HTML, CSS and shell are
  supported; anything else stays plain, as every fence was before. A curated set rather than
  `@codemirror/language-data`, whose dynamic imports esbuild resolves at build time — "lazy"
  would have meant bundling every language CodeMirror supports. Bundle cost: 71KB.
- Inline code now uses `--vscode-textPreformat-foreground`, the token VS Code defines for
  exactly this, instead of inheriting body colour.
- The first three heading levels carry a hue, fading toward the text colour as they shrink.
  H4–H6 stay neutral: at near-body size a hue reads as clutter rather than as structure.
- A six-hue palette assigned by meaning rather than by grammar, shared between prose and
  code so a note reads as one document: violet for structure, blue for references, green for
  strings, gold for types, orange for literals, rose for keywords.
- The palette is tuned against measurements, not taste. Every hue clears 4.5:1 on its
  background and no pair sits closer than ΔE 30 in CIELAB. A first attempt in true pastels
  failed that second test — orange and gold landed at ΔE 15, close enough that numbers and
  types were the same colour in small text, with every hue crammed into a 16-point lightness
  band. The shipped hues spread across lightness as well as hue.
- Light themes get their own darker variants, since a colour legible on a dark background
  washes out on white. High-contrast themes drop back to the theme's own tokens, because that
  is an explicit accessibility choice and pastels should not override it.

### Changed — rendered prose colour

Saturation was being spent on decoration while structure got none: every bullet, every
wiki link, and every blockquote carried the accent colour, while headings were rendered in
exactly the same colour as body text. Colour now marks meaning, and structure relies on
hierarchy.

- Headings keep the theme's foreground; body prose sits at 88% of it. Hierarchy comes from
  contrast rather than a heading colour of its own, so it holds in any theme instead of only
  the one it was tuned in. Measured: heading 10.26:1 against prose 8.22:1 in Dark Modern,
  11.2:1 against 7.69:1 in Light Modern — every value well clear of WCAG AA.
- List markers are muted and no longer semi-bold. A long list read as a column of bright
  dots competing with the words beside it.
- Wiki links drop their standing background tint, keeping colour and a soft underline; the
  tint now marks hover. Three simultaneous signals on an element that appears many times per
  paragraph turned a well-linked note into a field of highlighted blocks. Unresolved links
  keep a standing tint, because that one carries meaning.
- Plain blockquotes take a neutral rule and no tint, so callouts are visibly the thing that
  stands out rather than looking near-identical to an ordinary quotation.

### Fixed — rename durability

- **A rename left its link and title updates unsaved while the file rename was already on
  disk.** `applyEdit` writes a file rename straight to the filesystem but applies text edits
  to in-memory buffers, so closing without saving — or a crash, or "Don't Save" — left the
  note renamed with every incoming link still pointing at the old title. The two halves of
  the transaction now persist together. Documents the user had already left dirty are not
  saved, because those edits are theirs to commit.
- `Visp Notes: Rename Note` accepts `{ uri, title, mode }` as a command argument, which
  skips the title prompt, the mode picker, the diff preview and the confirmation modal. That
  makes the rename usable from a keybinding or another extension, and is what let the
  integration suite drive a path guarded by three interactive gates.
- Fixed a crash reaching `Uri.parse(undefined)` when a rename request omitted `uri`, and
  derived the new file name from the same trimmed title every other step uses.

### Added — integration tests

- Added an extension-host suite (`npm run test:integration`) that drives a real VS Code
  build against a scratch workspace and asserts on files on disk. Until now every suite was
  pure logic: they proved a planner returned the right offsets, but nothing proved VS Code
  applied those offsets to a real file. That gap is exactly how `planAliasAddition` shipped
  broken for the commonest frontmatter shape.
- Covers task toggling, tag add and remove across inline lists, block sequences and notes
  without frontmatter, CRLF and YAML-comment preservation, refusal of unsafe YAML, and the
  full rename transaction across all three modes — including renaming twice with aliases,
  the shape that used to throw.
- `Visp Notes: Add Tag` and `Remove Tag` now accept the tag as a command argument, which
  skips the picker. That makes them usable from a keybinding or another extension, and is
  what lets the suite drive them — an interactive quick pick cannot be answered from a test.
- The suite is wired into CI under `xvfb-run`, and uses a small `node:test`-style harness
  rather than pulling in a second test framework, keeping the dependency audit at zero.

### Added — tag editing

- Tags can now be added and removed from the note editor's context strip. Frontmatter tags
  show a remove control on hover and a trailing `+` opens a picker over every tag in the
  workspace, where typing a name that does not exist yet creates it.
- `Visp Notes: Add Tag` and `Visp Notes: Remove Tag` do the same from the palette, and work
  whether the note is open in the Visp Notes editor or in VS Code's own text editor.
- Editing is deliberately frontmatter-only. An inline `#tag` lives in the author's prose, so
  it is shown greyed with an explanation rather than being silently removed by rewriting the
  sentence around it.
- Changes are applied to the editor's own document, so they join the draft already in flight
  and are undoable with a single Ctrl/Cmd+Z, rather than arriving as an external change and
  raising a conflict prompt.
- Frontmatter edits reuse the existing YAML safety layer: the file's line endings, BOM,
  sequence indentation, quoting style and comments are preserved, a lone scalar is promoted
  to a list rather than duplicating the key, and YAML shapes that cannot be edited safely are
  refused with a message instead of half-edited.

### Fixed

- `planAliasAddition` failed on the most ordinary frontmatter shape — a block sequence as the
  last property, such as `aliases:\n  - Old name\n---`. The slice to the closing fence left an
  empty trailing line that the "no trivia between items" guard mistook for a blank line, so
  "Rename Note and Update Links" refused to preserve the old title as an alias on those notes.
  Genuine blank lines between items are still refused.

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
