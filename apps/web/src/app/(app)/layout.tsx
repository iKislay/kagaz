import { SiteFooter, SiteHeader } from '@/components/SiteChrome';

// The header DemoBanner reads live config from the API on every request.
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-12 pb-16 md:pt-16">{children}</main>
      <SiteFooter />
    </div>
  );
}
