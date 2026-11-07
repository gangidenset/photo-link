import { describe, expect, it } from 'vitest';
import { fitWithin } from './quality';

describe('fitWithin', () => {
  it('scales the long edge down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(8000, 1000, 2048)).toEqual({ width: 2048, height: 256 });
  });

  it('keeps small images as they are', () => {
    expect(fitWithin(1200, 800, 2048)).toEqual({ width: 1200, height: 800 });
  });
});
