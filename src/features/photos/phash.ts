// 写真の「見た目の指紋」(dHash)
//   画像を 9x8 の白黒に縮小し、各行で「左の画素が右より明るいか」を 64 ビットにしたもの。
//   形式の変換 (HEIC → JPEG)・再圧縮・縮小ではほぼ同じ値になり、別の写真では大きく異なる。
//   2 つの指紋の違うビット数 (ハミング距離) が小さいほど似ている。

const W = 9;
const H = 8;

/** 9x8 の明るさの配列 (72 個) から指紋 (16 進 16 文字) を作る */
export function dhashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== W * H) throw new Error('invalid_gray_size');
  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      nibble = (nibble << 1) | (gray[y * W + x] > gray[y * W + x + 1] ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

const POPCOUNT = Array.from({ length: 16 }, (_, i) => ((i >> 3) & 1) + ((i >> 2) & 1) + ((i >> 1) & 1) + (i & 1));

/** 違うビット数 (0〜64) */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/** 画像・動画のフレームから指紋を作る (ブラウザのみ) */
export function dhashFromSource(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  return dhashFromGray(gray);
}

/** 同じ写真とみなす条件: 指紋の差が小さく、縦横比もほぼ同じ */
export const MATCH_MAX_DISTANCE = 6;
export function isSamePhoto(a: { hash: string; ratio: number }, b: { hash: string; ratio: number }): boolean {
  if (Math.abs(a.ratio - b.ratio) > 0.04 * Math.max(a.ratio, b.ratio)) return false;
  return hammingDistance(a.hash, b.hash) <= MATCH_MAX_DISTANCE;
}
