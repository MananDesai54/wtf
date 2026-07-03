import { describe, it, expect } from 'vitest';
import { parseDataUri } from '../src/data-uri.js';

describe('parseDataUri', () => {
  it('parses plain base64 image URIs', () => {
    expect(parseDataUri('data:image/png;base64,QUJD')).toEqual({ mime: 'image/png', base64: 'QUJD' });
  });
  it('parses parameterized mimes', () => {
    expect(parseDataUri('data:text/plain;charset=utf-8;base64,QUJD')).toEqual({ mime: 'text/plain', base64: 'QUJD' });
  });
  it('encodes non-base64 URI payloads', () => {
    const r = parseDataUri('data:image/svg+xml,%3Csvg%3E%3C/svg%3E');
    expect(r?.mime).toBe('image/svg+xml');
    expect(Buffer.from(r!.base64, 'base64').toString()).toBe('<svg></svg>');
  });
  it('returns null for non-data strings', () => {
    expect(parseDataUri('data;nope')).toBeNull();
  });
});
