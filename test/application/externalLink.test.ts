import assert = require("node:assert/strict");
import { test } from "node:test";
import { isExternalLink, parseExternalLink } from "../../src/application/externalLink";

test("accepts the destinations notes actually link out with", () => {
  for (const url of [
    "https://example.com",
    "http://example.com/page?q=1#frag",
    "https://example.com/path%20with%20escapes",
    "mailto:someone@example.com",
    "HTTPS://EXAMPLE.COM",
  ]) {
    assert.equal(parseExternalLink(url), url.trim(), url);
  }
});

test("refuses every scheme that could act on the machine", () => {
  /*
   * A note is workspace content, so a cloned repository writes these. `command:` is the one
   * that matters most — VS Code reads it as an instruction to run a command with arguments —
   * and the rest are the usual ways a link does something other than open a page.
   */
  for (const attack of [
    "command:workbench.action.terminal.new",
    "command:vispNotes.deleteEverything?%5B%22all%22%5D",
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "vscode://ms-vscode.remote/attach",
    "vscode-insiders://x",
    "ftp://example.com/x",
    "JavaScript:alert(1)",
    "  command:x  ",
  ]) {
    assert.equal(parseExternalLink(attack), undefined, attack);
    assert.equal(isExternalLink(attack), false, attack);
  }
});

test("refuses destinations with no scheme at all", () => {
  // Relative links are legitimate Markdown; they are simply not something to hand outwards.
  for (const value of ["./other.md", "../notes/a.md", "notes/a.md", "#heading", "", "   "]) {
    assert.equal(parseExternalLink(value), undefined, JSON.stringify(value));
  }
});

test("refuses hidden control characters and absurd lengths", () => {
  // A newline or NUL is how a destination shows the reader one thing and opens another.
  assert.equal(parseExternalLink("https://example.com\ncommand:x"), undefined);
  assert.equal(parseExternalLink("https://example.com\u0000x"), undefined);
  assert.equal(parseExternalLink("https://example.com\u0000"), undefined);
  assert.equal(parseExternalLink("https://example.com\u007f"), undefined);
  assert.equal(parseExternalLink(`https://example.com/${"a".repeat(2_100)}`), undefined);
  assert.ok(parseExternalLink(`https://example.com/${"a".repeat(1_000)}`) !== undefined);
});

test("refuses anything that is not a string", () => {
  for (const value of [undefined, null, 42, {}, [], { url: "https://example.com" }]) {
    assert.equal(parseExternalLink(value), undefined, JSON.stringify(value));
  }
});
