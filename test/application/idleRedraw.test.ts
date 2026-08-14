import assert = require("node:assert/strict");
import { test } from "node:test";
import { createIdleRedraw, IDLE_REDRAW_MS } from "../../src/webview/editor/idleRedraw";
import type { RedrawTimers } from "../../src/webview/editor/idleRedraw";

/**
 * What the reader gets from work that waits for a gap in the typing.
 *
 * Two failure modes, and this exists to sit between them: doing the work per keystroke costs a
 * second parse of the note inside every character, and doing it only once typing stops means a
 * touch typist — whose gaps are shorter than this delay — never sees it move at all.
 */

interface Clock {
  readonly timers: RedrawTimers;
  readonly advance: (milliseconds: number) => void;
}

function createClock(): Clock {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { readonly at: number; readonly run: () => void }>();
  return {
    timers: {
      setTimeout: (handler, delay) => {
        const handle = nextHandle;
        nextHandle += 1;
        pending.set(handle, { at: now + delay, run: handler });
        return handle;
      },
      clearTimeout: (handle) => {
        pending.delete(handle);
      },
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [handle, timer] of [...pending].sort((left, right) => left[1].at - right[1].at)) {
        if (timer.at > now) continue;
        pending.delete(handle);
        timer.run();
      }
    },
  };
}

test("a burst of keystrokes redraws once, not once per keystroke", () => {
  const clock = createClock();
  let redraws = 0;
  const idle = createIdleRedraw(() => { redraws += 1; }, clock.timers);

  for (let keystroke = 0; keystroke < 20; keystroke += 1) {
    idle.schedule();
    clock.advance(5);
  }
  assert.equal(redraws, 0, "nothing was drawn inside the keystrokes");

  clock.advance(IDLE_REDRAW_MS);
  assert.equal(redraws, 1);
});

test("typing that never pauses still gets its redraw", () => {
  const clock = createClock();
  let redraws = 0;
  const idle = createIdleRedraw(() => { redraws += 1; }, clock.timers);

  /*
   * 120ms between keystrokes is ordinary touch typing, and it is shorter than the delay. A
   * timer restarted by each keystroke would never fire through a paragraph written at speed,
   * which is exactly when the outline is worth having.
   */
  for (let keystroke = 0; keystroke < 20; keystroke += 1) {
    idle.schedule();
    clock.advance(120);
  }

  assert.ok(redraws >= 10, `a paragraph typed without a pause drew ${redraws} times`);
  assert.ok(redraws <= 20, `a paragraph typed without a pause drew ${redraws} times`);
});

test("a redraw that has already happened for other reasons is dropped", () => {
  const clock = createClock();
  let redraws = 0;
  const idle = createIdleRedraw(() => { redraws += 1; }, clock.timers);

  idle.schedule();
  idle.cancel();
  clock.advance(IDLE_REDRAW_MS * 2);
  assert.equal(redraws, 0);

  // And the next request is still honoured.
  idle.schedule();
  clock.advance(IDLE_REDRAW_MS);
  assert.equal(redraws, 1);
});
