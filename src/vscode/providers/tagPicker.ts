import * as vscode from "vscode";
import type { IndexSnapshot } from "../../domain/models";

export interface TagChoice {
  readonly tag: string;
  readonly count: number;
}

/**
 * Every tag in the workspace with how many notes carry it, most used first. Names are
 * de-duplicated case-insensitively, keeping the first spelling seen — the same rule the
 * parser applies when merging a note's frontmatter and inline tags.
 */
export function workspaceTags(snapshot: IndexSnapshot): readonly TagChoice[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const note of snapshot.notes) {
    for (const tag of note.tags) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort(
    (left, right) => right.count - left.count ||
      left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" }),
  );
}

/** Tags share the inline `#tag` grammar, so the picker rejects what the parser would not read. */
export function isUsableTagName(value: string): boolean {
  return /^[\p{L}\p{N}_](?:[\p{L}\p{N}_/-]*[\p{L}\p{N}_])?$/u.test(value);
}

export function normalizeTagInput(value: string): string {
  return value.trim().replace(/^#+/, "");
}

/**
 * Picks an existing workspace tag or accepts a new one typed inline, so adding the first
 * tag of its kind costs the same as reusing one. Returns undefined when dismissed.
 */
export async function pickTag(
  snapshot: IndexSnapshot,
  options: { readonly title: string; readonly exclude?: ReadonlySet<string> },
): Promise<string | undefined> {
  const excluded = options.exclude ?? new Set<string>();
  const available = workspaceTags(snapshot).filter(
    (choice) => !excluded.has(choice.tag.toLocaleLowerCase()),
  );

  return new Promise<string | undefined>((resolve) => {
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { readonly tag?: string }>();
    picker.title = options.title;
    picker.placeholder = "Choose a tag, or type a new one";
    picker.matchOnDetail = true;
    const existingItems = available.map((choice) => ({
      label: `#${choice.tag}`,
      description: `${choice.count} note${choice.count === 1 ? "" : "s"}`,
      tag: choice.tag,
    }));
    picker.items = existingItems;

    const refresh = (value: string): void => {
      const candidate = normalizeTagInput(value);
      if (candidate === "" || !isUsableTagName(candidate)) {
        picker.items = existingItems;
        return;
      }
      const known = available.some(
        (choice) => choice.tag.toLocaleLowerCase() === candidate.toLocaleLowerCase(),
      );
      picker.items = known
        ? existingItems
        : [
            { label: `#${candidate}`, description: "New tag", tag: candidate },
            ...existingItems,
          ];
    };

    let resolved = false;
    const finish = (tag: string | undefined): void => {
      if (resolved) return;
      resolved = true;
      resolve(tag);
      picker.dispose();
    };

    picker.onDidChangeValue(refresh);
    picker.onDidAccept(() => {
      const selected = picker.selectedItems[0]?.tag;
      if (selected !== undefined) {
        finish(selected);
        return;
      }
      // Accepting typed text with nothing highlighted still creates the tag.
      const typed = normalizeTagInput(picker.value);
      finish(isUsableTagName(typed) ? typed : undefined);
    });
    picker.onDidHide(() => finish(undefined));
    picker.show();
  });
}
