import type { Metadata } from 'next';
import { DemoBanner } from '@/components/DemoBanner';
import { AdminShell } from './_components/AdminShell';

export const metadata: Metadata = {
  title: 'Kaggaz Admin',
  robots: { index: false, follow: false },
};

/** /admin: macOS-style source-list window (P2.13). Auth + roles are enforced by the API. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell banner={<DemoBanner />}>{children}</AdminShell>;
}
