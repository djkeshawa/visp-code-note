/**
 * What actually happened when the reader asked to save.
 *
 * Kept apart from the editor session so the decision can be stated once and tested: the host
 * side of a save is three facts — whether there was anything to write, what the write
 * reported, and whether anything is still unwritten afterwards — and the only interesting
 * question is which combinations are failures.
 *
 * The one that matters: a note with nothing unsaved is *already saved*, so it is never a
 * failure however the save call answers. `TextDocument.save()` is documented to return false
 * when a save "failed", which reads as though an unnecessary save were a failed one; the
 * integration suite asks a real VS Code and finds it returns true, having written nothing.
 * Both answers arrive here as "nothing-to-write", which is the point of deciding it here
 * rather than trusting a return value whose meaning has moved between versions.
 */
export type SaveOutcome = "written" | "nothing-to-write" | "failed";

export function saveOutcome(
  hadUnsavedChanges: boolean,
  reportedSaved: boolean,
  stillHasUnsavedChanges: boolean,
): SaveOutcome {
  if (!hadUnsavedChanges) return "nothing-to-write";
  if (reportedSaved) return "written";
  /*
   * A save can report failure and still have happened — a save participant or an external
   * writer can flush the document out from under the call. Nothing left unsaved means the
   * text reached disk, whatever the return value said.
   */
  return stillHasUnsavedChanges ? "failed" : "written";
}
