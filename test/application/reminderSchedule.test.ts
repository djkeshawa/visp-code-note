import assert = require("node:assert/strict");
import { test } from "node:test";
import type { IndexSnapshot, NoteTask } from "../../src/domain/models";
import { dueMoment } from "../../src/application/dueDate";
import {
  decideReminders,
  reminderCandidates,
  type ReminderSettings,
} from "../../src/application/reminderSchedule";

const NINE_AM = 9 * 60;

const SETTINGS: ReminderSettings = {
  enabled: true,
  defaultMinutes: NINE_AM,
  defaultLeadMinutes: 0,
  catchUpWindowMs: 24 * 3_600_000,
};

function task(overrides: Partial<NoteTask> & { readonly text: string }): IndexSnapshot["tasks"][number] {
  return {
    text: overrides.text,
    completed: overrides.completed ?? false,
    ...(overrides.id === undefined ? {} : { id: overrides.id }),
    ...(overrides.due === undefined ? {} : { due: overrides.due }),
    ...(overrides.remind === undefined ? {} : { remind: overrides.remind }),
    tags: [],
    range: overrides.range ?? { start: 0, end: 10 },
    checkboxRange: { start: 2, end: 3 },
    line: 0,
    noteUri: "file:///notes/a.md",
    noteTitle: "A",
    notePath: "notes/a.md",
  };
}

function snapshot(tasks: readonly IndexSnapshot["tasks"][number][]): IndexSnapshot {
  return { notes: [], links: [], backlinks: [], tasks, version: 1, indexedAt: 0 };
}

const never = (): boolean => false;

/** Activation long before any moment these tests use, so nothing counts as history. */
const WATCHING = { watchSince: Date.parse("2026-01-01T00:00:00"), catchUp: false };

test("only incomplete tasks with a readable due are reminders at all", () => {
  const candidates = reminderCandidates(
    snapshot([
      task({ text: "Timed", due: "2026-08-15 14:00" }),
      task({ text: "Dated", due: "2026-08-15" }),
      task({ text: "Done", due: "2026-08-15", completed: true }),
      task({ text: "No due" }),
      task({ text: "Unreadable due", due: "sometime" }),
    ]),
    SETTINGS,
  );
  assert.deepEqual(candidates.map((candidate) => candidate.text), ["Timed", "Dated"]);
});

test("a reminder in the future schedules rather than fires", () => {
  const due = "2026-08-15 14:00";
  const at = dueMoment(due, NINE_AM)!;
  const decision = decideReminders(
    reminderCandidates(snapshot([task({ text: "Ship", due })]), SETTINGS),
    at - 60_000,
    never,
    SETTINGS,
    WATCHING,
  );
  assert.deepEqual(decision.deliver, []);
  assert.equal(decision.nextAt, at);
});

test("a reminder that has just passed fires", () => {
  const due = "2026-08-15 14:00";
  const at = dueMoment(due, NINE_AM)!;
  const decision = decideReminders(
    reminderCandidates(snapshot([task({ text: "Ship", due })]), SETTINGS),
    at + 60_000,
    never,
    SETTINGS,
    WATCHING,
  );
  assert.deepEqual(decision.deliver.map((candidate) => candidate.text), ["Ship"]);
  assert.equal(decision.nextAt, undefined);
});

test("at startup, a missed reminder inside the catch-up window is shown and an older one is not", () => {
  const due = "2026-08-15 14:00";
  const at = dueMoment(due, NINE_AM)!;
  const candidates = reminderCandidates(snapshot([task({ text: "Stale", due })]), SETTINGS);

  const justInside = at + SETTINGS.catchUpWindowMs;
  const shown = decideReminders(candidates, justInside, never, SETTINGS, {
    watchSince: justInside,
    catchUp: true,
  });
  assert.deepEqual(shown.deliver.map((candidate) => candidate.text), ["Stale"]);
  assert.deepEqual(shown.suppress, []);

  const justOutside = at + SETTINGS.catchUpWindowMs + 1;
  const skipped = decideReminders(candidates, justOutside, never, SETTINGS, {
    watchSince: justOutside,
    catchUp: true,
  });
  assert.deepEqual(skipped.deliver, []);
  assert.deepEqual(skipped.suppress.map((candidate) => candidate.text), ["Stale"]);
});

/*
 * The bug this guards: typing a due date that has already gone by used to raise a notification
 * on the spot, and because the reminder's identity included the task's text, every keystroke
 * that followed raised another. Backspacing the line buried the window in toasts.
 */
test("a due typed in after the fact never raises a notification", () => {
  const at = dueMoment("2026-08-15 09:00", NINE_AM)!;
  const candidates = reminderCandidates(
    snapshot([task({ text: "Typed late", due: "2026-08-15 09:00" })]),
    SETTINGS,
  );
  const decision = decideReminders(candidates, at + 3_600_000, never, SETTINGS, {
    watchSince: at + 1_800_000,
    catchUp: false,
  });
  assert.deepEqual(decision.deliver, [], "the moment is older than this session");
  assert.deepEqual(decision.suppress.map((candidate) => candidate.text), ["Typed late"]);
});

test("editing a task's text does not re-raise a reminder already delivered", () => {
  const due = "2026-08-15 09:00";
  const at = dueMoment(due, NINE_AM)!;
  const delivered = new Set<string>();
  let raised = 0;

  // The reader backspaces the task's text one character at a time after it fired.
  for (const text of ["test reminder", "test reminde", "test remind", "test remin"]) {
    const decision = decideReminders(
      reminderCandidates(snapshot([task({ text, due })]), SETTINGS),
      at + 60_000,
      (key) => delivered.has(key),
      SETTINGS,
      WATCHING,
    );
    raised += decision.deliver.length;
    for (const candidate of [...decision.deliver, ...decision.suppress]) {
      delivered.add(candidate.key);
    }
  }

  assert.equal(raised, 1, "one reminder, however much the line is edited afterwards");
});

test("an already-delivered reminder is neither shown again nor scheduled", () => {
  const due = "2026-08-15 14:00";
  const at = dueMoment(due, NINE_AM)!;
  const candidates = reminderCandidates(snapshot([task({ text: "Ship", due })]), SETTINGS);
  const always = (): boolean => true;

  assert.deepEqual(
    decideReminders(candidates, at + 60_000, always, SETTINGS, WATCHING).deliver,
    [],
  );
  assert.equal(
    decideReminders(candidates, at - 60_000, always, SETTINGS, WATCHING).nextAt,
    undefined,
    "a handled reminder must not keep a timer armed for it",
  );
});

test("the next wake-up is the earliest reminder still pending", () => {
  const early = dueMoment("2026-08-15 10:00", NINE_AM)!;
  const decision = decideReminders(
    reminderCandidates(
      snapshot([
        task({ text: "Late", due: "2026-08-15 16:00" }),
        task({ text: "Early", due: "2026-08-15 10:00" }),
      ]),
      SETTINGS,
    ),
    dueMoment("2026-08-15 08:00", NINE_AM)!,
    never,
    SETTINGS,
    WATCHING,
  );
  assert.equal(decision.nextAt, early);
});

test("due reminders arrive in the order they came due", () => {
  const decision = decideReminders(
    reminderCandidates(
      snapshot([
        task({ text: "Second", due: "2026-08-15 16:00" }),
        task({ text: "First", due: "2026-08-15 10:00" }),
      ]),
      SETTINGS,
    ),
    dueMoment("2026-08-15 18:00", NINE_AM)!,
    never,
    SETTINGS,
    WATCHING,
  );
  assert.deepEqual(decision.deliver.map((candidate) => candidate.text), ["First", "Second"]);
});

test("nothing happens at all when reminders are switched off", () => {
  const settings = { ...SETTINGS, enabled: false };
  const decision = decideReminders(
    reminderCandidates(snapshot([task({ text: "Ship", due: "2026-08-15 14:00" })]), settings),
    dueMoment("2026-08-16", NINE_AM)!,
    never,
    settings,
    WATCHING,
  );
  assert.deepEqual(decision, { deliver: [], suppress: [] });
});

test("a lead brings the reminder forward of the due moment", () => {
  const due = "2026-08-15 14:00";
  const at = dueMoment(due, NINE_AM)!;
  const [candidate] = reminderCandidates(
    snapshot([task({ text: "Ship", due, remind: "30m" })]),
    SETTINGS,
  );
  assert.equal(candidate?.at, at - 30 * 60_000);
  assert.equal(candidate?.dueAt, at, "the toast still says when it is actually due");
});
