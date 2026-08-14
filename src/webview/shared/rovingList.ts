/**
 * Arrow-key navigation for a list whose rows are rebuilt from scratch on every publish.
 *
 * Two problems, and they are the same problem. Every row in these panels is its own tab stop,
 * so reaching row 40 of a filtered list costs 40 Tab presses through a list that redraws
 * underneath you. And every view here re-renders by replacing its rows, so any action taken
 * from the keyboard destroys the element the reader was standing on and drops focus to the
 * body — the regression the Due Today list already carries `pendingTaskFocus` to prevent.
 *
 * So a list is one tab stop, arrows move within it, and a list that held focus when its rows
 * were replaced takes focus back afterwards. The pattern is the note context menu's and the
 * graph's, not a third one.
 */

/**
 * Which row a key moves to, or `undefined` when the key is not a move.
 *
 * The ends clamp rather than wrap. A four-item menu can wrap harmlessly; a list of several
 * hundred notes cannot — holding ArrowDown would silently teleport the reader back to the top,
 * and Home and End are the keys that are supposed to do that.
 */
export function nextRowIndex(key: string, current: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  const last = count - 1;
  switch (key) {
    case "ArrowDown":
      return Math.min(current + 1, last);
    case "ArrowUp":
      return Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return undefined;
  }
}

/**
 * Whether this press is the panel's to answer.
 *
 * Every key these lists take is an unmodified one, and every modified version of it is spent
 * elsewhere: Ctrl+Home and Ctrl+End scroll the view, Alt+Left and Alt+Right are Go Back and Go
 * Forward, and both fire inside a webview. Swallowing them would take VS Code's own navigation
 * away from anyone standing in a list.
 */
export function isBareKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

export interface RovingListOptions {
  /** Selects the rows, relative to the container. */
  readonly rows: string;
  /**
   * Selects the focusable controls inside one row, when a row holds more than one — a task
   * row has a checkbox and a way in. Absent when the row is itself the control.
   */
  readonly controls?: string;
}

/**
 * One list, one tab stop.
 *
 * The instance owns which row is current and puts it back after a re-render. It reads the DOM
 * on every `refresh` rather than holding element handles, because the elements it was given
 * last time no longer exist.
 */
export class RovingList {
  private index = 0;
  /**
   * Which control within the row, for rows that hold more than one. Remembered so that a
   * reader working down the checkboxes is put back on a checkbox after the list is rebuilt,
   * rather than on the row's other control.
   */
  private column = 0;
  /**
   * Whether focus was inside this list. Kept across a re-render on purpose: the `focusout`
   * that fires when a focused row is removed reports no new target, and that is exactly the
   * case this class exists to repair.
   */
  private held = false;

  public constructor(
    private readonly container: HTMLElement,
    private readonly options: RovingListOptions,
  ) {
    container.addEventListener("keydown", (event) => this.handleKeydown(event));
    container.addEventListener("focusin", () => {
      this.held = true;
      const active = document.activeElement;
      const at = this.rowIndexOf(active);
      if (at === undefined) return;
      this.column = this.columnOf(this.rows()[at], active);
      if (at === this.index) return;
      /*
       * Focus arrived somewhere this list did not send it — a click, or one of the panels
       * putting focus back on the row it had just replaced. The tab stop follows, or Tab out
       * and back would drop the reader somewhere they have not been.
       */
      this.index = at;
      this.markTabStops(this.rows());
    });
    container.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !container.contains(next)) this.held = false;
    });
  }

  /**
   * Call after the rows have been replaced. Re-marks the tab stop, and takes focus back when
   * this list was holding it and the row it was on has just been destroyed.
   */
  public refresh(): void {
    const rows = this.rows();
    if (rows.length === 0) {
      this.index = 0;
      return;
    }
    this.index = Math.min(this.index, rows.length - 1);
    this.markTabStops(rows);
    /*
     * Only when focus was destroyed rather than moved. A reader who clicked into the filter
     * while the index was republishing must not be yanked back into the list.
     */
    const active = document.activeElement;
    if (this.held && (active === null || active === document.body)) {
      this.focusRow(this.index, this.column);
    }
  }

  /** Moves focus into the list, at the top. False when there is nothing to move to. */
  public focusFirst(): boolean {
    if (this.rows().length === 0) return false;
    this.index = 0;
    this.column = 0;
    this.refresh();
    return this.focusRow(0);
  }

  /** The row the keyboard would act on, for a caller that wants to activate rather than focus. */
  public firstRow(): HTMLElement | undefined {
    return this.rows()[0];
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!isBareKey(event)) return;
    const from = this.rowIndexOf(event.target);
    if (from === undefined) return;
    const rows = this.rows();
    const to = nextRowIndex(event.key, from, rows.length);
    if (to === undefined || to === from) {
      // Still swallow a move that had nowhere to go, or the panel scrolls out from under it.
      if (to !== undefined) event.preventDefault();
      return;
    }
    event.preventDefault();
    this.index = to;
    /*
     * Onto the same control the reader was already on — moving down a list of task rows from
     * the checkbox column has to stay in the checkbox column, or completing a run of tasks
     * turns into a Tab dance every second row.
     */
    this.column = this.columnOf(rows[from], event.target);
    this.refresh();
    this.focusRow(to, this.column);
  }

  private focusRow(at: number, column = 0): boolean {
    const controls = this.controlsOf(this.rows()[at]);
    const target = controls[Math.min(column, controls.length - 1)] ?? controls[0];
    if (target === undefined) return false;
    target.focus();
    return true;
  }

  /** One row in the tab order, the rest reachable only by arrow. */
  private markTabStops(rows: readonly HTMLElement[]): void {
    for (const [at, row] of rows.entries()) {
      for (const control of this.controlsOf(row)) {
        control.setAttribute("tabindex", at === this.index ? "0" : "-1");
      }
    }
  }

  private rows(): readonly HTMLElement[] {
    return Array.from(this.container.querySelectorAll<HTMLElement>(this.options.rows));
  }

  /**
   * What the keyboard can land on within a row. A row that holds nothing matching is its own
   * control, which is what lets one list mix plain rows with composite ones — the Views
   * section stacks single-button view rows above two-control task rows.
   */
  private controlsOf(row: HTMLElement | undefined): readonly HTMLElement[] {
    if (row === undefined) return [];
    const selector = this.options.controls;
    if (selector === undefined) return [row];
    const inside = Array.from(row.querySelectorAll<HTMLElement>(selector));
    return inside.length === 0 ? [row] : inside;
  }

  private rowIndexOf(target: EventTarget | null): number | undefined {
    if (!(target instanceof Element)) return undefined;
    const row = target.closest<HTMLElement>(this.options.rows);
    if (row === null || !this.container.contains(row)) return undefined;
    const at = this.rows().indexOf(row);
    return at === -1 ? undefined : at;
  }

  private columnOf(row: HTMLElement | undefined, target: EventTarget | null): number {
    if (!(target instanceof HTMLElement)) return 0;
    const at = this.controlsOf(row).indexOf(target);
    return at === -1 ? 0 : at;
  }
}
