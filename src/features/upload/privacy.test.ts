import { describe, expect, it } from 'vitest';
import exifr from 'exifr';
import { readMvhdCreationTime, stripImageGps, stripMoovLocation, processVideo } from './privacy';
import { sniffMime } from './fileTypes';

/** GPS と撮影日時を含む最小の TIFF (リトルエンディアン) を作る */
function buildTiff(): Uint8Array {
  const buf = new Uint8Array(200);
  const v = new DataView(buf.buffer);
  buf.set([0x49, 0x49], 0); // II
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true); // IFD0 at 8
  // IFD0: 2 entries
  v.setUint16(8, 2, true);
  // Orientation (0x0112) SHORT 1 = 6
  v.setUint16(10, 0x0112, true);
  v.setUint16(12, 3, true);
  v.setUint32(14, 1, true);
  v.setUint16(18, 6, true);
  // GPS IFD pointer (0x8825) LONG -> 38
  v.setUint16(22, 0x8825, true);
  v.setUint16(24, 4, true);
  v.setUint32(26, 1, true);
  v.setUint32(30, 38, true);
  v.setUint32(34, 0, true); // next IFD
  // GPS IFD at 38: 2 entries
  v.setUint16(38, 2, true);
  // GPSLatitudeRef (1) ASCII 2 'N\0'
  v.setUint16(40, 1, true);
  v.setUint16(42, 2, true);
  v.setUint32(44, 2, true);
  buf.set([0x4e, 0], 48);
  // GPSLatitude (2) RATIONAL 3 -> offset 70
  v.setUint16(52, 2, true);
  v.setUint16(54, 5, true);
  v.setUint32(56, 3, true);
  v.setUint32(60, 70, true);
  v.setUint32(64, 0, true); // next IFD
  const rationals = [35, 1, 41, 1, 2200, 100];
  rationals.forEach((n, i) => v.setUint32(70 + i * 4, n, true));
  return buf.subarray(0, 94);
}

function buildJpeg(tiff: Uint8Array): Uint8Array {
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const len = 2 + exifHeader.length + tiff.length;
  const out = new Uint8Array(4 + len + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff], 0);
  out.set(exifHeader, 6);
  out.set(tiff, 12);
  out.set([0xff, 0xd9], 12 + tiff.length);
  return out;
}

describe('stripImageGps', () => {
  it('removes GPS from JPEG EXIF but keeps other tags', async () => {
    const jpeg = buildJpeg(buildTiff());
    const before = await exifr.parse(jpeg.slice(), { gps: true, tiff: true });
    expect(before.GPSLatitude).toEqual([35, 41, 22]);

    const changed = stripImageGps(jpeg, 'image/jpeg');
    expect(changed).toBe(true);

    const after = await exifr.parse(jpeg.slice(), { gps: true, tiff: true });
    expect(after?.latitude).toBeUndefined();
    expect(after?.GPSLatitude).toBeUndefined();
    expect(after?.Orientation).toBeDefined();
    // 元の座標 (35, 41, 22) のバイト列がファイル内に残っていないこと
    const v = new DataView(jpeg.buffer);
    let found = false;
    for (let i = 0; i + 4 <= jpeg.length; i++) if (v.getUint32(i, true) === 2200) found = true;
    expect(found).toBe(false);
  });

  it('removes GPS from HEIC-like containers via Exif marker', () => {
    const tiff = buildTiff();
    const heic = new Uint8Array(32 + 6 + tiff.length);
    heic.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0); // ....ftypheic
    heic.set([0x45, 0x78, 0x69, 0x66, 0, 0], 32);
    heic.set(tiff, 38);
    expect(stripImageGps(heic, 'image/heic')).toBe(true);
    expect(new DataView(heic.buffer).getUint16(38 + 38, true)).toBe(0); // GPS entries = 0
  });

  it('blanks GPS in JPEG XMP', () => {
    const ns = 'http://ns.adobe.com/xap/1.0/\0';
    const xmp = ns + '<x:xmpmeta><rdf:Description exif:GPSLatitude="35,41.37N" exif:GPSLongitude="139,41.5E"/></x:xmpmeta>';
    const bytes = new TextEncoder().encode(xmp);
    const len = bytes.length + 2;
    const jpeg = new Uint8Array(4 + bytes.length + 2 + 2);
    jpeg.set([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff], 0);
    jpeg.set(bytes, 6);
    jpeg.set([0xff, 0xd9], 6 + bytes.length);
    expect(stripImageGps(jpeg, 'image/jpeg')).toBe(true);
    const text = new TextDecoder().decode(jpeg);
    expect(text).not.toContain('35,41.37N');
    expect(text).not.toContain('139,41.5E');
    expect(text).toContain('exif:GPSLatitude="');
  });

  it('returns false when there is no GPS', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(stripImageGps(jpeg, 'image/jpeg')).toBe(false);
  });
});

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('video location', () => {
  const coord = '+35.6895+139.6917+040.000/';
  const xyzPayload = concat(new Uint8Array([0, coord.length, 0x15, 0xc7]), new TextEncoder().encode(coord));
  const xyz = (() => {
    const b = box('xxxx', xyzPayload);
    b.set([0xa9, 0x78, 0x79, 0x7a], 4);
    return b;
  })();
  const mvhdPayload = new Uint8Array(100);
  // version 0, creation_time = 2024-01-01T00:00:00Z
  new DataView(mvhdPayload.buffer).setUint32(4, Date.UTC(2024, 0, 1) / 1000 + 2082844800);
  const moov = box('moov', concat(box('mvhd', mvhdPayload), box('udta', xyz)));

  it('reads creation time and blanks ©xyz', () => {
    const m = moov.slice();
    expect(readMvhdCreationTime(m)?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(stripMoovLocation(m)).toBe(true);
    expect(new TextDecoder().decode(m)).not.toContain('35.6895');
  });

  it('blanks Apple ISO6709 location metadata', () => {
    const keys = new TextEncoder().encode('mdtacom.apple.quicktime.location.ISO6709');
    const data = new TextEncoder().encode('data\0\0\0\x01\0\0\0\0' + coord);
    const m = box('moov', concat(box('keys', keys), box('ilst', data)));
    expect(stripMoovLocation(m)).toBe(true);
    expect(new TextDecoder().decode(m)).not.toContain('139.6917');
  });

  it('processVideo patches only the moov box', async () => {
    const ftyp = box('ftyp', new TextEncoder().encode('qt  \0\0\0\0'));
    const mdat = box('mdat', new Uint8Array(1000).fill(7));
    const file = new Blob([ftyp as BlobPart, mdat as BlobPart, moov as BlobPart], { type: 'video/quicktime' });
    const res = await processVideo(file, 'video/quicktime');
    expect(res.locationStripped).toBe(true);
    expect(res.blob.size).toBe(file.size);
    expect(res.takenAt?.getUTCFullYear()).toBe(2024);
    const out = new Uint8Array(await res.blob.arrayBuffer());
    expect(new TextDecoder().decode(out)).not.toContain('35.6895');
    expect(out.subarray(ftyp.length + 8, ftyp.length + 16).every((b) => b === 7)).toBe(true);
  });
});

describe('sniffMime', () => {
  it('detects common formats', () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(sniffMime(heic)).toBe('image/heic');
    const mov = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
    expect(sniffMime(mov)).toBe('video/quicktime');
    expect(sniffMime(new TextEncoder().encode('#!/bin/sh\necho'))).toBeNull();
  });
});
