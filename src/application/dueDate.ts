/**
 * When a task is due, and when it should say so.
 *
 * `@due(...)` began as a date and stays one: everything that groups, buckets or colours a task
 * reads `due.slice(0, 10)`, so a trailing time is invisible to all of it. What a time buys is a
 * moment precise enough to fire a reminder against, which a date alone cannot give — a task due
 * "today" is due at some hour, and that hour is either written down or configured.
 *
 * Nothing here imports `vscode`: the arithmetic is the part worth testing, and a test cannot
 * open an extension host.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/*
 * Seconds, fractional seconds and a zone suffix are all accepted and all optional. A reminder
 * has no use for anything finer than a minute, but people paste whole ISO 8601 timestamps, and
 * the rest of the extension has always read `2026-07-22T18:00:00` as a due date — it slices the
 * first ten characters. Refusing the form here made its reminder silently never fire, and put a
 * warning under a date that was never wrong.
 */
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const LEAD = /^(\d+)\s*([mhd])$/i;
const TIME_OF_DAY = /^(\d{1,2}):(\d{2})$/;

const MINUTES_PER_DAY = 24 * 60;

/** The longest lead a reminder accepts; anything past a fortnight is a typo, not a plan. */
export const MAX_LEAD_MINUTES = 14 * MINUTES_PER_DAY;

export interface DueValue {
  /** `YYYY-MM-DD`, exactly what every other consumer already slices off the front. */
  readonly dateKey: string;
  /** Minutes after midnight, absent when the due carries no time of day. */
  readonly minutes?: number;
  /**
   * Minutes east of UTC, when the due names a zone of its own. Absent for the ordinary case,
   * where the time of day means the reader's own clock.
   */
  readonly offsetMinutes?: number;
}

/**
 * A written `@due(...)` as a date and an optional time of day.
 *
 * Returns `undefined` rather than guessing: a due nobody can read is a due nobody should be
 * interrupted by. Note that the rest of the extension still displays such a value verbatim —
 * `formatDueDate` falls back to the raw string — so an unparseable due is visible, just silent.
 */
export function parseDue(value: string | undefined): DueValue | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();

  const dateOnly = DATE.exec(trimmed);
  if (dateOnly !== null) {
    return isRealDate(trimmed) ? { dateKey: trimmed } : undefined;
  }

  const withTime = DATE_TIME.exec(trimmed);
  if (withTime === null) return undefined;
  const [, year, month, day, hour, minute, zone] = withTime;
  const dateKey = `${year}-${month}-${day}`;
  const minutes = timeToMinutes(Number(hour), Number(minute));
  if (!isRealDate(dateKey) || minutes === undefined) return undefined;
  const offsetMinutes = zone === undefined ? undefined : zoneOffsetMinutes(zone);
  if (zone !== undefined && offsetMinutes === undefined) return undefined;
  return {
    dateKey,
    minutes,
    ...(offsetMinutes === undefined ? {} : { offsetMinutes }),
  };
}

/** `Z`, `+05:30` or `-0800` as minutes east of UTC. */
function zoneOffsetMinutes(zone: string): number | undefined {
  if (zone.toLocaleUpperCase() === "Z") return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (match === null) return undefined;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return undefined;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

/** A written `@remind(...)` lead in minutes: `15m`, `2h`, `1d`. */
export function parseReminderLead(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = LEAD.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "m").toLocaleLowerCase();
  if (!Number.isSafeInteger(amount)) return undefined;
  const minutes = unit === "d" ? amount * MINUTES_PER_DAY : unit === "h" ? amount * 60 : amount;
  // Beyond the ceiling the timer would be armed for a moment the task has long moved past.
  return minutes <= MAX_LEAD_MINUTES ? minutes : undefined;
}

/** A configured `HH:MM` default as minutes after midnight, falling back to 09:00. */
export function parseTimeOfDay(value: string | undefined, fallback = 9 * 60): number {
  const match = TIME_OF_DAY.exec((value ?? "").trim());
  if (match === null) return fallback;
  return timeToMinutes(Number(match[1]), Number(match[2])) ?? fallback;
}

/**
 * The local moment a due falls at.
 *
 * Built through the `Date` constructor rather than `Date.parse`, so it lands in the reader's own
 * zone and follows their DST rules. Parsing `2026-08-15T09:00` as UTC would fire a nine-o'clock
 * reminder at whatever hour that happens to be where they are.
 */
export function dueMoment(
  due: string | undefined,
  defaultMinutes: number,
): number | undefined {
  const parsed = parseDue(due);
  if (parsed === undefined) return undefined;
  const [year, month, day] = parsed.dateKey.split("-").map(Number) as [number, number, number];
  const minutes = parsed.minutes ?? defaultMinutes;
  /*
   * A due that names its own zone fixes an instant, and is read as one. Everything else is a
   * wall clock: nine in the morning means nine where the reader is, whatever zone they were in
   * when they wrote it.
   */
  if (parsed.offsetMinutes !== undefined) {
    return Date.UTC(year, month - 1, day) + (minutes - parsed.offsetMinutes) * 60_000;
  }
  return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
}

/**
 * When to interrupt about a task: its due moment, brought forward by the lead it carries or by
 * the configured default.
 */
export function reminderMoment(
  due: string | undefined,
  remind: string | undefined,
  defaultMinutes: number,
  defaultLeadMinutes: number,
): number | undefined {
  const moment = dueMoment(due, defaultMinutes);
  if (moment === undefined) return undefined;
  const lead = parseReminderLead(remind) ?? Math.max(0, defaultLeadMinutes);
  return moment - lead * 60_000;
}

/**
 * What makes one reminder the same reminder across a reload.
 *
 * The moment is part of the identity on purpose. Moving a task's due date re-arms it, which is
 * the point of moving it, and no separate invalidation pass has to remember to run.
 *
 * The task's *text* is deliberately not part of it. It used to be, as the fallback for a task
 * carrying no `<!-- task:id -->`, and that made every keystroke on the line a different
 * reminder: editing a task whose moment had already passed raised a fresh notification per
 * character until the window was buried in undismissed toasts. Two unidentified tasks in one
 * note due at the same moment now share a reminder, which is a far smaller cost.
 */
/**
 * A task id is written by the extension, but a note is workspace content and can carry any
 * `<!-- task:… -->` it likes, at any length. The store that remembers delivered reminders
 * refuses a key past its budget — and refusing it means the reminder is never recorded as
 * delivered, so it fires again on every index change, as an un-dismissable toast, forever.
 * Folding a long id to a fixed-width digest keeps every key inside the budget.
 */
const MAX_KEY_ID_LENGTH = 128;

function boundedId(id: string): string {
  if (id.length <= MAX_KEY_ID_LENGTH) return id;
  // Not a security digest — only a stable, short stand-in for an unreasonable id.
  let hash = 5381;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash * 33) ^ id.charCodeAt(index)) >>> 0;
  }
  return `${id.slice(0, MAX_KEY_ID_LENGTH)}~${hash.toString(36)}`;
}

export function reminderKey(noteUri: string, id: string | undefined, at: number): string {
  return `${noteUri} ${id === undefined ? "" : boundedId(id)} ${at}`;
}

/** A due moment written the way a toast should say it. */
export function formatDueMoment(due: string | undefined, moment: number): string {
  const parsed = parseDue(due);
  const date = new Date(moment);
  const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  if (parsed?.minutes === undefined) return day;
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(date);
  return `${day} at ${time}`;
}

function timeToMinutes(hour: number, minute: number): number | undefined {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return hour * 60 + minute;
}

/** Rejects `2026-02-30` and friends, which the shape alone accepts. */
function isRealDate(dateKey: string): boolean {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
