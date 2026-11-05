import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { parsePage } from './pagination.ts';

function fakeRequest(page: unknown): Request {
  return { query: { page } } as unknown as Request;
}

test('parsePage defaults to 1 when page is missing', () => {
  assert.equal(parsePage(fakeRequest(undefined)), 1);
});

test('parsePage parses a valid numeric string', () => {
  assert.equal(parsePage(fakeRequest('3')), 3);
});

test('parsePage clamps zero and negative values to 1', () => {
  assert.equal(parsePage(fakeRequest('0')), 1);
  assert.equal(parsePage(fakeRequest('-5')), 1);
});

test('parsePage clamps non-numeric input to 1', () => {
  assert.equal(parsePage(fakeRequest('abc')), 1);
});
