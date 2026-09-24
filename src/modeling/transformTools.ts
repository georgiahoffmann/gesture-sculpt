/**
 * Small, pure transform helpers shared by the interaction layer. Kept
 * separate from `TransformController` (which owns gesture-driven state) so
 * future tools — snapping, numeric input, undo/redo — can reuse the same math
 * without depending on gesture/grab lifecycle code.
 */
export function clampScale(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
