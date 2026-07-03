import { describe, it, expect } from 'vitest';
import { ClickTracker, type ClickEvent } from '../src/attribution.js';

const click = (ts: number): ClickEvent => ({
  selector: '#btn', label: 'Go', bbox: { x: 0, y: 0, w: 10, h: 10 }, pageUrl: 'https://a.com/', timestamp: ts,
});

describe('ClickTracker', () => {
  it('attributes a click within the 5s window', () => {
    const t = new ClickTracker();
    t.recordClick(click(1000));
    expect(t.consumeForNavigation(3000)?.label).toBe('Go');
  });

  it('returns null when window exceeded', () => {
    const t = new ClickTracker();
    t.recordClick(click(1000));
    expect(t.consumeForNavigation(6001)).toBeNull();
  });

  it('returns null when navigation precedes click', () => {
    const t = new ClickTracker();
    t.recordClick(click(5000));
    expect(t.consumeForNavigation(4000)).toBeNull();
  });

  it('consumes the click — second navigation gets null', () => {
    const t = new ClickTracker();
    t.recordClick(click(1000));
    t.consumeForNavigation(2000);
    expect(t.consumeForNavigation(2500)).toBeNull();
  });

  it('newer click replaces older', () => {
    const t = new ClickTracker();
    t.recordClick(click(1000));
    t.recordClick({ ...click(2000), label: 'Later' });
    expect(t.consumeForNavigation(2500)?.label).toBe('Later');
  });

  it('attributes a click at exactly the 5s boundary', () => {
    const t = new ClickTracker();
    t.recordClick(click(1000));
    expect(t.consumeForNavigation(6000)?.label).toBe('Go');
  });
});
