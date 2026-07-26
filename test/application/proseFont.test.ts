import assert = require("node:assert/strict");
import { test } from "node:test";
import { isUsableProseFont, parseProseFont } from "../../src/application/proseFont";

test("accepts the font stacks people actually write", () => {
  for (const value of [
    "JetBrains Mono",
    "MesloLGS NF",
    '"Fira Code", monospace',
    "Iosevka, 'SF Mono', Consolas, monospace",
    "Charter",
    "IBM Plex Sans, sans-serif",
  ]) {
    assert.equal(parseProseFont(value), value, value);
  }
});

test("trims surrounding whitespace and treats blank as unset", () => {
  assert.equal(parseProseFont("  JetBrains Mono  "), "JetBrains Mono");
  assert.equal(parseProseFont(""), undefined);
  assert.equal(parseProseFont("   "), undefined);
  assert.equal(parseProseFont(undefined), undefined);
  assert.equal(parseProseFont(42), undefined);
});

test("rejects anything that could escape the declaration it lands in", () => {
  // This setting is window-scoped, so workspace settings — a cloned repository — can supply
  // it, and the value reaches a stylesheet. Everything here must be refused.
  for (const attack of [
    "monospace; } body { display: none } .x {",
    "monospace}/*",
    "url(https://example.com/leak)",
    "monospace; background: url(https://example.com/x)",
    "expression(alert(1))",
    "var(--something)",
    "monospace\\3b color:red",
    "monospace<script>",
    "monospace\n} html {",
  ]) {
    assert.equal(parseProseFont(attack), undefined, attack);
    assert.equal(isUsableProseFont(attack), false, attack);
  }
});

test("refuses an absurdly long value", () => {
  assert.equal(parseProseFont("A".repeat(201)), undefined);
  assert.equal(parseProseFont("A".repeat(200)), "A".repeat(200));
});

test("accepts font names in any script without opening the gate wider", () => {
  assert.equal(parseProseFont("Fôntè Ñamé"), "Fôntè Ñamé");
  assert.equal(parseProseFont("Noto Sans 字体"), "Noto Sans 字体");
  assert.equal(parseProseFont("Иосевка"), "Иосевка");
  // The characters that matter are still refused, whatever script surrounds them.
  assert.equal(parseProseFont("字体; } body { display: none }"), undefined);
  assert.equal(parseProseFont("Иосевка/../x"), undefined);
});
