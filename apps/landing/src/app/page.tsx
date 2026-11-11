import type { ReactNode } from 'react';
import { DownloadButton } from '@/components/DownloadButton';
import { icons } from '@/components/icons';
import { PacketStack, PhoneTracker, ShopWindow } from '@/components/Mockups';
import {
  customerFeatures,
  faqs,
  hero,
  packet,
  plans,
  reasons,
  shopFeatures,
  steps,
} from '@/lib/content';
import { CONTACT_HREF, CUSTOMER_APP_URL } from '@/lib/site';

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  tinted,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children: ReactNode;
  tinted?: boolean;
}) {
  return (
    <section id={id} className={tinted ? 'border-y border-separator bg-surface/60' : undefined}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="section-title mt-2">{title}</h2>
          {lead && <p className="mt-4 text-[17px] leading-relaxed text-text-secondary">{lead}</p>}
        </div>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent/10 text-accent">
      {children}
    </span>
  );
}

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
        <div>
          <div className="eyebrow">{hero.eyebrow}</div>
          <h1 className="mt-3 text-[clamp(40px,6vw,60px)] font-bold leading-[1.02] tracking-[-0.035em]">
            {hero.title}
          </h1>
          <p className="mt-5 max-w-xl text-[18px] leading-relaxed text-text-secondary">
            {hero.subtitle}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <DownloadButton />
            <a href="#how-it-works" className="btn-secondary">
              See how it works
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            {hero.trust.map((t) => (
              <li key={t} className="flex items-center gap-1.5 text-[13px] text-text-secondary">
                <span className="text-green">{icons.check}</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative mx-auto w-full max-w-[520px]">
          <ShopWindow />
          <div className="absolute -bottom-10 -right-2 hidden sm:block lg:-right-8">
            <PhoneTracker />
          </div>
        </div>
      </section>

      {/* How it works */}
      <Section
        id="how-it-works"
        eyebrow="How it works"
        title="From phone to printout in four steps."
        lead="Customers do the ordering. Your counter just prints and hands over."
        tinted
      >
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="mac-card p-6">
              <div className="flex items-center justify-between">
                <IconTile>{icons[s.icon]}</IconTile>
                <span className="text-[13px] font-semibold tabular-nums text-text-secondary">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* For shops */}
      <Section
        id="shops"
        eyebrow="For print shops"
        title="Everything the counter needs. Nothing it doesn’t."
        lead="The Kaggaz Shop app runs on the Windows PC next to your printer."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {shopFeatures.map((group) => (
            <div key={group.title} className="mac-card p-6">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
                {group.title}
              </h3>
              <ul className="mt-5 space-y-6">
                {group.items.map((f) => (
                  <li key={f.title} className="flex gap-4">
                    <IconTile>{icons[f.icon]}</IconTile>
                    <div>
                      <div className="text-[15px] font-semibold">{f.title}</div>
                      <p className="mt-1 text-[14px] leading-relaxed text-text-secondary">
                        {f.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex justify-center">
          <DownloadButton />
        </div>
      </Section>

      {/* For customers */}
      <Section
        id="customers"
        eyebrow="For customers"
        title="Print from your phone. Pick up on the way."
        lead="No pen drive, no WhatsApp forwards, no waiting while someone finds your file."
        tinted
      >
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {customerFeatures.map((f) => (
            <div key={f.title} className="flex gap-4">
              <IconTile>{icons[f.icon]}</IconTile>
              <div>
                <div className="text-[15px] font-semibold">{f.title}</div>
                <p className="mt-1 text-[14px] leading-relaxed text-text-secondary">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 flex justify-center">
          <a href={CUSTOMER_APP_URL} className="btn-primary">
            Start printing {icons.arrow}
          </a>
        </div>
      </Section>

      {/* Pickup slip */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2">
        <div className="order-2 lg:order-1">
          <PacketStack />
        </div>
        <div className="order-1 lg:order-2">
          <div className="eyebrow">{packet.eyebrow}</div>
          <h2 className="section-title mt-2">{packet.title}</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-text-secondary">{packet.body}</p>
          <ul className="mt-6 space-y-3">
            {packet.points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[15px]">
                <span className="mt-0.5 text-green">{icons.check}</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing */}
      <Section
        id="pricing"
        eyebrow="Pricing"
        title="Simple plans for every counter."
        lead="Customers pay your per-page rates. You pay one flat plan for the software."
        tinted
      >
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`mac-card relative flex flex-col p-6 ${p.featured ? 'ring-2 ring-accent' : ''}`}
            >
              {p.featured && (
                <span className="absolute -top-3 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  Most popular
                </span>
              )}
              <h3 className="text-[15px] font-semibold">{p.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[32px] font-bold tracking-tight">
                  {p.price ?? 'Talk to us'}
                </span>
                {p.price && p.per && (
                  <span className="text-[14px] text-text-secondary">{p.per}</span>
                )}
              </div>
              <p className="mt-2 text-[14px] text-text-secondary">{p.blurb}</p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[14px]">
                    <span className="mt-0.5 text-accent">{icons.check}</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={CONTACT_HREF}
                className={`mt-8 ${p.featured ? 'btn-primary' : 'btn-secondary'}`}
              >
                {p.price ? 'Get started' : 'Contact us'}
              </a>
            </div>
          ))}
        </div>
      </Section>

      {/* Why */}
      <Section id="why" eyebrow="Why Kaggaz" title="Built for the way print shops work.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {reasons.map((r) => (
            <div key={r.title} className="mac-card p-6">
              <IconTile>{icons[r.icon]}</IconTile>
              <h3 className="mt-5 text-[16px] font-semibold tracking-tight">{r.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">{r.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq" eyebrow="FAQ" title="Questions, answered." tinted>
        <div className="mac-card mx-auto max-w-3xl divide-y divide-separator overflow-hidden">
          {faqs.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium hover:bg-selection/50 [&::-webkit-details-marker]:hidden">
                {f.q}
                <svg
                  aria-hidden
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  className="shrink-0 text-text-secondary transition-transform group-open:rotate-180"
                >
                  <path
                    d="m2.5 4.5 3.5 3.5 3.5-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              <p className="px-5 pb-5 text-[14px] leading-relaxed text-text-secondary">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mac-card px-6 py-14 text-center sm:px-12">
          <h2 className="section-title mx-auto max-w-2xl">
            Ready to put your counter on autopilot?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[17px] text-text-secondary">
            Install the Kaggaz Shop app, pair your PC, and take your first prepaid order today.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <DownloadButton />
            <a href={CONTACT_HREF} className="btn-secondary">
              Talk to us
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
