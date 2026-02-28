import { describe, expect, it } from 'vitest';
import { getFavoriteIntervalHotkeyIndex, isTypingInputTarget } from './hotkeys';

const baseEvent = {
  key: '1',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
};

describe('hotkey helpers', () => {
  it('identifies typing focus targets', () => {
    expect(isTypingInputTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingInputTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingInputTarget({ tagName: 'div', isContentEditable: true })).toBe(true);
    expect(isTypingInputTarget({ tagName: 'button' })).toBe(false);
  });

  it('does not map favorite hotkeys while typing in inputs', () => {
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, target: { tagName: 'INPUT' } }, 3)).toBeNull();
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, target: { tagName: 'TEXTAREA' } }, 3)).toBeNull();
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, target: { tagName: 'DIV', isContentEditable: true } }, 3)).toBeNull();
  });

  it('maps number keys to favorite indices when hotkeys are allowed', () => {
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, target: { tagName: 'DIV' } }, 3)).toBe(0);
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, key: '3', target: null }, 3)).toBe(2);
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, key: '4', target: null }, 3)).toBeNull();
  });

  it('ignores unsupported keys and modifier-combined keys', () => {
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, key: '0', target: null }, 3)).toBeNull();
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, key: 'a', target: null }, 3)).toBeNull();
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, ctrlKey: true, target: null }, 3)).toBeNull();
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, metaKey: true, target: null }, 3)).toBeNull();
    expect(getFavoriteIntervalHotkeyIndex({ ...baseEvent, altKey: true, target: null }, 3)).toBeNull();
  });
});
