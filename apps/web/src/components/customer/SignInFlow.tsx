'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PhoneSchema } from '@kagaz/shared';
import { Group, Notice, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { normalizeIndianPhone, requestOtp, verifyOtp } from '@/lib/customer-api';

const field =
  'w-full rounded-lg border border-separator bg-surface px-3 py-2.5 text-[17px] outline-none transition-shadow placeholder:text-text-secondary/70 focus:border-accent focus:ring-4 focus:ring-accent/20';

/** Phone + one-time code sign-in (P2.2). Orders stay reachable by tracking link either way. */
export function SignInFlow() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const normalized = normalizeIndianPhone(phoneInput);
    if (!PhoneSchema.safeParse(normalized).success) {
      setError('Enter a 10-digit Indian mobile number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await requestOtp(normalized);
      setPhone(normalized);
      setSentTo(res.sentTo);
      setDemo(res.demo);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone, code);
      // Only same-site relative paths are allowed as a return target.
      router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/orders');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-md">
      <h1 className="mac-title">Sign in</h1>
      <p className="mt-1.5 text-[15px] text-text-secondary">
        Use your mobile number to see all your orders in one place. You can still order without
        signing in — your tracking link always works.
      </p>

      {step === 'phone' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Group title="Mobile number">
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="text-[17px] text-text-secondary">+91</span>
              <input
                className={field}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                aria-label="Mobile number"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
              />
            </div>
          </Group>
          <button type="submit" className="mac-button mt-5 w-full" disabled={busy}>
            {busy && <Spinner />} Send code
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <Group
            title={`Code sent to ${sentTo}`}
            footer={
              demo
                ? 'Demo: no SMS is sent. The code appears in the admin demo page (OTP inbox).'
                : 'The code expires in 5 minutes.'
            }
          >
            <div className="px-4 py-3">
              <input
                className={`${field} text-center font-mono tracking-[0.4em]`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                aria-label="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
          </Group>
          <button
            type="submit"
            className="mac-button mt-5 w-full"
            disabled={busy || code.length !== 6}
          >
            {busy && <Spinner />} Verify and sign in
          </button>
          <button
            type="button"
            className="mt-3 w-full text-[14px] font-semibold text-accent"
            onClick={() => {
              setStep('phone');
              setCode('');
              setError(null);
            }}
          >
            Use a different number
          </button>
        </form>
      )}

      {error && <Notice tone="red">{error}</Notice>}
      <p className="mt-6 text-center text-[13px] text-text-secondary">
        <Link href="/" className="text-accent">
          Back to shops
        </Link>
      </p>
    </section>
  );
}
