import { Suspense } from 'react';
import { SignInFlow } from '@/components/customer/SignInFlow';

export const metadata = { title: 'Sign in — Kaggaz' };

export default function SignInPage() {
  return (
    <Suspense>
      <SignInFlow />
    </Suspense>
  );
}
