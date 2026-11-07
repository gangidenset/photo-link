import { describe, expect, it } from 'vitest';
import { uniqueNames, zipNameFor } from './bulkDownload';
import type { Photo } from '@/types/db';

const photo = (id: string, name: string, path = `a/${id}/original.jpg`) =>
  ({ id, original_filename: name, storage_path: path }) as Photo;

describe('uniqueNames', () => {
  it('numbers duplicate file names (case-insensitive) and keeps extensions', () => {
    expect(
      uniqueNames([photo('1', 'IMG_0001.JPG'), photo('2', 'img_0001.jpg'), photo('3', 'IMG_0001.HEIC', 'a/3/original.heic'), photo('4', 'IMG_0001.JPG')]),
    ).toEqual(['IMG_0001.jpg', 'img_0001 (2).jpg', 'IMG_0001.heic', 'IMG_0001 (3).jpg']);
  });

  it('falls back to an id-based name and strips unsafe characters', () => {
    expect(uniqueNames([photo('abcdef1234', ''), photo('2', 'a/b:c.jpg')])).toEqual(['photolink-abcdef12.jpg', 'a_b_c.jpg']);
  });
});

describe('zipNameFor', () => {
  it('uses the album title and date', () => {
    expect(zipNameFor('仙台/旅行')).toMatch(/^仙台_旅行_\d{8}\.zip$/);
  });
});
