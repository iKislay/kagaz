import Image from 'next/image';
import Link from 'next/link';
import {
  SiteFooter,
  SiteHeader,
  btnOutline,
  btnPrimary,
  eyebrow,
  display,
} from '@/components/SiteChrome';

// The header DemoBanner reads live config from the API on every request.
export const dynamic = 'force-dynamic';

const PROBLEMS = [
  [
    'Files arrive on WhatsApp',
    'Customers forward files to the shop’s personal number. Files pile up in the chat and stay on the phone long after the job is done.',
  ],
  [
    'The counter becomes a queue',
    'Every job means asking the same questions: how many copies, colour or B/W, which pages. Then you work out the price and wait at the printer.',
  ],
  [
    'Mistakes cost paper',
    'Wrong page ranges, a job printed twice, a slip lost in the stack. Each one is wasted paper and an unhappy customer.',
  ],
] as const;

const STEPS = [
  [
    'Pick a shop',
    'Open Kagaz on any phone browser and choose a print shop in Mandya. No app to install.',
  ],
  [
    'Upload your file',
    'Choose copies, B/W or colour, single or double-sided and page range. Kagaz checks the file before you pay.',
  ],
  [
    'Pay the exact price',
    'The price is calculated on our server from the shop’s own rates, so it is always the same as the shop charges.',
  ],
  [
    'Collect with your code',
    'The shop’s printer prints your pages with a pickup slip. Show your pickup code, for example #7 · 12 Nov, at the counter.',
  ],
] as const;

const SHOP_FEATURES = [
  {
    title: 'Orders',
    items: [
      'Paid orders arrive on the Windows shop app',
      'Manual approval, or auto-accept with safety limits',
      'Pause new orders with one switch',
      'Full order details: pages, copies, sides, colour',
    ],
  },
  {
    title: 'Printing',
    items: [
      'One print job per order: pages plus one pickup slip',
      'Separate B/W and colour printers',
      'No silent duplicate prints after a restart',
      'Reprints only after you confirm',
    ],
  },
  {
    title: 'Your shop',
    items: [
      'Set your own per-side rates for B/W and colour',
      'Daily pickup numbers that restart at midnight',
      'Order history and day totals',
      'Runs on the PC you already have',
    ],
  },
] as const;

const CUSTOMER_FEATURES = [
  ['No app needed', 'Works in Chrome, Safari or any phone browser.'],
  ['PDF up to 25 MB', 'Up to 300 pages, checked before you pay.'],
  ['Your print settings', 'Copies, colour, double-sided and page range.'],
  ['Live status', 'See when your order is paid, printing and ready.'],
  ['Private files', 'Stored privately and deleted automatically after pickup.'],
  ['Pay online', 'UPI, cards and netbanking when payments go live.'],
] as const;

const WHY = [
  [
    'Prices you can trust',
    'Kagaz computes every price from the shop’s rates in whole paise. The browser never decides what you pay.',
  ],
  [
    'Payments checked by the server',
    'An order is only marked paid after the payment provider confirms it. A redirect alone never counts.',
  ],
  [
    'Files stay private',
    'Uploads go to private storage behind short-lived links and are deleted automatically after pickup.',
  ],
  [
    'One order, one print',
    'Pages and pickup slip print as a single job. Anything uncertain waits for the operator instead of printing twice.',
  ],
] as const;

const FAQ = [
  [
    'What is Kagaz?',
    'Kagaz connects customers with print shops in Mandya. You upload a file from your phone, pay online, and pick up the printout at the shop using a pickup code.',
  ],
  [
    'Do I need an app or an account?',
    'No app. You sign in with a one-time code sent to your phone number so you can track your orders.',
  ],
  [
    'What files can I print?',
    'PDF files up to 25 MB and 300 pages, on A4 paper. If your file is a Word document or a photo, save it as PDF first.',
  ],
  [
    'How is the price calculated?',
    'Each shop sets a rate per printed side for B/W and colour. Kagaz multiplies that by the pages and copies you choose and shows the total before you pay.',
  ],
  [
    'Is my document safe?',
    'Files are kept in private storage that only the shop’s printer can download, through links that expire in minutes. They are deleted automatically after pickup.',
  ],
  [
    'What is a pickup code?',
    'Every paid order gets a number for the day at that shop, like #7 · 12 Nov. It is printed on the slip with your pages. Tell it at the counter to collect.',
  ],
  [
    'What if the printer jams?',
    'The shop app stops and asks the operator to check. Nothing is printed again until the operator confirms it.',
  ],
  [
    'Can the shop reject my order?',
    'Shops in manual mode review each order. If an order is rejected after payment, it is refunded.',
  ],
  [
    'How do shops join?',
    'Shops install the Kagaz Windows app on their PC, pair it with a code and set their rates. Setup takes minutes.',
  ],
  [
    'How do I pay?',
    'Pay at the shop counter when you collect: tell them your pickup code and pay by cash or UPI. Online payment is coming soon.',
  ],
] as const;

export default function LandingPage() {
  return (
    <div className="bg-cream text-ink">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden">
          <div className="relative z-20 mx-auto max-w-6xl px-4 pt-16 pb-40 md:px-6 md:pt-24 md:pb-[clamp(10rem,17vw,20rem)]">
            <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
              <p className={eyebrow}>Online printing for Mandya</p>
              <h1 className={`${display} mt-5 text-[44px] leading-[1.05] md:text-[60px]`}>
                Send it from your phone. <em className="text-forest">Pick it up</em> printed.
              </h1>
              <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-ink-soft md:text-[17px]">
                Upload a file, choose a print shop near you, pay the exact price and collect your
                pages with a pickup code. No queue at the counter, no files left on WhatsApp.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/shops" className={btnPrimary}>
                  Print a file
                  <span aria-hidden>→</span>
                </Link>
                <a href="/#how-it-works" className={btnOutline}>
                  How it works
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-soft">
                {['No app needed', 'Price shown before you pay', 'Files deleted after pickup'].map(
                  (t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-forest" aria-hidden />
                      {t}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
          {/* Illustration sits behind the hero; its empty top half fades under the content. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-[-2.5vw] z-0 [mask-image:linear-gradient(to_bottom,transparent,black_24%,black_94%,transparent)]"
          >
            <Image
              src="/illustrations/hero.webp"
              alt=""
              width={2172}
              height={724}
              sizes="100vw"
              priority
              className="block h-auto w-full"
            />
          </div>
        </section>

        {/* Problem */}
        <section className="border-y border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[0.9fr_1.1fr] md:px-6 md:py-28">
            <div>
              <p className={eyebrow}>The problem</p>
              <h2
                className={`${display} mt-5 max-w-[16ch] text-[36px] leading-[1.1] md:text-[44px]`}
              >
                Printing a page shouldn’t take a phone call.
              </h2>
            </div>
            <div>
              {PROBLEMS.map(([title, body], i) => (
                <article key={title} className={`py-5 md:py-6 ${i ? 'border-t border-line' : ''}`}>
                  <div className="flex gap-5">
                    <span className="font-mono text-[12px] text-ink-soft">0{i + 1}</span>
                    <div>
                      <h3 className="text-[17px] font-medium tracking-[-0.015em]">{title}</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{body}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-24">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <p className={eyebrow}>How it works</p>
            <h2 className={`${display} mt-5 max-w-[20ch] text-[36px] leading-[1.1] md:text-[44px]`}>
              Four steps from your phone to the shop counter.
            </h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([title, body], i) => (
                <article key={title} className="rounded-2xl border border-line bg-paper p-6">
                  <span className="font-mono text-[12px] text-forest">0{i + 1}</span>
                  <h3 className="mt-2.5 text-[19px] font-medium tracking-[-0.02em]">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* For shops */}
        <section id="shops" className="scroll-mt-24 border-y border-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <p className={eyebrow}>For print shops</p>
            <h2 className={`${display} mt-5 max-w-[20ch] text-[36px] leading-[1.1] md:text-[44px]`}>
              Your shop runs the queue. <em className="text-forest">You just hand over pages.</em>
            </h2>
            <p className="mt-5 max-w-[56ch] text-[16px] leading-relaxed text-ink-soft">
              The Kagaz Windows app sits on your shop PC, receives paid orders and prints them on
              your printer. Each order ends with a pickup slip, so the stack sorts itself.
            </p>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {SHOP_FEATURES.map((group) => (
                <article key={group.title} className="rounded-2xl border border-line bg-cream p-6">
                  <h3 className="text-[17px] font-medium tracking-[-0.015em]">{group.title}</h3>
                  <ul className="mt-4 space-y-3">
                    {group.items.map((item) => (
                      <li key={item} className="flex gap-3 text-[14px] leading-snug text-ink-soft">
                        <Check />
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link href="/download" className={btnPrimary}>
                Get the shop app for Windows
              </Link>
              <span className="text-[13px] text-ink-soft">
                For shop owners. Printing a file? Go to{' '}
                <Link href="/shops" className="text-forest underline-offset-2 hover:underline">
                  kaggaz.in/shops
                </Link>
                .
              </span>
            </div>
          </div>
        </section>

        {/* For customers */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <p className={eyebrow}>For customers</p>
          <h2 className={`${display} mt-5 max-w-[20ch] text-[36px] leading-[1.1] md:text-[44px]`}>
            Everything you need, nothing to install.
          </h2>
          <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {CUSTOMER_FEATURES.map(([title, body]) => (
              <div key={title} className="border-t border-line pt-5">
                <h3 className="text-[16px] font-medium tracking-[-0.015em]">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-24 border-y border-line bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:px-6 md:py-28">
            <div>
              <p className={eyebrow}>Pricing</p>
              <h2
                className={`${display} mt-5 max-w-[16ch] text-[36px] leading-[1.1] md:text-[44px]`}
              >
                You pay the shop’s rate. Nothing hidden.
              </h2>
              <p className="mt-5 max-w-[48ch] text-[16px] leading-relaxed text-ink-soft">
                Every shop sets its own price per printed side for B/W and colour. Kagaz shows the
                full breakdown before you pay, and the price is locked once you do.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-cream p-6 md:p-8">
              <p className={eyebrow}>Example order</p>
              <dl className="mt-5 space-y-3 text-[15px]">
                {[
                  ['Pages', '12'],
                  ['Copies', '2'],
                  ['Sides', 'Single-sided, B/W'],
                  ['Rate', '₹2.00 per side'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-ink-soft">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 flex items-baseline justify-between border-t border-line pt-5">
                <span className="text-[15px] font-medium">Total</span>
                <span className={`${display} text-[36px]`}>₹48.00</span>
              </div>
              <p className="mt-3 text-[12px] text-ink-soft">
                Example rate. Each shop sets its own.
              </p>
            </div>
          </div>
        </section>

        {/* Why Kagaz */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <p className={eyebrow}>Why Kagaz</p>
          <h2 className={`${display} mt-5 max-w-[20ch] text-[36px] leading-[1.1] md:text-[44px]`}>
            Built so nothing gets lost, overcharged or printed twice.
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {WHY.map(([title, body], i) => (
              <article key={title} className="rounded-2xl border border-line bg-paper p-6">
                <span className="font-mono text-[12px] text-forest">0{i + 1}</span>
                <h3 className="mt-2.5 text-[19px] font-medium tracking-[-0.02em]">{title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 border-y border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[0.8fr_1.2fr] md:px-6 md:py-28">
            <div>
              <p className={eyebrow}>FAQ</p>
              <h2 className={`${display} mt-5 text-[36px] leading-[1.1] md:text-[44px]`}>
                Questions, answered.
              </h2>
            </div>
            <div>
              {FAQ.map(([q, a], i) => (
                <details key={q} className={`group py-4 ${i ? 'border-t border-line' : ''}`}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                    {q}
                    <span
                      aria-hidden
                      className="text-[20px] leading-none text-ink-soft transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-2.5 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
                    {a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-6xl px-4 py-24 text-center md:px-6 md:py-32">
          <h2
            className={`${display} mx-auto max-w-[18ch] text-[40px] leading-[1.08] md:text-[56px]`}
          >
            Your next print is <em className="text-forest">one upload</em> away.
          </h2>
          <p className="mx-auto mt-5 max-w-[44ch] text-[16px] text-ink-soft">
            Pick a shop in Mandya and see the price before you pay.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/shops" className={btnPrimary}>
              Print a file <span aria-hidden>→</span>
            </Link>
            <a href="/#shops" className={btnOutline}>
              I run a print shop
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
