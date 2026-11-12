import { Suspense } from 'react';
import { SignInFlow } from '@/components/customer/SignInFlow';

export const metadata = { title: 'Sign in — Kagaz' };

export default function SignInPage() {
  return (
    <Suspense>
      <SignInFlow />
    </Suspense>
  );
}
