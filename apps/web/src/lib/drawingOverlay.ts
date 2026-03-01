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

function toViewportDimension(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function clampCoordinate(value: number, maxAbs: number) {
  return Math.min(maxAbs, Math.max(-maxAbs, value));
}

function toSafePoint(point: OverlayPoint | null, maxAbs: number): OverlayPoint | null {
  if (!point) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: clampCoordinate(point.x, maxAbs),
    y: clampCoordinate(point.y, maxAbs),
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

export function buildDrawingOverlayGeometry(args: BuildDrawingOverlayGeometryArgs): DrawingOverlayGeometry {
  const width = toViewportDimension(args.width);
  const height = toViewportDimension(args.height);
  if (width <= 0 || height <= 0) {
    return createEmptyGeometry(width, height);
  }

  const coordinateAbsLimit = Math.max(width, height) * COORDINATE_CLAMP_MULTIPLIER;
  const toCoordinate = (time: number, price: number) => toSafePoint(args.toCoordinate(time, price), coordinateAbsLimit);

  const trendlineShapes: OverlayLineGeometry[] = [];
  for (const shape of args.trendlines) {
    if (!shape.visible) continue;
    const start = toCoordinate(shape.startTime, shape.startPrice);
    const end = toCoordinate(shape.endTime, shape.endPrice);
    if (!start || !end) continue;

    trendlineShapes.push({
      id: shape.id,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
    });
  }

  const rayShapes: OverlayLineGeometry[] = [];
  for (const shape of args.rays) {
    if (!shape.visible) continue;
    const start = toCoordinate(shape.startTime, shape.startPrice);
    const end = toCoordinate(shape.endTime, shape.endPrice);
    if (!start || !end) continue;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= MIN_RAY_VECTOR_LENGTH) continue;

    const extendDistance = Math.max(width, height) * RAY_EXTENSION_MULTIPLIER;
    const extendedX2 = clampCoordinate(end.x + (dx / length) * extendDistance, coordinateAbsLimit);
    const extendedY2 = clampCoordinate(end.y + (dy / length) * extendDistance, coordinateAbsLimit);
    if (!Number.isFinite(extendedX2) || !Number.isFinite(extendedY2)) continue;

    rayShapes.push({
      id: shape.id,
      x1: start.x,
      y1: start.y,
      x2: extendedX2,
      y2: extendedY2,
    });
  }

  const rectangleShapes: OverlayRectangleGeometry[] = [];
  for (const shape of args.rectangles) {
    if (!shape.visible) continue;
    const start = toCoordinate(shape.startTime, shape.startPrice);
    const end = toCoordinate(shape.endTime, shape.endPrice);
    if (!start || !end) continue;

    const rectWidth = Math.abs(end.x - start.x);
    const rectHeight = Math.abs(end.y - start.y);
    if (!Number.isFinite(rectWidth) || !Number.isFinite(rectHeight)) continue;

    rectangleShapes.push({
      id: shape.id,
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: rectWidth,
      height: rectHeight,
    });
  }

  const noteShapes: OverlayNoteGeometry[] = [];
  for (const note of args.notes) {
    if (!note.visible) continue;
    const point = toCoordinate(note.time, note.price);
    if (!point) continue;
    noteShapes.push({
      id: note.id,
      x: point.x,
      y: point.y,
      text: note.text,
    });
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
