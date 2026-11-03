import { describe, expect, test } from 'vitest';
import { hasPassed } from './passed';

describe('hasPassed', () => {
  test('is false below the target', () => {
    expect(hasPassed(8, 9)).toBe(false);
  });

  test('is true exactly at the target', () => {
    expect(hasPassed(9, 9)).toBe(true);
  });

  test('is true above the target', () => {
    expect(hasPassed(10, 9)).toBe(true);
  });

  // null means never attempted, which is not the same as scoring zero.
  test('is false when there is no score at all', () => {
    expect(hasPassed(null, 9)).toBe(false);
  });
});
