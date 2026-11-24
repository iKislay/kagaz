import { describe, expect, it } from 'vitest';
import { withoutSignedUrls } from './idempotency.interceptor.js';

describe('withoutSignedUrls (security review L2)', () => {
  it('nulls signed URL fields at any depth and keeps everything else', () => {
    const body = {
      orderId: 'o1',
      previewUrl: 'https://s3/x?X-Amz-Signature=abc',
      nested: { downloadUrl: 'https://s3/y?X-Amz-Signature=def', keep: 'yes' },
      list: [{ uploadUrl: 'https://s3/z' }, { previewUrl: null }],
    };
    expect(withoutSignedUrls(body)).toEqual({
      orderId: 'o1',
      previewUrl: null,
      nested: { downloadUrl: null, keep: 'yes' },
      list: [{ uploadUrl: null }, { previewUrl: null }],
    });
    expect(JSON.stringify(withoutSignedUrls(body))).not.toContain('Signature');
  });

  it('passes primitives through', () => {
    expect(withoutSignedUrls(null)).toBeNull();
    expect(withoutSignedUrls('x')).toBe('x');
    expect(withoutSignedUrls(3)).toBe(3);
  });
});
