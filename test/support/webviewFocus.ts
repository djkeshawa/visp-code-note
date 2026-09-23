import { window } from "./domEnvironment";

// jsdom equates window focus with a focused element. In a browser the document keeps focus
// when a redraw removes that element, and loses focus when the user enters another webview.
let focused = true;
window.document.hasFocus = () => focused;

export function setWebviewFocused(value: boolean): void {
  focused = value;
}
