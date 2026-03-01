type OverlayPoint = {
  x: number;
  y: number;
};

type OverlayLineInput = {
  id: string;
  visible: boolean;
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
};

type OverlayNoteInput = {
  id: string;
  visible: boolean;
  time: number;
  price: number;
};

export type DrawingShapeHitKind = 'trendline' | 'ray' | 'rectangle' | 'note';

export type DrawingShapeHit = {
  id: string;
  kind: DrawingShapeHitKind;
  distance: number;
  score: number;
};

type FindProjectedDrawingHitArgs = {
  x: number;
  y: number;
  selectedDrawingId: string | null;
  trendlines: OverlayLineInput[];
  rays: OverlayLineInput[];
  rectangles: OverlayLineInput[];
  notes: OverlayNoteInput[];
  hitTolerancePx: number;
  noteHitRadiusPx: number;
  coordinateAbsLimit: number;
  project: (time: number, price: number) => OverlayPoint | null;
  onGuardMessage?: (message: string) => void;
};

const SELECTED_SHAPE_SCORE_BONUS = 0.75;
const MIN_SEGMENT_LENGTH_SQUARED = 1e-9;
const MAX_GUARD_MESSAGES = 8;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampCoordinate(value: number, maxAbs: number) {
  return Math.min(maxAbs, Math.max(-maxAbs, value));
}

function normalizeShapeId(id: string) {
  const normalized = id.trim();
  return normalized.length > 0 ? normalized : null;
}

function pointDistance(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (!isFiniteNumber(lengthSquared) || lengthSquared <= MIN_SEGMENT_LENGTH_SQUARED) {
    return pointDistance(px, py, x1, y1);
  }

  const projected = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, projected));
  const nearestX = x1 + dx * t;
  const nearestY = y1 + dy * t;
  return pointDistance(px, py, nearestX, nearestY);
}

function distanceToRay(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  if (!isFiniteNumber(lengthSquared) || lengthSquared <= MIN_SEGMENT_LENGTH_SQUARED) {
    return pointDistance(px, py, x1, y1);
  }

  const projected = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  const t = Math.max(0, projected);
  const nearestX = x1 + dx * t;
  const nearestY = y1 + dy * t;
  return pointDistance(px, py, nearestX, nearestY);
}

function projectPointSafely(
  project: (time: number, price: number) => OverlayPoint | null,
  time: number,
  price: number,
  maxAbs: number,
): OverlayPoint | null {
  if (!isFiniteNumber(time) || !isFiniteNumber(price)) return null;

  let point: OverlayPoint | null = null;
  try {
    point = project(time, price);
  } catch {
    return null;
  }
  if (!point) return null;

  const x = isFiniteNumber(point.x) ? clampCoordinate(point.x, maxAbs) : null;
  const y = isFiniteNumber(point.y) ? clampCoordinate(point.y, maxAbs) : null;
  if (x === null || y === null) return null;

  return { x, y };
}

export function findProjectedDrawingHit(args: FindProjectedDrawingHitArgs): DrawingShapeHit | null {
  if (!isFiniteNumber(args.x) || !isFiniteNumber(args.y)) return null;

  const safeTolerance = isFiniteNumber(args.hitTolerancePx) ? Math.max(0, args.hitTolerancePx) : 0;
  const safeNoteRadius = isFiniteNumber(args.noteHitRadiusPx) ? Math.max(0, args.noteHitRadiusPx) : 0;
  const safeAbsLimit = isFiniteNumber(args.coordinateAbsLimit) ? Math.max(1, args.coordinateAbsLimit) : 1;
  const selectedId = args.selectedDrawingId?.trim() || null;

  let guardMessageCount = 0;
  const reportGuard = (message: string) => {
    if (!args.onGuardMessage || guardMessageCount >= MAX_GUARD_MESSAGES) return;
    guardMessageCount += 1;
    args.onGuardMessage(message);
  };

  let best: DrawingShapeHit | null = null;
  const upsertHit = (id: string, kind: DrawingShapeHitKind, distance: number, maxDistance: number) => {
    if (!isFiniteNumber(distance) || distance > maxDistance) return;
    const score = distance + (id === selectedId ? -SELECTED_SHAPE_SCORE_BONUS : 0);
    if (!best || score < best.score) {
      best = {
        id,
        kind,
        distance,
        score,
      };
    }
  };

  const toProjectedPoint = (id: string, kind: DrawingShapeHitKind, time: number, price: number) => {
    const point = projectPointSafely(args.project, time, price, safeAbsLimit);
    if (!point) {
      reportGuard(`${kind}:${id} projection skipped`);
      return null;
    }
    return point;
  };

  for (const line of args.trendlines) {
    if (!line.visible) continue;
    const id = normalizeShapeId(line.id);
    if (!id) {
      reportGuard('trendline:invalid-id skipped');
      continue;
    }

    const start = toProjectedPoint(id, 'trendline', line.startTime, line.startPrice);
    const end = toProjectedPoint(id, 'trendline', line.endTime, line.endPrice);
    if (!start || !end) continue;

    upsertHit(id, 'trendline', distanceToSegment(args.x, args.y, start.x, start.y, end.x, end.y), safeTolerance);
  }

  for (const line of args.rays) {
    if (!line.visible) continue;
    const id = normalizeShapeId(line.id);
    if (!id) {
      reportGuard('ray:invalid-id skipped');
      continue;
    }

    const start = toProjectedPoint(id, 'ray', line.startTime, line.startPrice);
    const end = toProjectedPoint(id, 'ray', line.endTime, line.endPrice);
    if (!start || !end) continue;

    upsertHit(id, 'ray', distanceToRay(args.x, args.y, start.x, start.y, end.x, end.y), safeTolerance);
  }

  for (const shape of args.rectangles) {
    if (!shape.visible) continue;
    const id = normalizeShapeId(shape.id);
    if (!id) {
      reportGuard('rectangle:invalid-id skipped');
      continue;
    }

    const start = toProjectedPoint(id, 'rectangle', shape.startTime, shape.startPrice);
    const end = toProjectedPoint(id, 'rectangle', shape.endTime, shape.endPrice);
    if (!start || !end) continue;

    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    if (!isFiniteNumber(left) || !isFiniteNumber(right) || !isFiniteNumber(top) || !isFiniteNumber(bottom)) {
      reportGuard(`rectangle:${id} bounds skipped`);
      continue;
    }

    const withinX = args.x >= left - safeTolerance && args.x <= right + safeTolerance;
    const withinY = args.y >= top - safeTolerance && args.y <= bottom + safeTolerance;
    if (!withinX || !withinY) continue;

    const edgeDistance = Math.min(
      Math.abs(args.x - left),
      Math.abs(args.x - right),
      Math.abs(args.y - top),
      Math.abs(args.y - bottom),
    );
    upsertHit(id, 'rectangle', edgeDistance, safeTolerance);
  }

  for (const note of args.notes) {
    if (!note.visible) continue;
    const id = normalizeShapeId(note.id);
    if (!id) {
      reportGuard('note:invalid-id skipped');
      continue;
    }

    const point = toProjectedPoint(id, 'note', note.time, note.price);
    if (!point) continue;

    upsertHit(id, 'note', pointDistance(args.x, args.y, point.x, point.y), safeNoteRadius);
  }

  return best;
}
