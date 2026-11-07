import { describe, expect, it } from 'vitest';
import { toMessage } from './errors';

describe('toMessage', () => {
  it('translates Supabase auth errors regardless of letter case', () => {
    expect(toMessage({ message: 'email rate limit exceeded' })).toContain('メールの送信回数が上限');
    expect(toMessage(new Error('Email rate limit exceeded'))).toContain('メールの送信回数が上限');
    expect(toMessage({ message: 'invalid login credentials' })).toBe('メールアドレスまたはパスワードが正しくありません。');
  });

  it('matches messages with a trailing detail', () => {
    expect(toMessage({ message: 'For security purposes, you can only request this after 42 seconds.' })).toContain('少し時間をおいて');
  });

  it('falls back to showing the original message', () => {
    expect(toMessage('something odd')).toBe('エラーが発生しました: something odd');
  });
});
