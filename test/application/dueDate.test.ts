import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  dueMoment,
  formatDueMoment,
  parseDue,
  parseReminderLead,
  parseTimeOfDay,
  reminderKey,
  reminderMoment,
} from "../../src/application/dueDate";

const NINE_AM = 9 * 60;

test("reads a due as a date and an optional time of day", () => {
  assert.deepEqual(parseDue("2026-08-15"), { dateKey: "2026-08-15" });
  assert.deepEqual(parseDue("2026-08-15 14:30"), { dateKey: "2026-08-15", minutes: 14 * 60 + 30 });
  assert.deepEqual(parseDue("2026-08-15T09:05"), { dateKey: "2026-08-15", minutes: 9 * 60 + 5 });
  assert.deepEqual(parseDue("  2026-08-15 7:00  "), { dateKey: "2026-08-15", minutes: 7 * 60 });
});

/*
 * `2026-07-22T18:00:00` is a form the extension has always read as a due date — everything that
 * groups and colours a task slices the first ten characters off it. Refusing it here meant its
 * reminder silently never fired, and put a warning under a date that was never wrong.
 */
test("reads a whole ISO timestamp, seconds and all", () => {
  const expected = { dateKey: "2026-07-22", minutes: 18 * 60 };
  assert.deepEqual(parseDue("2026-07-22T18:00:00"), expected);
  assert.deepEqual(parseDue("2026-07-22T18:00:00.500"), expected);
  assert.deepEqual(parseDue("2026-07-22 18:00:00"), expected);
});

test("a due that names its own zone fixes an instant rather than a wall clock", () => {
  assert.deepEqual(parseDue("2026-07-22T18:00:00Z"), {
    dateKey: "2026-07-22",
    minutes: 18 * 60,
    offsetMinutes: 0,
  });
  assert.equal(parseDue("2026-07-22T18:00+05:30")?.offsetMinutes, 330);
  assert.equal(parseDue("2026-07-22T18:00-0800")?.offsetMinutes, -480);

  assert.equal(
    dueMoment("2026-07-22T18:00:00Z", NINE_AM),
    Date.UTC(2026, 6, 22, 18, 0),
    "read as the instant it names, not as six in the evening wherever the reader is",
  );
  assert.equal(
    dueMoment("2026-07-22T13:30+05:30", NINE_AM),
    Date.UTC(2026, 6, 22, 8, 0),
  );
});

test("refuses a due nobody could act on", () => {
  assert.equal(parseDue(undefined), undefined);
  assert.equal(parseDue("next Tuesday"), undefined);
  assert.equal(parseDue("2026-13-01"), undefined, "month 13");
  assert.equal(parseDue("2026-02-30"), undefined, "a date the shape accepts but the calendar does not");
  assert.equal(parseDue("2026-08-15 24:00"), undefined, "hour 24");
  assert.equal(parseDue("2026-08-15 09:60"), undefined, "minute 60");
  assert.equal(parseDue("2026-8-5"), undefined, "the date has to be zero-padded, as everything else reads it");
  assert.equal(parseDue("2026-07-22T18:00+99:00"), undefined, "no such zone");
});

test("reads a reminder lead in minutes, hours or days", () => {
  assert.equal(parseReminderLead("15m"), 15);
  assert.equal(parseReminderLead("2h"), 120);
  assert.equal(parseReminderLead("1d"), 1440);
  assert.equal(parseReminderLead(" 30 M "), 30);
});

test("refuses a lead that is a typo rather than a plan", () => {
  assert.equal(parseReminderLead(undefined), undefined);
  assert.equal(parseReminderLead("soon"), undefined);
  assert.equal(parseReminderLead("5w"), undefined, "no week unit");
  assert.equal(parseReminderLead("30d"), undefined, "beyond the fortnight ceiling");
});

test("falls back to nine in the morning for an unreadable default time", () => {
  assert.equal(parseTimeOfDay("07:45"), 7 * 60 + 45);
  assert.equal(parseTimeOfDay("23:59"), 23 * 60 + 59);
  assert.equal(parseTimeOfDay("half seven"), NINE_AM);
  assert.equal(parseTimeOfDay(undefined), NINE_AM);
});

test("places a due in the reader's own zone, not UTC", () => {
  const moment = dueMoment("2026-08-15 14:30", NINE_AM);
  assert.notEqual(moment, undefined);
  const local = new Date(moment!);
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getMonth(), 7);
  assert.equal(local.getDate(), 15);
  assert.equal(local.getHours(), 14);
  assert.equal(local.getMinutes(), 30);
});

test("a date-only due falls at the configured time of day", () => {
  const moment = dueMoment("2026-08-15", 7 * 60 + 30);
  assert.equal(new Date(moment!).getHours(), 7);
  assert.equal(new Date(moment!).getMinutes(), 30);
});

test("a reminder comes before its due by the lead it carries", () => {
  const due = dueMoment("2026-08-15 14:00", NINE_AM)!;
  assert.equal(reminderMoment("2026-08-15 14:00", "30m", NINE_AM, 0), due - 30 * 60_000);
  assert.equal(reminderMoment("2026-08-15 14:00", undefined, NINE_AM, 0), due);
  assert.equal(
    reminderMoment("2026-08-15 14:00", undefined, NINE_AM, 10),
    due - 10 * 60_000,
    "the configured default applies when the task names no lead of its own",
  );
  assert.equal(
    reminderMoment("2026-08-15 14:00", "2h", NINE_AM, 10),
    due - 120 * 60_000,
    "the task's own lead wins over the default",
  );
  assert.equal(reminderMoment("whenever", "30m", NINE_AM, 0), undefined);
});

test("a reminder's identity survives a reword but not a change of moment", () => {
  const at = dueMoment("2026-08-15 14:00", NINE_AM)!;
  const moved = dueMoment("2026-08-16 14:00", NINE_AM)!;

  assert.equal(
    reminderKey("file:///a.md", "t1", at),
    reminderKey("file:///a.md", "t1", at),
    "the same task at the same moment is the same reminder",
  );
  assert.notEqual(
    reminderKey("file:///a.md", "t1", at),
    reminderKey("file:///a.md", "t1", moved),
    "moving the due date re-arms it",
  );
  assert.notEqual(
    reminderKey("file:///a.md", undefined, at),
    reminderKey("file:///b.md", undefined, at),
    "the same moment in two notes is two reminders",
  );
  assert.equal(
    reminderKey("file:///a.md", undefined, at).includes("Ship"),
    false,
    "no task text goes into the key, so editing the line cannot re-raise the reminder",
  );
});

test("says the time only when the due carries one", () => {
  const dated = dueMoment("2026-08-15", NINE_AM)!;
  assert.equal(formatDueMoment("2026-08-15", dated).includes("at"), false);
  const timed = dueMoment("2026-08-15 14:30", NINE_AM)!;
  assert.equal(formatDueMoment("2026-08-15 14:30", timed).includes("at"), true);
});
