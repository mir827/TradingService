type OverlayPoint = {
  x: number;
  y: number;
};

type OverlayShapeFlags = {
  id: string;
  visible: boolean;
};

type OverlayLineInput = OverlayShapeFlags & {
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
};

type OverlayNoteInput = OverlayShapeFlags & {
  time: number;
  price: number;
  text: string;
};

type OverlayLineGeometry = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type OverlayRectangleGeometry = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
};

type OverlayNoteGeometry = {
  id: string;
  x: number;
  y: number;
  text: string;
};

export type DrawingOverlayGeometry = {
  width: number;
  height: number;
  trendlines: OverlayLineGeometry[];
  rays: OverlayLineGeometry[];
  rectangles: OverlayRectangleGeometry[];
  notes: OverlayNoteGeometry[];
};

type BuildDrawingOverlayGeometryArgs = {
  width: number;
  height: number;
  trendlines: OverlayLineInput[];
  rays: OverlayLineInput[];
  rectangles: OverlayLineInput[];
  notes: OverlayNoteInput[];
  toCoordinate: (time: number, price: number) => OverlayPoint | null;
};

const RAY_EXTENSION_MULTIPLIER = 2;
const COORDINATE_CLAMP_MULTIPLIER = 4;
const MIN_RAY_VECTOR_LENGTH = 1e-6;
const MAX_GUARD_WARNINGS_PER_BUILD = 8;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toViewportDimension(value: number) {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  return Math.floor(value);
}

function clampCoordinate(value: number, maxAbs: number) {
  return Math.min(maxAbs, Math.max(-maxAbs, value));
}

function toSafeCoordinate(value: number, maxAbs: number): number | null {
  if (!isFiniteNumber(value)) return null;
  const clamped = clampCoordinate(value, maxAbs);
  return isFiniteNumber(clamped) ? clamped : null;
}

function toSafeShapeId(id: string): string | null {
  const normalized = id.trim();
  return normalized.length > 0 ? normalized : null;
}

function toSafePoint(point: OverlayPoint | null, maxAbs: number): OverlayPoint | null {
  if (!point) return null;
  const x = toSafeCoordinate(point.x, maxAbs);
  const y = toSafeCoordinate(point.y, maxAbs);
  if (x === null || y === null) return null;
  return {
    x,
    y,
  };
}

function projectPointSafely(
  project: (time: number, price: number) => OverlayPoint | null,
  time: number,
  price: number,
  maxAbs: number,
): OverlayPoint | null {
  if (!isFiniteNumber(time) || !isFiniteNumber(price)) return null;

  try {
    return toSafePoint(project(time, price), maxAbs);
  } catch {
    return null;
  }
}

function toSafeLineGeometry(id: string, start: OverlayPoint, end: OverlayPoint, maxAbs: number): OverlayLineGeometry | null {
  const safeId = toSafeShapeId(id);
  if (!safeId) return null;

  const x1 = toSafeCoordinate(start.x, maxAbs);
  const y1 = toSafeCoordinate(start.y, maxAbs);
  const x2 = toSafeCoordinate(end.x, maxAbs);
  const y2 = toSafeCoordinate(end.y, maxAbs);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

  return {
    id: safeId,
    x1,
    y1,
    x2,
    y2,
  };
}

function toSafeRectangleGeometry(
  id: string,
  start: OverlayPoint,
  end: OverlayPoint,
  maxAbs: number,
): OverlayRectangleGeometry | null {
  const safeId = toSafeShapeId(id);
  if (!safeId) return null;

  const rawX = Math.min(start.x, end.x);
  const rawY = Math.min(start.y, end.y);
  const rawWidth = Math.abs(end.x - start.x);
  const rawHeight = Math.abs(end.y - start.y);
  if (!isFiniteNumber(rawX) || !isFiniteNumber(rawY) || !isFiniteNumber(rawWidth) || !isFiniteNumber(rawHeight)) {
    return null;
  }

  const x = toSafeCoordinate(rawX, maxAbs);
  const y = toSafeCoordinate(rawY, maxAbs);
  const startX = toSafeCoordinate(start.x, maxAbs);
  const startY = toSafeCoordinate(start.y, maxAbs);
  if (x === null || y === null || startX === null || startY === null) return null;

  const maxSpan = maxAbs * 2;
  const width = Math.min(maxSpan, Math.max(0, rawWidth));
  const height = Math.min(maxSpan, Math.max(0, rawHeight));
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;

  return {
    id: safeId,
    x,
    y,
    width,
    height,
    startX,
    startY,
  };
}

function toSafeNoteGeometry(id: string, text: string, point: OverlayPoint, maxAbs: number): OverlayNoteGeometry | null {
  const safeId = toSafeShapeId(id);
  if (!safeId) return null;

  const x = toSafeCoordinate(point.x, maxAbs);
  const y = toSafeCoordinate(point.y, maxAbs);
  if (x === null || y === null) return null;

  return {
    id: safeId,
    x,
    y,
    text,
  };
}

function createEmptyGeometry(width: number, height: number): DrawingOverlayGeometry {
  return {
    width,
    height,
    trendlines: [],
    rays: [],
    rectangles: [],
    notes: [],
  };
}

function createGuardLogger() {
  let count = 0;
  const isVitestRuntime = typeof globalThis === 'object' && '__vitest_worker__' in globalThis;

  return (message: string) => {
    if (isVitestRuntime) return;
    if (count >= MAX_GUARD_WARNINGS_PER_BUILD) return;
    count += 1;
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    console.warn(`[drawingOverlay] ${message}`);
  };
}

export function buildDrawingOverlayGeometry(args: BuildDrawingOverlayGeometryArgs): DrawingOverlayGeometry {
  const width = toViewportDimension(args.width);
  const height = toViewportDimension(args.height);
  if (width <= 0 || height <= 0) {
    return createEmptyGeometry(width, height);
  }

  const coordinateAbsLimit = Math.max(width, height) * COORDINATE_CLAMP_MULTIPLIER;
  if (!isFiniteNumber(coordinateAbsLimit) || coordinateAbsLimit <= 0) {
    return createEmptyGeometry(width, height);
  }
  const logGuard = createGuardLogger();
  const toCoordinate = (time: number, price: number) => projectPointSafely(args.toCoordinate, time, price, coordinateAbsLimit);

  const trendlineShapes: OverlayLineGeometry[] = [];
  for (const shape of args.trendlines) {
    if (!shape.visible) continue;
    const start = toCoordinate(shape.startTime, shape.startPrice);
    const end = toCoordinate(shape.endTime, shape.endPrice);
    if (!start || !end) {
      logGuard(`skip trendline "${shape.id}" due to invalid projected anchor`);
      continue;
    }

    const safeShape = toSafeLineGeometry(shape.id, start, end, coordinateAbsLimit);
    if (!safeShape) {
      logGuard(`skip trendline "${shape.id}" due to invalid geometry`);
      continue;
    }

    trendlineShapes.push(safeShape);
  }

  const rayShapes: OverlayLineGeometry[] = [];
  for (const shape of args.rays) {
    if (!shape.visible) continue;
    const start = toCoordinate(shape.startTime, shape.startPrice);
    const end = toCoordinate(shape.endTime, shape.endPrice);
    if (!start || !end) {
      logGuard(`skip ray "${shape.id}" due to invalid projected anchor`);
      continue;
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!isFiniteNumber(length) || length <= MIN_RAY_VECTOR_LENGTH) {
      logGuard(`skip ray "${shape.id}" due to degenerate vector`);
      continue;
    }

    const extendDistance = Math.max(width, height) * RAY_EXTENSION_MULTIPLIER;
    if (!isFiniteNumber(extendDistance) || extendDistance <= 0) {
      logGuard(`skip ray "${shape.id}" due to invalid extension distance`);
      continue;
    }

    const unitX = dx / length;
    const unitY = dy / length;
    if (!isFiniteNumber(unitX) || !isFiniteNumber(unitY)) {
      logGuard(`skip ray "${shape.id}" due to invalid direction unit vector`);
      continue;
    }

    const safeShape = toSafeLineGeometry(
      shape.id,
      start,
      {
        x: end.x + unitX * extendDistance,
        y: end.y + unitY * extendDistance,
      },
      coordinateAbsLimit,
    );
    if (!safeShape) {
      logGuard(`skip ray "${shape.id}" due to invalid extended geometry`);
      continue;
    }

    rayShapes.push(safeShape);
  }

  const rectangleShapes: OverlayRectangleGeometry[] = [];
  for (const shape of args.rectangles) {
    if (!shape.visible) continue;
    const start = toCoordinate(shape.startTime, shape.startPrice);
    const end = toCoordinate(shape.endTime, shape.endPrice);
    if (!start || !end) {
      logGuard(`skip rectangle "${shape.id}" due to invalid projected anchor`);
      continue;
    }

    const safeShape = toSafeRectangleGeometry(shape.id, start, end, coordinateAbsLimit);
    if (!safeShape) {
      logGuard(`skip rectangle "${shape.id}" due to invalid geometry`);
      continue;
    }

    rectangleShapes.push(safeShape);
  }

  const noteShapes: OverlayNoteGeometry[] = [];
  for (const note of args.notes) {
    if (!note.visible) continue;
    const point = toCoordinate(note.time, note.price);
    if (!point) {
      logGuard(`skip note "${note.id}" due to invalid projected anchor`);
      continue;
    }

    const safeShape = toSafeNoteGeometry(note.id, note.text, point, coordinateAbsLimit);
    if (!safeShape) {
      logGuard(`skip note "${note.id}" due to invalid geometry`);
      continue;
    }

    noteShapes.push(safeShape);
  }

  return {
    width,
    height,
    trendlines: trendlineShapes,
    rays: rayShapes,
    rectangles: rectangleShapes,
    notes: noteShapes,
  };
}
