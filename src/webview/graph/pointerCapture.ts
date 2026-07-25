export interface PointerCaptureOwner {
  setPointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
}

export interface CapturedPointer {
  readonly owner: PointerCaptureOwner;
  readonly pointerId: number;
}

export function beginPointerCapture(
  owner: PointerCaptureOwner,
  pointerId: number,
): CapturedPointer {
  owner.setPointerCapture(pointerId);
  return { owner, pointerId };
}

export function endPointerCapture(capture: CapturedPointer): void {
  if (capture.owner.hasPointerCapture(capture.pointerId)) {
    capture.owner.releasePointerCapture(capture.pointerId);
  }
}
