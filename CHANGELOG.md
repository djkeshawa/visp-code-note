# Changelog

## 0.10.2 - 2026-08-05

### Added — a ceiling on how large a note may be before it is indexed

**`vispNotes.maxNoteSizeKB` skips notes above five megabytes**, which is roughly a million
words. The index keeps every note's full text in memory and the search index keeps a second
structure beside it, so a workspace cost a multiple of its own Markdown with nothing bounding
it — a repository carrying a few hundred megabytes of `.md` could exhaust the extension host
before anything was opened. A skipped note is skipped completely: no note list entry, no
graph node, no search result, no backlinks. Set it to `0` if you would rather spend the
memory. Like the other settings that govern what gets read, a workspace cannot raise its own
ceiling.

## 0.10.1 - 2026-08-05

### Fixed — a note cannot hang the window any more

**Three parsing paths took time proportional to the square of their input**, and all three
read workspace content — which this extension declares it accepts from untrusted workspaces,
so a cloned repository chose the input.

A heading followed by a long run of spaces made the scan for its optional closing `#`
restart at every offset: 100,000 spaces took 6.3 seconds, a million took an estimated eleven
minutes, and it now takes 46ms. This one needed nobody to open anything — indexing runs on
startup, so cloning the repository was enough, and it blocked the extension host for every
extension in the window. Frontmatter rebuilt its alias list on every item, costing 2.5
seconds for 20,000 aliases and now 19ms. A line of spaces that failed to be a table's
delimiter row was retried from every offset, freezing the note renderer for two seconds at
50,000 spaces and now taking one millisecond. All three are single-pass scans, and the
regression tests give them a budget a hundredfold looser than they need.

The typeface no longer arrives through a package with an install-time script, and
`brace-expansion` is raised to 5.0.9 for a build-only advisory.

## 0.10.0 - 2026-08-05

### Fixed — undo works while a note is being written in

**Ctrl+Z did nothing on the note you were typing into.** Every edit is sent to the host,
written, and confirmed back, and the editor applied that confirmation by replacing the whole
document. Undo history is a set of positions into the document, so rewriting every position at
once left it with nothing to point at and it was discarded. Because a confirmation follows
every keystroke, undo was dead on any note in use — inserting a table was simply where it was
noticed. The confirmation now applies only the span that actually differs, so the untouched
text, and the history pointing at it, survive.

### Fixed — a frozen note can no longer be edited

**Enter still added list items to a note held for a draft conflict.** Read-only was advisory:
a flag every command is expected to consult, which the Markdown keymap does not. Freezing a
note is how a conflict is held still until you choose which version wins, so an edit reaching
it there is the worst place for one. Read-only is now enforced against the document itself —
the host may still write, because that is how the conflict resolves; the keyboard cannot.

### Fixed — bullets are bullets, and headings line up

**A list marker is drawn whether or not the caret is on its line.** The marker was revealed
while the line was being edited, so every list looked like a list except the one being
written, which showed a literal `-`. The glyphs are now the disc, circle and square every
Markdown renderer uses, at full size at every depth, and a task line draws its checkbox
without a bullet beside it. Headings lost a stray leading space that sat them a few pixels
right of their own paragraphs, underline-style (`Setext`) headings render instead of showing
their `===`, and a closing `## Notes ##` sequence is hidden like its opening one.

Also fixed: a second fenced code block was shredded into rounded strips by a stylesheet rule
that leaked past its own block; table delimiter rows, closing fences and `---` rules collapsed
to nothing even with the caret on them, leaving lines that could not be seen while being
edited; the `<!-- task:… -->` identifier written by the extension is no longer shown; wiki
links, tags, code and emphasis inside table cells render as themselves rather than as source;
empty and space-padded table cells no longer pull their columns out of line; and a blockquote
has room between its rule and its words.

### Added — tasks sort, and reminders are visible

**The task list sorts by due date, by the date its note was created, or by the task's own
text, in either direction.** Grouping is unchanged and sorting applies within each group,
completed work always sinks below open work, and a task missing whatever is being sorted on
sits last in both directions rather than pretending to be an early or a late one.

**An "Active reminders" section lists what is armed and when it will ring**, above the groups
and unaffected by the filter box, because a reminder is something the host is holding rather
than a view of the list. The two controls that both offered "Due date" now say which is
Grouping and which is Sorting, a low-priority task shows the margin bar the editor promises it
when it hides `@priority(low)`, and clicking a task's due date or note name no longer
completes it.

### Changed — the reading face is bundled, and the type is retuned

**Notes are set in IBM Plex Sans, which now ships with the extension**, so a note reads the
same on every machine instead of in whichever family happened to be installed. Text is drawn
with grayscale antialiasing: subpixel antialiasing addresses the red, green and blue stripes
of an LCD pixel separately, and QD-OLED lays its subpixels out in a triangle, so that trick
drove the wrong lamps and fringed every edge in colour.

Leading comes in from 1.78 to 1.62, near what VS Code's own Markdown preview and GitHub use,
and the heading scale is spaced so every level is distinguishable — the third and fourth
levels previously differed by a hundredth of an em, so a note with four levels of structure
showed two. The top two levels close with a hairline, the lower ones separate by colour
instead of by a size difference too small to see, list markers align on a right edge with
tabular figures so a numbered list does not shift at ten, a tag no longer shrinks mid-sentence,
and a checkbox stands in the same margin as a bullet.

### Fixed — saving reports honestly

**A note with nothing to write is no longer treated as a failed save.** When a write genuinely
fails, the message now names the file and the two causes worth checking — a read-only file, or
an extension that formats on save refusing it — rather than saying only that something went
wrong.

## 0.9.1 - 2026-08-03

### Fixed — filtering the sidebar no longer stutters

**One paint per keystroke.** A settled query drew the list twice: once at the keystroke with
title and path matches, and again milliseconds later when the host answered with the notes
matching by content — rows appeared, then jumped as the set widened. The paint now waits the
few milliseconds for that answer and draws the final list once; if the host is busy building
its search index, title and path matches still appear within a quarter second rather than
holding the list hostage. A paint whose rows come out identical to what is already on screen
— the index republishing mid-typing, an answer that widens nothing — no longer rebuilds
hundreds of identical elements, so the list holds still unless something about it changed.

## 0.9.0 - 2026-08-03

### Changed — the sidebar filter finds notes by what they say

**The filter box searches note text now.** It matched titles and paths — the only fields the
panel holds, because note content never rides to a webview — so typing a phrase that lives in
a note's body found nothing, and the box read as a search that does not search. The panel now
asks the host, which answers from the search index with every note the query matches by any
field: title, path, alias, tag, or the text itself. Title and path matching still answers
instantly between keystrokes; the content answer widens the list the moment it lands, is
re-asked when the index moves, and an answer that arrives after further typing is recognised
by the query it carries and ignored.

## 0.8.0 - 2026-08-03

### Changed — search answers from an index instead of rereading the vault

**A search keystroke no longer rereads the vault.** Every character typed into workspace
search walked every note and task, rebuilt each one's searchable fields from scratch, compiled
the query into regular expressions and ran them over whole bodies — fine at two hundred notes,
visibly behind the keystroke at a few thousand. The searchable text is now prepared once per
note and kept until that file changes, and a trigram index narrows each query to the notes
that could possibly contain its words before anything is checked exactly. The exact matcher
still has the last word, so these are the same results in the same order; what changes is the
cost of a keystroke in a large vault — from over a hundred milliseconds to under twenty in a
five-thousand-note workspace, low single digits in typical ones.

The index builds once, while the search picker is first painting rather than under a
keystroke, and from there follows edits file by file: a save re-indexes the note saved, and
only a change that would churn most of the index — switching workspaces — starts over.
Snippets and jump offsets are built for the rows the list shows, not for every match ranked.

## 0.7.1 - 2026-08-02

### Changed — a tag opens its notes in the window

**A tag opens its notes in the window.** Clicking a tag chip ran the workspace search pre-filled
with the tag — a dropdown over the palette, mixing notes, tasks and text matches, and gone the
moment focus moved. A tag is a collection, so it now opens the same list every other collection
here opens, each row carrying the note's *other* tags as chips: that is how you tell one of a
tag's notes from the next, and where you go from there. Every chip wears the hue that tag wears
in the sidebar, the note header and the task row, and the list's own icon takes the hue of the
tag it is about, so the panel reads as that tag rather than as a filtered list of notes.

The list it opens is the one 0.7.0 gave orphan notes and broken links; a tag is a collection
like those, and reached through a quick pick like those. What it is showing is now carried as a
union rather than a mode string with a tag alongside it, so the two cannot disagree.

## 0.7.0 - 2026-08-02

### Changed — Due Today carries overdue work, and the note lists get the window

**Due Today carries work that slipped.** Scoped strictly to the current date, a task that
missed its day left the list altogether, so the one row meant to say what was owed went quiet
exactly when something had been forgotten. It now holds everything late as well as everything
landing today, oldest slip first, and its count turns warning-coloured while anything is
overdue. It stays deliberately narrower than All Tasks: carrying next month's work and the
undated as well would make it the backlog again under a second name.

**Orphan Notes and Broken Links open in the window.** Both were quick picks — a dropdown over
the command palette, a dozen rows tall, gone the moment focus moved. Neither is glanced at;
they are lists worked through, so they now open a panel built from the same toolbar, filter
field and footer as the task list. A broken link names the note it sits in, the target that
fails, and the line, and opens the note there. The panel refreshes as the links are repaired.

**Clicking a task opens the note, not the file.** Every list that reaches a task — the panel,
the dashboard, a reminder's Open Note — went through `showTextDocument`, which opens raw
Markdown with no header, no inspector and none of the rendered view. They all take the route a
backlink already took.

**A save that reached disk no longer reports failure.** Several steps of a save can raise after
the file has been written, and one of them doing so told the reader their note could not be
saved when it plainly had been — a banner that only cleared by pressing save a second time and
finding nothing left to do. If the document is clean and holds what the draft projects, the
save achieved what it was for. Editor errors are also logged to the Visp Notes output channel
now, with the operation and the file, so the next one can be diagnosed rather than guessed at.

### Added — due times, a `/` menu, a folder picker, and Delete Note

**Tasks can say when, and say so.** `@due(…)` now accepts a time of day —
`@due(2026-08-15 14:30)` — and a task may carry `@remind(30m)` to be told ahead of it. When the
moment arrives Visp Notes shows a notification offering **Open Note**, **Snooze 10m** and
**Mark Done**. A date-only due fires at `vispNotes.reminders.defaultTime` (09:00 by default).
Grouping, Due Today and the urgency colours read the date exactly as they did, so existing
notes are unaffected.

VS Code cannot raise an OS notification, so a reminder only appears while a window is open.
Reminders that came due while it was closed are shown once on startup, as far back as
`vispNotes.reminders.catchUpWindowHours` (24 by default); anything older is skipped rather than
arriving in a burst after a fortnight away. A reminder that has been shown is remembered in
workspace state, so it does not repeat on every index change or reload — but moving a task's
due date re-arms it.

A due whose moment has already gone by still notifies, once, so long as it is inside the
catch-up window — adding a due date to a task is the commonest way anybody writes one, and it
should not silently do nothing. What stops a notification repeating is the reminder's identity,
which is the note, the task id and the moment; the window only decides how stale is too stale
to mention.

The scheduling, the settling, the snoozing and the record of what has already been shown live
in `ReminderRunner`, which knows nothing of VS Code. The clock and the notifications are ports,
so the regression suite drives a whole afternoon of reminders in a millisecond and every bug
this feature has had is written down as a scenario.

Two tasks that come due together raise two independent notifications. Neither waits on the
other, and neither waits on being answered — a notification carrying buttons has no timeout, so
one left sitting in the notification centre must not hold up the rest. **Open Note** and
**Mark Done** look the task up again when they are clicked rather than trusting the offset the
notification was built with, so answering one an hour later still lands on the right line.

**Metadata that cannot do what it says is now reported.** A `@due(next friday)`, a
`@remind(soon)`, or a `@remind(30m)` on a task with no due date at all used to be silently
inert — it looked like a task that would interrupt you and never did. Each now carries a
warning under the offending token saying why it will not fire.

A due date may be written as a whole ISO 8601 timestamp — `@due(2026-08-15T18:00:00)` — which
is the form the rest of the extension has always read. One that names a zone,
`@due(2026-08-15T18:00:00Z)` or `+05:30`, fixes an instant; everything else is a wall clock, so
nine in the morning means nine wherever you are. A zone-suffixed due notifies at its instant
but lists under its written date, so near midnight the two can name different days; zone-less
dues always agree with themselves.

The catch-up pass is spent on the scheduler's first look at the workspace, however that look is
triggered — it no longer stays armed for the whole session when the initial index build fails.
The reminder settings are clamped in code to the ranges they declare, because a hand-edited
settings.json is not: an absurd `leadMinutes` used to push every reminder into the past and
silently switch the feature off. Delivered-reminder state is retried once at shutdown rather
than lost to a transient write failure.

New Note refuses a folder that `vispNotes.exclude` covers, naming the setting, instead of
creating a note that would never appear in the panel, graph or search. In a multi-root
workspace the folder picker now offers only the chosen root's folders, relative to that root —
it used to offer paths from every root, prefixed with the root's own name, and would have
created that prefix as a real directory.

**A `/` menu in the note editor.** Typing `/` where a block can start opens a filtered menu —
headings, bulleted and numbered lists, tasks, tables, callouts, code blocks, quotes, dividers,
`@due(…)`, `@remind(…)`, `@priority(…)`, today's date, a wiki link, a tag, a block reference —
and writes the syntax, leaving the caret where the next thing gets typed. It shares the
existing completion popup with wiki links and applies the same guard, so it never fires inside
fenced code, frontmatter, a URL, or mid-sentence.

**New Note asks where the note goes.** After the title, a picker lists the folders that already
hold notes, with counts, plus **New folder…**. `vispNotes.notesFolder` is preselected, so Enter
keeps the old behaviour and the flow costs one keystroke. Turn the prompt off entirely with
`vispNotes.newNote.askFolder`.

**Delete Note.** A note's right-click menu in the workspace panel gained a third entry, beside
Rename and Open Local Graph. It confirms first, naming the file and how many notes link to it,
then moves the file to the OS trash — asking a second time on a file system that has none
rather than silently deleting outright. Also available as `Visp Notes: Delete Note`.

Open editors are closed before the file goes, not after, so VS Code is never left holding a
buffer for a file that no longer exists; cancelling the save prompt on a note with unsaved
changes cancels the delete. A note that cannot be deleted for want of permission says so,
rather than being reported as a file system without a trash.

## 0.6.0 - 2026-08-01

### Changed — every view rebuilt to one design

The four webviews, the workspace tree and the status bar were drawn against a single redesign,
so a note, a task and a node now look like parts of the same tool rather than three tools that
happen to ship together.

**The note editor is one header row.** The title, the folder it lives in, its tags, its
backlink count, the Live/Markdown switch and the save state used to occupy a toolbar and a
second context strip beneath it; they now share one 38px row, and the note is that much taller.
Actions that are not keyboard-first — Insert Link, New Task, Rename, Find Broken Links, Open
Local Graph, Rebuild Index — moved into an overflow menu, together with the content-width
control that had been a dropdown in the strip. Below about 820px the tag chips collapse to a
single pill carrying a colour per tag, so the controls on the right keep their place.

**Notes gained an inspector.** A 300px column beside the note lists its outline, what links to
it with the sentence each mention sits in, the tasks it still owes, and what it links out to —
the outline and the tasks read from the draft in the editor, so they follow what is being
typed, and the rest from the index. It is toggled from the header and stands down under 900px.

**The task list is a list.** Each task was a bordered card about 63px tall; it is now a 34px
row — priority as a bar in the margin, then the checkbox, the text, its tag, its note and its
due date in fixed columns, so a week of work fits on one screen and scans down as well as
across. Status moved from a dropdown to Open/All/Done, and the header reports how much is open
and how much is due today.

**The graph is the whole pane.** Two side columns of filters and details cost the drawing about
a third of its width; the filters are now chips over the top-left corner with a count each, the
viewport controls a cluster bottom-left, and the selected node a card bottom-right that is
absent when nothing is selected.

**Colour means something everywhere.** A tag's hue is derived from its name, so the same tag is
the same colour in the tree, in a note's header, on a task row and in the graph. Six of those
hues are contributed as theme colours, so a theme can override them.

### Added — a note in the panel has a menu, rather than one hidden action

Right-clicking a note renamed it on the spot: no menu, no confirmation that the pointer was on
the row you meant, and no way to reach the note's other action. A webview gets no say in VS
Code's own context menu — `contributes.menus` reaches tree items and editor tabs, not the inside
of a panel — so the panel draws one: the note's name, then Rename Note and Open Local Graph, in
the same language as the note editor's overflow menu.

It opens at the pointer, flipping rather than overhanging when the panel's edge is close, and
from the keyboard's own menu key it falls back to the row it was raised from. Escape hands focus
back to that row; the arrow keys walk the items; a click elsewhere, a scroll, or the list being
redrawn underneath it all dismiss it.

### Fixed — a tag chip opened a search that ignored the tag

`vispNotes.search` was registered as a zero-argument callback, so the query the workspace
panel's tag chips passed it was silently dropped. Clicking `#project` opened the picker empty
and showed an arbitrary slice of the whole workspace; the reader had to retype what they had
just clicked. The command takes a query now. Orphan Notes had the same shape of bug — it
advertised an exact count and then opened the generic search, which has no notion of an orphan;
it opens that list.

### Fixed — the panel and the note editor did the same work repeatedly

Measured on a 570-note workspace with 2,850 links:

- **The panel rebuilt everything on every publish.** `getBrokenLinks` alone is 30ms because it
  re-resolves every reference in the workspace, and the panel publishes on far more than an
  index change — switching notes and changing a setting both paid it. Everything derived from
  the snapshot is cached against it now, so only an index change pays; a setting change is free.
- **Switching notes shipped the whole workspace.** It re-sent all 570 note rows, about 75KB, to
  move one highlight. It sends the note's URI.
- **Filtering redrew 570 rows per keystroke** with no debounce or cap. It waits for a pause, and
  draws at most 200 rows with a line saying how many are left.
- **Every open editor rebuilt the same two whole-workspace resolvers** on every index change —
  about 22ms each, so roughly 130ms with six notes open, about once per typing pause. They are
  built once per change and shared.
- **The inspector rebuilt its backlink and link lists on every character**, twice, though both
  come from the index and cannot move while you type. Only the outline and task list follow the
  draft now.
- **A hidden panel was still being rebuilt and posted to.** It is redrawn when it comes back.

### Fixed — the inspector toggle could be defeated by a workspace setting

The toggle wrote to User settings but read the effective value, so a workspace-scoped
`vispNotes.editor.showInspector` made the column reopen the instant it was closed. Settings are
now written to the scope that actually decides them. The content-width control had the same bug.

### Fixed — one webview message acted on a URI it had not checked

`workspace/revealTask` opened whatever URI the panel named. Every comparable handler checks
against the index first; it does too now, as does the rename/graph row action.

### Removed — the Backlinks side-bar view

The design has no such panel: backlinks belong to the note, and the note's own inspector lists
them beside it. Keeping both meant the same four mentions were drawn twice, a few hundred pixels
apart, and it cost the side bar a second title bar — a container with one view shows only the
container's own header, which is what the design draws.

"Show Backlinks" and its shortcut still work: they now open the note with its inspector showing,
which is where its backlinks are.

### Added — the note inspector can be put away, and stays that way

The inspector is toggled from the note's header, and the choice is a setting
(`vispNotes.editor.showInspector`) rather than per-panel state, so a column that was
deliberately closed does not come back with the next note. An editor pane too narrow to hold
both the note and a 300px column beside it still closes the column, and the toggle reports
itself closed and says why rather than claiming a column that is not there.

### Changed — the side bar is the panel the design draws, not a tree

The prototype's side bar puts a search field inside itself, divides its sections with a labelled
rule, gives every tag a colour and every note a dot for how connected it is, and closes with a
status line. A `TreeView` offers a label, an icon, a description and a checkbox, and no way to
draw any of that — so the panel is now a webview view: 30px rows, Due Today expanding in place
with a checkbox and a coloured due dot, folders and notes beneath one Notes count, tags as
pills, and a footer reporting what the index holds and how fresh it is. A `vispNotes.density`
setting switches every row to the design's compact 26px.

Right-clicking a note still renames it, and completing a task from the panel still edits the
Markdown; both now travel as messages rather than through the tree APIs they used to use.

### Fixed — an icon default outranked every icon size

`.codicon[class*="codicon-"] { font-size: inherit }` is an attribute selector, which beats any
single-class rule. Every deliberate icon size in the codebase therefore lost to it silently:
the note icon asked for 15px, the overflow ellipsis for 16px, the inspector toggle for 14px,
and all three drew at the inherited 13px. Both codicon defaults are wrapped in `:where()` now,
so a rule that states a size on purpose wins.

### Changed — the rendered note matches the prototype's blocks

Frontmatter is the property card the design draws — one rounded block, a 76px key column, and
the `---` fences, the `:` and a list's `[ ]` out of the way until the caret lands on them.
Fenced code is a box the code sits inside rather than text running to the measure. A callout is
padded and capped as one block instead of per line. Headings take the prototype's 34px and 30px
approach, task lines its baseline-aligned checkbox, and the block anchor its 18px chip.

The wiki-link suggestion popup gained the design's three glyphs in their three hues — CodeMirror
has no rule for the completion types this source emits, so it had been drawing an empty box
beside every note — and the path moved into a right-aligned column of its own.

### Changed — a node's name stays on one side of it

The graph mirrored a label to the left of its dot once the node drifted past the middle of the
canvas, and truncated anything over 24 characters. A note crossing the centre therefore flipped
its own name to the other side mid-drag, which reads as the drawing rearranging itself rather
than moving, and the notes hardest to recognise from 23 characters were exactly the ones being
abbreviated. Labels now sit 7px to the right of their dot, whole, wherever the node is.

### Changed — the actions the design puts inside the views left VS Code's chrome

Live/Markdown and Open Local Graph were contributed to the editor title bar as well as living
in the note's own header and overflow menu, where the design puts them. The workspace panel's
title bar is down to the one glyph the design draws, with the rest under its overflow. The
status bar entry moved to the left cluster, beside the branch and problem counts it belongs
with. The status bar entry also lost the icon set it did not need.

### Changed — the graph is painted by the prototype's own rules

Node size follows the design's curve (4.5 plus 0.7 a link, capped) rather than one that started
half again as large and turned a moderately linked workspace into touching discs. The selection
wears a flat 5px ring instead of a bloom. The per-degree "hub" glow is gone — it lit most of the
canvas, and the design has exactly one glow. An orphan is the solid muted disc its own filter
chip advertises, rather than borrowing the dashed outline that means unresolved. Tags take the
hue their name gives them, as they do in every other view, instead of all being one green.

### Fixed — every view was inset by a margin nothing asked for

VS Code injects `body { padding: 0 20px }` into every webview it hosts. That is right for a
webview that is a document and wrong for one that is a view: the reset here only zeroed margin,
so the workspace panel — and the note inspector, and the task list, and the graph — carried a
20px inset on both edges before any of their own gutters. In a side-bar panel that is about a
sixth of the width, and the prototype's own reset zeroes it.

### Added — the integration suite checks that the design was actually built

The suite proved the extension wrote the right bytes to the right files, and nothing more, which
is how an entire interface redesign shipped green — including the inset above. It now also
checks the interface itself, in the extension host, where the real thing exists:

- every view is generated with the parts the design gives it, against a real `Webview`
- every view loads the stylesheets that carry the design
- the measurements the prototype fixes are the ones the stylesheets declare — the 38px note
  header, the 300px inspector, the 34px task row, the 290px graph card, the 720px measure
- the prose palette is the specified one, in both polarities
- no view inherits VS Code's injected body padding
- the workspace tree is the design's sections in the design's order, with the design's icons
- a note row reports how connected it is, counting neighbours rather than mentions
- the tree footer and the status bar report the same two figures

The design is written down as checkable facts in `test/integration/designSpec.ts`, so drifting
from it is a failing test rather than something somebody has to notice in a screenshot.

### Fixed — a note counted itself as a connection

`[[#Heading]]` and `[[^block]]` point inside the note being read, and the resolver answers them
with that same note. Every count built on that answer was wrong: the note appeared in its own
backlinks list once per anchor, a note that linked only to its own headings was not listed as an
orphan, and the workspace tree painted it as its best-connected note. Backlinks are now mentions
from somewhere else, orphan means connected to no *other* note, and the tree counts neighbours
rather than link occurrences — so linking the same note three times is one connection, which is
also what the note inspector already meant by it.

The same anchors reached the inspector's "Links out" as a chip with no label, which reported
"the wiki-link target is invalid" when clicked, because there is no note name to open. They are
not links out of the note and are no longer listed as such. The count above that list now counts
destinations, matching the list it heads rather than the raw number of mentions.

### Fixed — the note inspector never noticed a new backlink

A note gains a backlink when some *other* note is edited, and the only message its editor
receives when that happens carried no index data — so the outline's neighbours, the backlinks
list and every count beside them stayed as they were until that note's own text changed. They
now travel with the index update. Finding the workspace's broken links is also resolved once per
update instead of once per open note.

### Fixed — a due date the parser did not recognise vanished from the note

The rendered view replaces `@due(...)` with the date it holds. A value it could not parse —
`@due(2026-08-10T09:00)`, `@due(2026-8-3)`, `@due(tomorrow)` — was replaced with nothing at all,
so the note showed an undated task while the task list showed the due date, and the text only
came back if the author happened to click that line. The marker is now always replaced by
something that still shows its value, and the editor and the task list share one formatter
rather than each having their own.

### Fixed — the status bar flickered while typing

Editing a note re-indexes that one file in a few milliseconds, and the status item swapped to a
spinner and back for each of them, shifting every status entry to its left several times a
second. Only work that outlasts 400ms is announced now, so a real rebuild is visible and typing
is not. The item also prints the same two figures as the workspace panel's footer, which said
"7 tasks" beside a status bar saying "6 tasks" — the same words for two different questions.
How many are still open is in the tooltip.

### Fixed — selecting a node in the graph highlighted nothing until you moved the mouse

Emphasis classes are written by diffing the classes an element should have against the ones it
already has, and a freshly rendered element records "not known" as `-1`. XOR-ing against that
sentinel reports every class that *should* be added as unchanged, so the first pass after a
render could only ever remove classes. Opening a note's local graph therefore drew no
neighbourhood, no dimming and no highlighted edges until a hover forced a second pass. This
also affected the workspace graph, which selects its focused note on open.

### Fixed — a view's footer took a quarter of the pane

Each view was laid out as a grid with a row per element, but the error and conflict notices are
`hidden` most of the time, and an element with `display: none` is not placed in a grid. The row
meant for the view itself went to whichever element landed there instead, which in the task
list left the footer 281px tall and the list scrolling inside 471px. The views are laid out as
columns now, with the one growing region named rather than inferred from a row index.

### Changed — an unresolved link reads as a promise, not as an error

A link to a note that has not been written yet was painted warning-yellow on a tinted block,
which made a note full of intentions look like a note full of mistakes. It now keeps the same
colour as any other link and says what it is with a dashed underline.

### Changed — task metadata reads as metadata

`@due(2026-08-03)` and `@priority(high)` are how a task records itself, not how it should read.
In the rendered view the due date is now the date, coloured by how near it is, and the priority
marker steps out of the sentence — both come back the moment the caret lands on the line, like
every other mark this editor hides. A trailing `^block-id` is drawn as a small chip with the
link that reaches it in its tooltip, and `#tag` steps back from the prose around it.

### Fixed — dropdown lists were invisible when the theme and the desktop disagreed

The webviews declared `color-scheme: light dark`, which defers to the operating system rather
than to the VS Code theme, and the `<select>` controls were transparent so the browser could
see no colour of their own. A native dropdown paints its popup list from the control, not from
the field around it, so the list came back in the desktop's polarity while the option text
inherited the theme's — white on white for a dark theme on a light desktop, and the reverse.
The colour scheme now follows the theme class, and the dropdowns and their options name the
theme's own dropdown colours. This affected the task status and grouping dropdowns and the note
content width dropdown.

The same deferral also applied to the `Canvas` and `CanvasText` fallbacks the palette uses when
a theme omits a token, which were chosen to hold the theme's polarity and until now followed
the desktop instead.

### Changed — the note editor's footer bar gave its height back to the document

A permanent bar across the bottom of every note carried a short sync phrase on the left and a
fixed keyboard hint on the right, with dead space between them, and the hint offered to open
links in notes that had none. Sync state now sits beside the note title in the toolbar, left of
the spacer so the buttons on the right keep still as the text changes length, and the save
shortcut is a tooltip on it. Notes are about 30 pixels taller.

## 0.5.0 - 2026-07-28

### Fixed — scanning a note no longer costs more the longer it gets

Several scans re-read the same text once per character, so their cost grew with the square of
the note. Indexing parses every Markdown file in the workspace on the extension host, and the
editor parses the open note on every keystroke, so a single large or awkward file could stall
the whole window. All of these are measured before and after:

- **Ordinary prose was the slowest case of all.** Extracting tags rebuilt the list of every
  protected range and every link *for each tag*, so a note with a link and a tag on each line
  compared them all against each other: 500KB took 2301ms, now 57ms. Overlap questions are
  answered by binary search over merged ranges instead.
- **Unclosed `[` scanned to the end of the line, then began again one character later.** A 1MB
  note of them took around 24 minutes; it now takes 45ms. Brackets are paired off in one pass.
- **Unclosed `[a](` did the same** — 78KB took 4669ms, now 11ms. Destinations pair off the same
  way, except on a line containing a quote, where the older scan still runs but is bounded.
- **Runs of backslashes made every escape check walk back over them**: 39KB took 1177ms, now
  2ms, from a table of escape positions built once per parse.
- **Fold controls re-scanned the document for fenced regions once per visible line, on every
  repaint** — 25ms a keystroke on a 10,000-line note, now 0.1ms.
- **Table layout was recomputed on every caret move**, not just on edits.

A `vispNotes.exclude` pattern is also no longer able to hang the window: `{a,b}` doubles the
work per group and the setting comes from the workspace, so 20 groups meant a million patterns
and 12 seconds per file. Expansion is now capped, and that setting and `vispNotes.notesFolder`
are declared restricted so an untrusted workspace cannot supply them at all.

### Fixed — nesting with tabs, and prose under a bullet

- **A tab counted as one column of indentation**, less than two spaces, so a tab-indented child
  never registered as nested: it got no fold control, and one tab and two tabs drew at the same
  depth. Indentation is measured in columns now, as CommonMark measures it.
- **A line of prose under a bullet kept its literal indentation** — about seven pixels, so `Tab`
  looked like it had done nothing. It belongs to the list block but carries no marker, which is
  the branch that had been missing it.

### Added

- **`[text](url)` links open on Ctrl/Cmd-click.** They were drawn and underlined as links but
  nothing followed them. Only `http`, `https` and `mailto` are opened, checked on the extension
  side rather than in the webview: a note is workspace content, so `command:` in a link would
  otherwise be an instruction to run a command.

### Fixed

- A note titled with a Windows device name — `con`, `aux`, `nul`, `com1` — could not be created
  on Windows, because the file system refuses those whatever extension follows. The note keeps
  its title and the file is nudged aside.
- `vispNotes.graph.defaultDepth` was read as though its type were guaranteed; a workspace can
  put anything there, so it is checked.

## 0.4.0 - 2026-07-27

### Fixed — Markdown that still looked like Markdown

- **A quote or callout repeated its `>` on every line.** The block already carries a left edge
  and its own tone, so the marker only made the prose ragged. It is hidden now, and comes back
  on whichever line the caret is on, like every other mark in Live mode.
- **A fenced code block showed its own fences.** The block is already drawn as code; the
  backticks were noise. The language stays as a quiet label above the code.
- **A table showed every `|`.** Dimming them was not enough — a row of `| yes | yes |` still read
  as source. The columns already hold their own width, so the pipes are hidden and the column
  edge is the cell's own. Putting the caret on a row brings the full source back.
- **Frontmatter was highlighted as Markdown**, so `tags: [research, active]` was painted as a
  link, underlined and coloured, inviting a click that did nothing.

### Added

- README screenshots of the editor, the knowledge graph and the Tasks view, captured from the
  real webviews rather than mocked up.

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
