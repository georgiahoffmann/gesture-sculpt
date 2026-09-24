/**
 * Blender's modal operators apply their effect immediately as they run, then
 * push a single undo step on completion — not "record inputs, replay later".
 * This mirrors that: a ModelingCommand's effect has ALREADY happened by the
 * time it's handed to CommandHistory; `undo`/`redo` just move between the
 * before/after states it captured.
 */
export interface ModelingCommand {
  readonly type: string;
  undo(): void;
  redo(): void;
}
