import type { DomRGBA } from './validate.js';

export function fontStyleForWeight(weight: number): 'Regular' | 'Bold' {
  return weight >= 600 ? 'Bold' : 'Regular';
}

export function solidPaint(c: DomRGBA): { type: 'SOLID'; color: { r: number; g: number; b: number }; opacity: number } {
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
}
