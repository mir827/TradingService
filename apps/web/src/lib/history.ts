export type HistoryTransition<T> = {
  before: T;
  after: T;
};

export type UndoRedoState = {
  limit: number;
  undoCount: number;
  redoCount: number;
  canUndo: boolean;
  canRedo: boolean;
};

export type UndoRedoHistory<T> = {
  push: (transition: HistoryTransition<T>) => UndoRedoState;
  undo: () => HistoryTransition<T> | null;
  redo: () => HistoryTransition<T> | null;
  clear: () => UndoRedoState;
  getState: () => UndoRedoState;
};

const DEFAULT_HISTORY_LIMIT = 100;
const MIN_HISTORY_LIMIT = 50;

function cloneSnapshot<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneTransition<T>(transition: HistoryTransition<T>): HistoryTransition<T> {
  return {
    before: cloneSnapshot(transition.before),
    after: cloneSnapshot(transition.after),
  };
}

function normalizeLimit(limit?: number) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.max(MIN_HISTORY_LIMIT, Math.floor(limit));
}

export function createUndoRedoHistory<T>(options?: { limit?: number }): UndoRedoHistory<T> {
  const limit = normalizeLimit(options?.limit);
  const undoStack: HistoryTransition<T>[] = [];
  const redoStack: HistoryTransition<T>[] = [];

  const getState = (): UndoRedoState => ({
    limit,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  });

  return {
    push: (transition) => {
      undoStack.push(cloneTransition(transition));
      if (undoStack.length > limit) {
        undoStack.shift();
      }
      if (redoStack.length > 0) {
        redoStack.length = 0;
      }
      return getState();
    },
    undo: () => {
      const transition = undoStack.pop();
      if (!transition) {
        return null;
      }
      redoStack.push(transition);
      return cloneTransition(transition);
    },
    redo: () => {
      const transition = redoStack.pop();
      if (!transition) {
        return null;
      }
      undoStack.push(transition);
      return cloneTransition(transition);
    },
    clear: () => {
      undoStack.length = 0;
      redoStack.length = 0;
      return getState();
    },
    getState,
  };
}
