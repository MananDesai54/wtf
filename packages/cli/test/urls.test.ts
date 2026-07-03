import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../src/urls.js';

describe('normalizeUrl', () => {
  it('keeps origin, path, search, hash', () => {
    expect(normalizeUrl('https://a.com/x?b=1#top')).toBe('https://a.com/x?b=1#top');
  });
  it('strips trailing slash on non-root paths', () => {
    expect(normalizeUrl('https://a.com/x/')).toBe('https://a.com/x');
  });
  it('keeps root slash', () => {
    expect(normalizeUrl('https://a.com')).toBe('https://a.com/');
  });
  it('keeps hash for hash routers', () => {
    expect(normalizeUrl('https://a.com/#/settings')).toBe('https://a.com/#/settings');
  });
});
