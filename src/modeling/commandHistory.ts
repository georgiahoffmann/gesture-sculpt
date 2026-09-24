import type { ModelingCommand } from './modelingCommand';

const MAX_ENTRIES = 60;

/**
 * A single undo/redo stack for EVERY kind of modeling operation — sculpt
 * strokes, height edits, rotation — instead of sculpt strokes having their
 * own private undo while other operations had none. Cmd/Ctrl+Z now undoes
 * "the last thing that happened", full stop, matching Blender's single
 * global undo stack (Cmd/Ctrl+Shift+Z redoes it).
 */
export class CommandHistory {
  private undoStack: ModelingCommand[] = [];
  private redoStack: ModelingCommand[] = [];

  /** Records an already-applied command. Any pending redo is invalidated, same as every undo system. */
  push(command: ModelingCommand): void {
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_ENTRIES) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.redo();
    this.undoStack.push(command);
    return true;
  }

  /** Called whenever the underlying geometry is rebuilt from scratch (reset, resolution change) — old commands reference a mesh that no longer exists. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
