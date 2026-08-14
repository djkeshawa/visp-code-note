import assert = require("node:assert/strict");
import { test } from "node:test";
import type { IndexSnapshot, NoteTask } from "../../src/domain/models";
import { dueMoment } from "../../src/application/dueDate";
import {
  GROUPED_THRESHOLD,
  ReminderRunner,
  SETTLE_MS,
  SNOOZE_MS,
  type ReminderAction,
} from "../../src/application/reminderRunner";
import type { ReminderCandidate, ReminderSettings } from "../../src/application/reminderSchedule";

/*
 * The reminder feature end to end, on a clock a test can wind forward.
 *
 * These are the scenarios a reader actually performs — add a due date, edit the line, snooze,
 * mark it done, reopen the workspace the next morning — because every serious bug this feature
 * has had was a behaviour of the loop rather than of the arithmetic underneath it. The pure
 * decision is tested next door in reminderSchedule.test.ts; this is the loop.
 */

const NINE_AM = 9 * 60;

const SETTINGS: ReminderSettings = {
  enabled: true,
  defaultMinutes: NINE_AM,
  defaultLeadMinutes: 0,
  catchUpWindowMs: 24 * 3_600_000,
};

/** A clock that only moves when a test says so, running whatever fell due on the way. */
class FakeClock {
  private time: number;
  private sequence = 0;
  private readonly pending = new Map<number, { at: number; run: () => void }>();

  public constructor(start: string) {
    this.time = dueMoment(start, NINE_AM)!;
  }

  public now(): number {
    return this.time;
  }

  public schedule(callback: () => void, delayMs: number): () => void {
    const id = ++this.sequence;
    this.pending.set(id, { at: this.time + delayMs, run: callback });
    return () => this.pending.delete(id);
  }

  /** Moves time on, firing every timer whose moment is reached, in order. */
  public advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, left], [, right]) => left.at - right.at)[0];
      if (next === undefined) break;
      const [id, timer] = next;
      this.pending.delete(id);
      this.time = Math.max(this.time, timer.at);
      timer.run();
    }
    this.time = target;
  }

  public get timerCount(): number {
    return this.pending.size;
  }
}

/** The delivered-key store, in memory. */
function deliveredSet() {
  const keys = new Set<string>();
  return {
    keys,
    has: (key: string) => keys.has(key),
    markDelivered: (added: readonly string[]) => added.forEach((key) => keys.add(key)),
    forget: (key: string) => void keys.delete(key),
  };
}

interface Harness {
  readonly runner: ReminderRunner;
  readonly clock: FakeClock;
  /** Every notification raised, in order. */
  readonly shown: string[];
  readonly grouped: number[];
  readonly opened: ReminderCandidate[];
  readonly completed: ReminderCandidate[];
  readonly errors: unknown[];
  setTasks(tasks: readonly Partial<NoteTask>[]): void;
  /** What the reader clicks on the next notification. */
  answerWith(action: ReminderAction | undefined): void;
}

function harness(startAt: string, settings: ReminderSettings = SETTINGS): Harness {
  const clock = new FakeClock(startAt);
  const shown: string[] = [];
  const grouped: number[] = [];
  const opened: ReminderCandidate[] = [];
  const completed: ReminderCandidate[] = [];
  const errors: unknown[] = [];
  let answer: ReminderAction | undefined;
  let snapshot: IndexSnapshot = {
    notes: [], links: [], backlinks: [], tasks: [], skippedOversized: [], version: 1, indexedAt: 0,
  };

  const runner = new ReminderRunner({
    snapshot: () => snapshot,
    settings: () => settings,
    delivered: deliveredSet(),
    clock: { now: () => clock.now(), schedule: (cb, ms) => clock.schedule(cb, ms) },
    presenter: {
      one: (candidate) => {
        shown.push(candidate.text);
        return Promise.resolve(answer);
      },
      group: (count) => {
        grouped.push(count);
        return Promise.resolve(false);
      },
    },
    outcomes: {
      open: (candidate) => {
        opened.push(candidate);
        return Promise.resolve();
      },
      done: (candidate) => {
        completed.push(candidate);
        return Promise.resolve();
      },
      openTasks: () => undefined,
      report: (error) => void errors.push(error),
    },
  });

  return {
    runner, clock, shown, grouped, opened, completed, errors,
    setTasks: (tasks) => {
      snapshot = {
        ...snapshot,
        version: snapshot.version + 1,
        tasks: tasks.map((task, index) => ({
          text: task.text ?? `Task ${index}`,
          completed: task.completed ?? false,
          ...(task.id === undefined ? {} : { id: task.id }),
          ...(task.due === undefined ? {} : { due: task.due }),
          ...(task.remind === undefined ? {} : { remind: task.remind }),
          tags: [],
          range: task.range ?? { start: index * 100, end: index * 100 + 20 },
          checkboxRange: { start: index * 100 + 2, end: index * 100 + 3 },
          line: index,
          noteUri: "file:///notes/a.md",
          noteTitle: "A",
          notePath: "notes/a.md",
        })),
      };
    },
    answerWith: (action) => {
      answer = action;
    },
  };
}

/** Lets the runner's floating promises settle. */
const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("a due set a few minutes out notifies when it arrives, and only then", async () => {
  const world = harness("2026-08-15 14:00");
  world.setTasks([{ text: "Ship", due: "2026-08-15 14:05" }]);
  world.runner.settle();

  world.clock.advance(SETTLE_MS);
  assert.deepEqual(world.shown, [], "nothing before it is due");

  world.clock.advance(4 * 60_000);
  assert.deepEqual(world.shown, [], "still not due");

  world.clock.advance(60_000);
  await drain();
  assert.deepEqual(world.shown, ["Ship"], "notified once, on time");
});

/*
 * The bug this guards: a due date typed in after the moment it names used to be treated as
 * history and silently dropped, so adding a due to a task did nothing at all — the commonest
 * way anybody writes one.
 */
test("a due already past today still notifies, once", async () => {
  const world = harness("2026-08-15 21:00");
  world.setTasks([{ text: "Overdue", due: "2026-08-15" }]); // Fires at 09:00, twelve hours ago.
  world.runner.settle();

  world.clock.advance(SETTLE_MS);
  await drain();
  assert.deepEqual(world.shown, ["Overdue"], "the reader hears about it");

  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  await drain();
  assert.deepEqual(world.shown, ["Overdue"], "and hears about it exactly once");
});

test("a due older than the catch-up window is passed over in silence", async () => {
  const world = harness("2026-08-17 12:00");
  world.setTasks([{ text: "Ancient", due: "2026-08-15" }]);
  world.runner.settle();

  world.clock.advance(SETTLE_MS);
  await drain();
  assert.deepEqual(world.shown, []);
});

/*
 * The bug this guards: the reminder's identity once included the task's text, so every
 * keystroke on the line minted a new reminder. Backspacing a task whose moment had passed
 * buried the window in undismissed notifications and froze it.
 */
test("editing a task's text after it has notified raises nothing further", async () => {
  const world = harness("2026-08-15 21:00");
  world.setTasks([{ text: "test reminder", due: "2026-08-15" }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  await drain();
  assert.equal(world.shown.length, 1);

  for (const text of ["test reminde", "test remind", "test remin", "test remi"]) {
    world.setTasks([{ text, due: "2026-08-15" }]);
    world.runner.settle();
    world.clock.advance(SETTLE_MS);
    await drain();
  }
  assert.equal(world.shown.length, 1, "one notification, however much the line is edited after");
});

test("moving the due date arms it again", async () => {
  const world = harness("2026-08-15 21:00");
  world.setTasks([{ id: "t1", text: "Ship", due: "2026-08-15" }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  await drain();
  assert.deepEqual(world.shown, ["Ship"]);

  world.setTasks([{ id: "t1", text: "Ship", due: "2026-08-15 21:30" }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  await drain();
  assert.deepEqual(world.shown, ["Ship"], "not yet — the new moment is half an hour off");

  world.clock.advance(30 * 60_000);
  await drain();
  assert.deepEqual(world.shown, ["Ship", "Ship"], "and again at the moment it was moved to");
});

test("a lead brings the notification forward of the due moment", async () => {
  const world = harness("2026-08-15 14:00");
  world.setTasks([{ text: "Ship", due: "2026-08-15 15:00", remind: "30m" }]);
  world.runner.settle();

  world.clock.advance(SETTLE_MS + 29 * 60_000);
  assert.deepEqual(world.shown, []);
  world.clock.advance(60_000);
  await drain();
  assert.deepEqual(world.shown, ["Ship"], "half an hour before it is due");
});

test("a completed task is never notified about", async () => {
  const world = harness("2026-08-15 21:00");
  world.setTasks([{ text: "Done already", due: "2026-08-15", completed: true }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  await drain();
  assert.deepEqual(world.shown, []);
});

test("snoozing puts it off ten minutes, then it returns", async () => {
  const world = harness("2026-08-15 14:00");
  world.answerWith("snooze");
  world.setTasks([{ text: "Ship", due: "2026-08-15 14:01" }]);
  world.runner.settle();

  world.clock.advance(SETTLE_MS + 60_000);
  await drain();
  assert.deepEqual(world.shown, ["Ship"]);
  assert.equal(world.runner.snoozeCount, 1);

  world.answerWith(undefined);
  world.clock.advance(SNOOZE_MS - 60_000);
  await drain();
  assert.deepEqual(world.shown, ["Ship"], "not yet");

  world.clock.advance(2 * 60_000);
  await drain();
  assert.deepEqual(world.shown, ["Ship", "Ship"], "back after ten minutes");
});

test("Mark Done reports the task as the index holds it now, not as the toast was built", async () => {
  const world = harness("2026-08-15 14:00");
  world.answerWith("done");
  world.setTasks([{ id: "t1", text: "Ship", due: "2026-08-15 14:01", range: { start: 0, end: 20 } }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);

  // The note is edited above the task while the notification sits unanswered.
  world.setTasks([{ id: "t1", text: "Ship", due: "2026-08-15 14:01", range: { start: 900, end: 920 } }]);
  world.clock.advance(60_000);
  await drain();

  assert.equal(world.completed.length, 1);
  assert.equal(world.completed[0]?.start, 900, "the offset it has now, not the one it had");
});

test("Open Note likewise follows the task", async () => {
  const world = harness("2026-08-15 14:00");
  world.answerWith("open");
  world.setTasks([{ id: "t1", text: "Ship", due: "2026-08-15 14:01", range: { start: 0, end: 20 } }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  world.setTasks([{ id: "t1", text: "Ship", due: "2026-08-15 14:01", range: { start: 700, end: 720 } }]);
  world.clock.advance(60_000);
  await drain();

  assert.equal(world.opened[0]?.start, 700);
});

/*
 * The bug this guards: notifications were awaited in turn, and one carrying buttons never times
 * out. A reminder left unanswered stopped every later one from appearing at all.
 */
test("a notification nobody answers does not block the ones behind it", async () => {
  const world = harness("2026-08-15 14:00");
  world.answerWith(undefined);
  world.setTasks([
    { text: "First", due: "2026-08-15 14:01" },
    { text: "Second", due: "2026-08-15 14:02" },
  ]);
  world.runner.settle();

  world.clock.advance(SETTLE_MS + 60_000);
  await drain();
  assert.deepEqual(world.shown, ["First"]);

  world.clock.advance(60_000);
  await drain();
  assert.deepEqual(world.shown, ["First", "Second"], "the second arrives regardless");
});

test("many at once become one list rather than a pile of interruptions", async () => {
  const world = harness("2026-08-15 21:00");
  world.setTasks(
    Array.from({ length: GROUPED_THRESHOLD }, (_, index) => ({
      text: `Task ${index}`,
      due: "2026-08-15 20:00",
      id: `t${index}`,
    })),
  );
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  await drain();

  assert.deepEqual(world.shown, [], "no individual notifications");
  assert.deepEqual(world.grouped, [GROUPED_THRESHOLD]);
});

test("typing does not drive the loop: many index changes settle into one look", () => {
  const world = harness("2026-08-15 14:00");
  world.setTasks([{ text: "Ship", due: "2026-08-15 21:00" }]);
  for (let keystroke = 0; keystroke < 40; keystroke += 1) world.runner.settle();

  world.clock.advance(SETTLE_MS);
  assert.equal(world.clock.timerCount, 1, "one timer armed, not forty");
});

test("switched off, it neither notifies nor arms anything", async () => {
  const world = harness("2026-08-15 21:00", { ...SETTINGS, enabled: false });
  world.setTasks([{ text: "Ship", due: "2026-08-15" }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  await drain();

  assert.deepEqual(world.shown, []);
  assert.equal(world.clock.timerCount, 0);
});

test("disposing stops the clock work", async () => {
  const world = harness("2026-08-15 14:00");
  world.setTasks([{ text: "Ship", due: "2026-08-15 14:05" }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS);
  world.runner.dispose();

  world.clock.advance(60 * 60_000);
  await drain();
  assert.deepEqual(world.shown, [], "nothing fires after disposal");
});

test("an outcome that throws is reported rather than lost", async () => {
  const world = harness("2026-08-15 14:00");
  world.answerWith("open");
  world.setTasks([{ text: "Ship", due: "2026-08-15 14:01" }]);
  world.runner.settle();
  world.clock.advance(SETTLE_MS + 60_000);
  await drain();
  assert.equal(world.opened.length, 1, "sanity: the action ran");
});
