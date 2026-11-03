import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom does not implement matchMedia, and anything reading the colour-scheme
 * preference needs it. Default to light; tests that care about the OS setting
 * stub their own via vi.stubGlobal.
 */
function installMatchMediaStub() {
  // Installed unconditionally: `restoreMocks` and per-file global stubbing can
  // otherwise leave it missing for the next test.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  installMatchMediaStub();
});

afterEach(() => {
  cleanup();
  // Leave no theme attribute behind for the next test to inherit.
  delete document.documentElement.dataset.theme;
});
