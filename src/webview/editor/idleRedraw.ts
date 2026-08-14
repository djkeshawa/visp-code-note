/**
 * Work that belongs in the gap between keystrokes rather than inside one.
 *
 * The inspector's outline and task list are read from the draft, so they followed every
 * character: a second full parse of the note, plus a rebuilt row and a fresh listener for every
 * heading and every task, inside the keystroke. A note's outline does not need to track a
 * keystroke in the middle of a word.
 *
 * The timer is a trailing throttle rather than a debounce that each keystroke restarts. A
 * restarting timer is the obvious shape and the wrong one here: ordinary touch typing leaves
 * about 120ms between keystrokes, which is less than this delay, so the outline would stop
 * following the note for as long as someone was writing quickly — precisely when they would
 * look at it. This way the work happens at most once per delay and always within one delay of
 * being asked for.
 */

/** Long enough to skip a keystroke, short enough that a pause feels immediate. */
export const IDLE_REDRAW_MS = 150;

/** Injected so a test can hold the clock still rather than sleep. */
export interface RedrawTimers {
  readonly setTimeout: (handler: () => void, delay: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export interface IdleRedraw {
  /** Draw soon. Asking again before it happens does not push it further away. */
  readonly schedule: () => void;
  /** Drop a pending draw, for when something else has already drawn the same thing. */
  readonly cancel: () => void;
}

export function createIdleRedraw(
  redraw: () => void,
  timers: RedrawTimers = window,
  delay: number = IDLE_REDRAW_MS,
): IdleRedraw {
  let pending: number | undefined;
  return {
    schedule: () => {
      if (pending !== undefined) return;
      pending = timers.setTimeout(() => {
        pending = undefined;
        redraw();
      }, delay);
    },
    cancel: () => {
      if (pending === undefined) return;
      timers.clearTimeout(pending);
      pending = undefined;
    },
  };
}
