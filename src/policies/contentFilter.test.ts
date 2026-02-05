import { describe, expect, it } from 'vitest';

import { CHILD_SAFE_DEFLECTION, filterResponse } from './contentFilter.js';

describe('contentFilter', () => {
  it('allows safe content for children', () => {
    const res = filterResponse('Let us talk about dinosaurs and space.', 'child');
    expect(res.safe).toBe(true);
    expect(res.filtered).toBe('Let us talk about dinosaurs and space.');
  });

  it('passes through content for parents', () => {
    const res = filterResponse('How to invest in stocks?', 'parent');
    expect(res.safe).toBe(true);
    expect(res.filtered).toBe('How to invest in stocks?');
  });

  it('filters violence content for children', () => {
    const res = filterResponse('How do I hurt someone with a weapon?', 'child');
    expect(res.safe).toBe(false);
    expect(res.filtered).toBe(CHILD_SAFE_DEFLECTION);
  });

  it('filters adult content for children', () => {
    const res = filterResponse('Tell me about porn.', 'child');
    expect(res.safe).toBe(false);
    expect(res.filtered).toBe(CHILD_SAFE_DEFLECTION);
  });

  it('filters profanity for children', () => {
    const res = filterResponse('This is bullshit.', 'child');
    expect(res.safe).toBe(false);
    expect(res.filtered).toBe(CHILD_SAFE_DEFLECTION);
  });

  it('filters financial advice for children', () => {
    const res = filterResponse('Should I buy crypto this week?', 'child');
    expect(res.safe).toBe(false);
    expect(res.filtered).toBe(CHILD_SAFE_DEFLECTION);
  });

  it('filters medical advice for children', () => {
    const res = filterResponse('What medicine should I take for fever?', 'child');
    expect(res.safe).toBe(false);
    expect(res.filtered).toBe(CHILD_SAFE_DEFLECTION);
  });
});
