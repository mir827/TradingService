type HotkeyTargetLike = {
  tagName?: unknown;
  isContentEditable?: unknown;
};

type FavoriteIntervalHotkeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | HotkeyTargetLike | null;
};

function normalizeTargetLike(target: EventTarget | HotkeyTargetLike | null): HotkeyTargetLike | null {
  if (!target || typeof target !== 'object') {
    return null;
  }

  return target as HotkeyTargetLike;
}

export function isTypingInputTarget(target: EventTarget | HotkeyTargetLike | null): boolean {
  const normalized = normalizeTargetLike(target);
  if (!normalized) return false;

  if (normalized.isContentEditable === true) {
    return true;
  }

  const tagName = typeof normalized.tagName === 'string' ? normalized.tagName.toUpperCase() : '';
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function getFavoriteIntervalHotkeyIndex(
  event: FavoriteIntervalHotkeyEvent,
  favoriteCount: number,
): number | null {
  if (favoriteCount <= 0) return null;
  if (isTypingInputTarget(event.target)) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  if (!/^[1-9]$/.test(event.key)) {
    return null;
  }

  const index = Number(event.key) - 1;
  return index < favoriteCount ? index : null;
}
