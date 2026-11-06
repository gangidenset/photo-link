// 端末・ブラウザの機能判定
// 原則として「端末名」ではなく「機能があるか」で分岐する。
// iOS 判定はホーム画面追加の案内文など、表示の出し分けにのみ使う。

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ は Mac と名乗るため、タッチ対応で判定
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

/** ホーム画面から起動されているか (PWA) */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Web Share API でファイルを共有できるか (iPhone で写真を「保存」する際に使用) */
export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch {
    return false;
  }
}

export function canShareText(): boolean {
  return typeof navigator.share === 'function';
}

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}
