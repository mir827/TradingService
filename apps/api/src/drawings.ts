export type DrawingLine = {
  id: string;
  price: number;
};

type DrawingFlags = {
  visible: boolean;
  locked: boolean;
};

export type HorizontalDrawing = {
  id: string;
  type: 'horizontal';
  price: number;
} & DrawingFlags;

export type VerticalDrawing = {
  id: string;
  type: 'vertical';
  time: number;
} & DrawingFlags;

export type TrendlineDrawing = {
  id: string;
  type: 'trendline';
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
} & DrawingFlags;

export type RayDrawing = {
  id: string;
  type: 'ray';
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
} & DrawingFlags;

export type RectangleDrawing = {
  id: string;
  type: 'rectangle';
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
} & DrawingFlags;

export type NoteDrawing = {
  id: string;
  type: 'note';
  time: number;
  price: number;
  text: string;
} & DrawingFlags;

export type DrawingItem =
  | HorizontalDrawing
  | VerticalDrawing
  | TrendlineDrawing
  | RayDrawing
  | RectangleDrawing
  | NoteDrawing;

export type DrawingInputItem =
  | { id?: string; type: 'horizontal'; price: number; visible?: boolean; locked?: boolean }
  | { id?: string; type: 'vertical'; time: number; visible?: boolean; locked?: boolean }
  | {
      id?: string;
      type: 'trendline';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible?: boolean;
      locked?: boolean;
    }
  | {
      id?: string;
      type: 'ray';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible?: boolean;
      locked?: boolean;
    }
  | {
      id?: string;
      type: 'rectangle';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      visible?: boolean;
      locked?: boolean;
    }
  | { id?: string; type: 'note'; time: number; price: number; text: string; visible?: boolean; locked?: boolean };

function createDrawingId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDrawingLineId() {
  return createDrawingId('line');
}

export function createDrawingVerticalId() {
  return createDrawingId('vline');
}

export function createDrawingTrendlineId() {
  return createDrawingId('trend');
}

export function createDrawingRayId() {
  return createDrawingId('ray');
}

export function createDrawingRectangleId() {
  return createDrawingId('rect');
}

export function createDrawingNoteId() {
  return createDrawingId('note');
}

function normalizeDrawingFlags(drawing: { visible?: boolean; locked?: boolean }): DrawingFlags {
  return {
    visible: drawing.visible ?? true,
    locked: drawing.locked ?? false,
  };
}

export function normalizeDrawingLines(lines: Array<{ id?: string; price: number }>): DrawingItem[] {
  return lines.map((line) => ({
    id: line.id?.trim() || createDrawingLineId(),
    type: 'horizontal',
    price: line.price,
    visible: true,
    locked: false,
  }));
}

export function normalizeDrawingItems(drawings: DrawingInputItem[]): DrawingItem[] {
  return drawings.map((drawing) => {
    if (drawing.type === 'horizontal') {
      return {
        id: drawing.id?.trim() || createDrawingLineId(),
        type: 'horizontal',
        price: drawing.price,
        ...normalizeDrawingFlags(drawing),
      };
    }

    if (drawing.type === 'vertical') {
      return {
        id: drawing.id?.trim() || createDrawingVerticalId(),
        type: 'vertical',
        time: drawing.time,
        ...normalizeDrawingFlags(drawing),
      };
    }

    if (drawing.type === 'trendline') {
      return {
        id: drawing.id?.trim() || createDrawingTrendlineId(),
        type: 'trendline',
        startTime: drawing.startTime,
        startPrice: drawing.startPrice,
        endTime: drawing.endTime,
        endPrice: drawing.endPrice,
        ...normalizeDrawingFlags(drawing),
      };
    }

    if (drawing.type === 'ray') {
      return {
        id: drawing.id?.trim() || createDrawingRayId(),
        type: 'ray',
        startTime: drawing.startTime,
        startPrice: drawing.startPrice,
        endTime: drawing.endTime,
        endPrice: drawing.endPrice,
        ...normalizeDrawingFlags(drawing),
      };
    }

    if (drawing.type === 'rectangle') {
      return {
        id: drawing.id?.trim() || createDrawingRectangleId(),
        type: 'rectangle',
        startTime: drawing.startTime,
        startPrice: drawing.startPrice,
        endTime: drawing.endTime,
        endPrice: drawing.endPrice,
        ...normalizeDrawingFlags(drawing),
      };
    }

    return {
      id: drawing.id?.trim() || createDrawingNoteId(),
      type: 'note',
      time: drawing.time,
      price: drawing.price,
      text: drawing.text.trim(),
      ...normalizeDrawingFlags(drawing),
    };
  });
}

export function toLegacyDrawingLines(drawings: DrawingItem[]): DrawingLine[] {
  return drawings
    .filter((drawing): drawing is HorizontalDrawing => drawing.type === 'horizontal')
    .map((drawing) => ({
      id: drawing.id,
      price: drawing.price,
    }));
}
