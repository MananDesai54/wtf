import { describe, it, expect } from 'vitest';
import { fontStyleForWeight, solidPaint } from '../src/dom-render.js';

describe('fontStyleForWeight', () => {
  it('maps <600 to Regular, >=600 to Bold', () => {
    expect(fontStyleForWeight(400)).toBe('Regular');
    expect(fontStyleForWeight(599)).toBe('Regular');
    expect(fontStyleForWeight(600)).toBe('Bold');
    expect(fontStyleForWeight(900)).toBe('Bold');
  });
});

describe('solidPaint', () => {
  it('splits alpha into opacity', () => {
    expect(solidPaint({ r: 0.1, g: 0.2, b: 0.3, a: 0.5 })).toEqual({
      type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 0.5,
    });
  });
});
