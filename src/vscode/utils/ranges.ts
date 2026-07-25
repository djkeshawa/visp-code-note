import * as vscode from "vscode";
import type { OffsetRange } from "../../domain/models";

export class TextRangeMapper {
  private readonly lineStarts = [0];

  constructor(private readonly text: string) {
    for (let offset = 0; offset < text.length; offset += 1) {
      if (text.charCodeAt(offset) === 10) {
        this.lineStarts.push(offset + 1);
      }
    }
  }

  range(offsetRange: OffsetRange): vscode.Range {
    return new vscode.Range(this.position(offsetRange.start), this.position(offsetRange.end));
  }

  private position(offset: number): vscode.Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.lineStarts[middle] ?? 0) <= clamped) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const line = Math.max(0, low - 1);
    return new vscode.Position(line, clamped - (this.lineStarts[line] ?? 0));
  }
}

export function documentRange(document: vscode.TextDocument, range: OffsetRange): vscode.Range {
  return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
}
