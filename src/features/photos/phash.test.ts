import { describe, expect, it } from 'vitest';
import { dhashFromGray, hammingDistance, isSamePhoto } from './phash';

const gradient = (fn: (x: number, y: number) => number) => Array.from({ length: 72 }, (_, i) => fn(i % 9, Math.floor(i / 9)));

describe('dhash', () => {
  it('produces 16 hex chars and reflects brightness direction', () => {
    expect(dhashFromGray(gradient((x) => 255 - x * 20))).toBe('ffffffffffffffff'); // 左ほど明るい
    expect(dhashFromGray(gradient((x) => x * 20))).toBe('0000000000000000'); // 右ほど明るい
  });

  it('is stable under small noise (re-compression) and differs for other images', () => {
    const base = gradient((x, y) => Math.sin(x * 1.3 + y) * 100 + 128);
    const noisy = base.map((v, i) => v + ((i * 7) % 5) - 2); // ±2 の揺らぎ
    const other = gradient((x, y) => Math.cos(x * 0.7 - y * 1.9) * 100 + 128);
    const h = dhashFromGray(base);
    expect(hammingDistance(h, dhashFromGray(noisy))).toBeLessThanOrEqual(6);
    expect(hammingDistance(h, dhashFromGray(other))).toBeGreaterThan(12);
  });
});

describe('isSamePhoto', () => {
  it('requires similar hash and aspect ratio', () => {
    expect(isSamePhoto({ hash: 'ffffffffffffffff', ratio: 1.333 }, { hash: 'fffffffffffffff0', ratio: 1.335 })).toBe(true);
    expect(isSamePhoto({ hash: 'ffffffffffffffff', ratio: 1.333 }, { hash: 'fffffffffffffff0', ratio: 0.75 })).toBe(false);
    expect(isSamePhoto({ hash: 'ffffffffffffffff', ratio: 1 }, { hash: '00000000ffffffff', ratio: 1 })).toBe(false);
    expect(hammingDistance('bad', 'ffffffffffffffff')).toBe(64);
  });
});
