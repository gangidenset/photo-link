// エラーを日本語の分かりやすいメッセージに変換する

const MESSAGES: Record<string, string> = {
  // 認証
  'Invalid login credentials': 'メールアドレスまたはパスワードが正しくありません。',
  'Email not confirmed': 'メールアドレスの確認が完了していません。届いたメールのリンクを開いてください。',
  'User already registered': 'このメールアドレスは既に登録されています。',
  'Password should be at least 6 characters': 'パスワードは 8 文字以上にしてください。',
  'New password should be different from the old password.': '新しいパスワードは以前と異なるものにしてください。',
  'Email rate limit exceeded': 'メールの送信回数が上限に達しました。1 時間ほど待ってから再度お試しいただくか、Google でログインしてください。',
  'For security purposes, you can only request this after': 'セキュリティのため、少し時間をおいてから再度お試しください。',
  not_authenticated: 'ログインが必要です。もう一度ログインしてください。',
  // 権限・業務エラー
  forbidden: 'この操作を行う権限がありません。',
  rate_limited: '操作が多すぎます。しばらく待ってから再度お試しください。',
  album_limit_reached: '現在のプランで作成できるアルバム数の上限に達しました。',
  invalid_cover_photo: 'カバーに設定できない写真です。',
  owner_cannot_leave: 'オーナーはアルバムを退会できません。アルバムを削除してください。',
  invitation_not_found: '招待が見つかりません。URL またはコードをご確認ください。',
  invitation_revoked: 'この招待は無効化されています。',
  invitation_expired: 'この招待の有効期限が切れています。',
  invitation_used_up: 'この招待は利用回数の上限に達しています。',
  already_decided: 'このリクエストは既に処理されています。',
  member_not_found: 'メンバーが見つかりません。',
  duplicate: '同じ写真が既にアルバムにあります。',
  unsupported_type: '対応していないファイル形式です。',
  invalid_size: 'ファイルサイズが不正です。',
  file_too_large: 'ファイルサイズが上限を超えています。',
  video_too_long: '動画の長さが上限を超えています。',
  storage_quota_exceeded: 'ストレージ容量の上限に達しました。',
  file_not_uploaded: 'ファイルのアップロードが完了していません。再試行してください。',
  mime_mismatch: 'ファイルの種類が一致しません。',
  photo_not_found: '写真が見つかりません。',
  'Failed to fetch': '通信できませんでした。電波の良い場所で再度お試しください。',
  'Load failed': '通信できませんでした。電波の良い場所で再度お試しください。',
  'NetworkError when attempting to fetch resource.': '通信できませんでした。電波の良い場所で再度お試しください。',
};

export function errorCode(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

// 大文字小文字の違い (Supabase は "email rate limit exceeded" のように小文字で返すことがある) を吸収
const MESSAGES_LOWER = new Map(Object.entries(MESSAGES).map(([k, v]) => [k.toLowerCase(), v]));

export function toMessage(err: unknown): string {
  const code = errorCode(err);
  const lower = code.toLowerCase();
  const exact = MESSAGES[code] ?? MESSAGES_LOWER.get(lower);
  if (exact) return exact;
  // 「For security purposes, you can only request this after 30 seconds.」のように後ろに数字が付くもの
  for (const [k, v] of MESSAGES_LOWER) if (k.length > 20 && lower.startsWith(k)) return v;
  return code ? `エラーが発生しました: ${code}` : 'エラーが発生しました。';
}

/** 通信エラーかどうか (自動再試行の判定に使用) */
export function isNetworkError(err: unknown): boolean {
  const code = errorCode(err).toLowerCase();
  return (
    code.includes('failed to fetch') ||
    code.includes('load failed') ||
    code.includes('network') ||
    code.includes('timeout') ||
    code.includes('xhr') ||
    code.includes('status: 0') ||
    code.includes('502') ||
    code.includes('503') ||
    code.includes('504')
  );
}
