export type WikiLinkInsertionPlan =
  | { readonly source: string }
  | { readonly error: string };

export function planWikiLinkInsertion(
  target: string,
  selection: string,
): WikiLinkInsertionPlan {
  if (selection.length === 0) {
    return { source: `[[${target}]]` };
  }
  if (/[|\]\r\n]/.test(selection)) {
    return {
      error: "Wiki-link aliases must be on one line and cannot contain “|” or “]”. The selection was left unchanged.",
    };
  }
  return { source: `[[${target}|${selection}]]` };
}
