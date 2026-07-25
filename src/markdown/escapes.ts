export function isEscapedAt(source: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
