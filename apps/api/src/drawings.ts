export type DrawingLine = {
  id: string;
  price: number;
};

export type HorizontalDrawing = {
  id: string;
  type: 'horizontal';
  price: number;
};

export type VerticalDrawing = {
  id: string;
  type: 'vertical';
  time: number;
};

export type TrendlineDrawing = {
  id: string;
  type: 'trendline';
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
};

export type RayDrawing = {
  id: string;
  type: 'ray';
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
};

export type RectangleDrawing = {
  id: string;
  type: 'rectangle';
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
};

export type NoteDrawing = {
  id: string;
  type: 'note';
  time: number;
  price: number;
  text: string;
};

export type DrawingItem =
  | HorizontalDrawing
  | VerticalDrawing
  | TrendlineDrawing
  | RayDrawing
  | RectangleDrawing
  | NoteDrawing;

export type DrawingInputItem =
  | { id?: string; type: 'horizontal'; price: number }
  | { id?: string; type: 'vertical'; time: number }
  | {
      id?: string;
      type: 'trendline';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
    }
  | {
      id?: string;
      type: 'ray';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
    }
  | {
      id?: string;
      type: 'rectangle';
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
    }
  | { id?: string; type: 'note'; time: number; price: number; text: string };

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

export function normalizeDrawingLines(lines: Array<{ id?: string; price: number }>): DrawingItem[] {
  return lines.map((line) => ({
    id: line.id?.trim() || createDrawingLineId(),
    type: 'horizontal',
    price: line.price,
  }));
}

export function normalizeDrawingItems(drawings: DrawingInputItem[]): DrawingItem[] {
  return drawings.map((drawing) => {
    if (drawing.type === 'horizontal') {
      return {
        id: drawing.id?.trim() || createDrawingLineId(),
        type: 'horizontal',
        price: drawing.price,
      };
    }

    if (drawing.type === 'vertical') {
      return {
        id: drawing.id?.trim() || createDrawingVerticalId(),
        type: 'vertical',
        time: drawing.time,
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
      };
    }

    return {
      id: drawing.id?.trim() || createDrawingNoteId(),
      type: 'note',
      time: drawing.time,
      price: drawing.price,
      text: drawing.text.trim(),
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
