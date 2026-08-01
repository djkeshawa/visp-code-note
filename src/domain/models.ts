export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly slug: string;
  readonly range: OffsetRange;
}

export interface BlockReference {
  readonly id: string;
  readonly range: OffsetRange;
}

export interface WikiLink {
  readonly raw: string;
  readonly target: string;
  readonly heading?: string;
  readonly blockId?: string;
  readonly alias?: string;
  readonly range: OffsetRange;
}

export type TaskPriority = "low" | "medium" | "high";

export interface NoteTask {
  readonly id?: string;
  readonly text: string;
  readonly completed: boolean;
  readonly due?: string;
  readonly priority?: TaskPriority;
  readonly tags: readonly string[];
  readonly range: OffsetRange;
  readonly checkboxRange: OffsetRange;
  readonly line: number;
}

export type MarkdownBlockKind =
  | "heading"
  | "paragraph"
  | "task"
  | "list"
  | "blockquote"
  | "code"
  | "thematic-break"
  | "blank";

export interface MarkdownBlock {
  readonly id: string;
  readonly kind: MarkdownBlockKind;
  readonly source: string;
  readonly range: OffsetRange;
  readonly line: number;
  readonly headingLevel?: number;
  readonly completed?: boolean;
}

export interface ParsedNote {
  readonly title?: string;
  readonly aliases: readonly string[];
  readonly headings: readonly Heading[];
  readonly blockReferences: readonly BlockReference[];
  readonly links: readonly WikiLink[];
  readonly tasks: readonly NoteTask[];
  readonly tags: readonly string[];
  readonly blocks: readonly MarkdownBlock[];
  readonly frontmatter?: Readonly<Record<string, string | readonly string[]>>;
}

export interface NoteRecord extends ParsedNote {
  readonly uri: string;
  readonly path: string;
  readonly fileName: string;
  readonly title: string;
  readonly modifiedAt: number;
  readonly content: string;
}

/** A mention of the note from somewhere else, listed in the note inspector. */
export interface NoteBacklinkContext {
  readonly uri: string;
  readonly title: string;
  /** Zero-based, as everywhere else in the index; the UI adds one when it displays it. */
  readonly line: number;
  readonly start: number;
  readonly context: string;
}

/** A link the note makes, and whether it currently lands anywhere. */
export interface NoteOutgoingLinkContext {
  /** What the link says — its alias when it has one, otherwise the target. */
  readonly label: string;
  readonly target: string;
  readonly resolved: boolean;
}

/**
 * Document context shown around the note in its editor: where the note lives, how it is
 * tagged, and how connected it is. Derived from the index, never from the draft.
 */
export interface NoteContext {
  readonly folders: readonly string[];
  readonly fileName: string;
  /** Every tag on the note, from frontmatter and from inline `#tag` in the body. */
  readonly tags: readonly string[];
  /**
   * The subset declared in frontmatter. Only these can be edited from the UI: an inline
   * tag lives in the author's prose, and removing it would rewrite their sentence.
   */
  readonly frontmatterTags: readonly string[];
  readonly backlinkCount: number;
  readonly outgoingCount: number;
  readonly taskCount: number;
  readonly openTaskCount: number;
  /**
   * The mentions themselves, capped — a hub note can carry hundreds, and this rides on
   * every document publish. `backlinkCount` stays the true total.
   */
  readonly backlinks: readonly NoteBacklinkContext[];
  readonly linksOut: readonly NoteOutgoingLinkContext[];
}

export interface ResolvedLink {
  readonly sourceUri: string;
  readonly link: WikiLink;
  readonly targetUri?: string;
}

export interface Backlink {
  readonly sourceUri: string;
  readonly sourceTitle: string;
  readonly sourcePath: string;
  readonly targetUri: string;
  readonly range: OffsetRange;
  readonly context: string;
  readonly line: number;
}

export type GraphNodeKind = "note" | "task" | "tag" | "unresolved";

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: GraphNodeKind;
  readonly uri?: string;
  readonly orphan?: boolean;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: "link" | "task" | "tag";
}

export interface GraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly focusId?: string;
}

export interface IndexSnapshot {
  readonly notes: readonly NoteRecord[];
  readonly links: readonly ResolvedLink[];
  readonly backlinks: readonly Backlink[];
  readonly tasks: readonly (NoteTask & {
    readonly noteUri: string;
    readonly noteTitle: string;
    readonly notePath: string;
  })[];
  readonly version: number;
  readonly indexedAt: number;
}
