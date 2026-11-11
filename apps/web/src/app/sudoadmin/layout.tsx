import type { Metadata } from 'next';
import { DemoBanner } from '@/components/DemoBanner';
import { SudoShell } from './_components/SudoShell';

export const metadata: Metadata = {
  title: 'Kagaz Console',
  robots: { index: false, follow: false },
};

/** /sudoadmin: the platform owner's console (Kagaz admins only; enforced by the API). */
export default function SudoLayout({ children }: { children: React.ReactNode }) {
  return <SudoShell banner={<DemoBanner />}>{children}</SudoShell>;
}
