/** Restore a replaced control only while the reader remains in this webview. */
export function restoreFocusNextFrame(restore: () => void): void {
  if (!document.hasFocus()) return;
  const previous = document.activeElement;
  window.requestAnimationFrame(() => {
    // Another editor can gain focus between the redraw and this frame. activeElement alone
    // only identifies the last focused control inside this document, not the active webview.
    if (!document.hasFocus()) return;
    const current = document.activeElement;
    if (current !== null && current !== document.body && current !== previous) return;
    restore();
  });
}
