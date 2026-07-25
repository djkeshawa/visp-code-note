export type TaskLinePlan =
  | { readonly kind: "toggle"; readonly start: number; readonly end: number; readonly text: " " | "x" }
  | { readonly kind: "convert"; readonly text: string; readonly caretOffset?: number };

export function planTaskLine(line: string, taskId: string): TaskLinePlan {
  const existing = /^(\s*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\])/.exec(line);
  if (existing?.index !== undefined && existing[1] !== undefined && existing[2] !== undefined) {
    const start = existing[1].length;
    return {
      kind: "toggle",
      start,
      end: start + 1,
      text: existing[2].toLocaleLowerCase() === "x" ? " " : "x",
    };
  }

  const list = /^(\s*(?:[-+*]|\d+[.)])\s+)(.*)$/.exec(line);
  const indentation = /^(\s*)/.exec(line)?.[1] ?? "";
  const prefix = list?.[1] ?? `${indentation}- `;
  const content = (list?.[2] ?? line.slice(indentation.length)).trim();
  const base = `${prefix}[ ] `;
  if (content === "") {
    return {
      kind: "convert",
      text: `${base} <!-- task:${taskId} -->`,
      caretOffset: base.length,
    };
  }
  return {
    kind: "convert",
    text: `${base}${content} <!-- task:${taskId} -->`,
  };
}
