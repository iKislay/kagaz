/**
 * kaggaz.app copy. Edit wording here; layout lives in src/app/page.tsx.
 * Only describe what the product actually does (see docs/PRD.md): PDF only, A4 only, prepaid,
 * one combined print job with a pickup slip, daily pickup code (ADR-002).
 */
import type { icons } from '@/components/icons';

type IconName = keyof typeof icons;

export const hero = {
  eyebrow: 'For print shops in Mandya',
  title: 'Your print counter, on autopilot.',
  subtitle:
    'Customers upload a PDF and pay from their phone. Kaggaz sends the job to your printer with a pickup slip, and they collect it with a short pickup code. No WhatsApp files, no pen drives, no counting change.',
  trust: ['Paid before it prints', 'One order, one print job', 'Files deleted automatically'],
};

export const steps: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'upload',
    title: 'Upload a PDF',
    body: 'The customer opens print.kaggaz.app on any phone or laptop, picks your shop and uploads a PDF.',
  },
  {
    icon: 'sliders',
    title: 'Choose and see the price',
    body: 'Pages, copies, B/W or colour, single or double-sided. The exact price is shown before paying.',
  },
  {
    icon: 'card',
    title: 'Pay online',
    body: 'Payment is confirmed by our server, not the browser. Only then does the job reach your shop.',
  },
  {
    icon: 'printer',
    title: 'Print and pick up',
    body: 'Your PC prints the pages and a pickup slip as one job. The customer collects it with their code, e.g. #7.',
  },
];

export const shopFeatures: {
  title: string;
  items: { icon: IconName; title: string; body: string }[];
}[] = [
  {
    title: 'Orders',
    items: [
      {
        icon: 'list',
        title: 'Live job queue',
        body: 'New, queued, printing and ready jobs on one screen, updated in real time.',
      },
      {
        icon: 'bolt',
        title: 'Auto mode with your limits',
        body: 'Jobs within your page, copy and queue limits print on their own. Anything bigger waits for you.',
      },
      {
        icon: 'ticket',
        title: 'Daily pickup codes',
        body: '#1, #2, #3 … from midnight. Short enough to shout across the counter.',
      },
    ],
  },
  {
    title: 'Printing',
    items: [
      {
        icon: 'layers',
        title: 'One packet per order',
        body: 'All pages, all copies and the pickup slip in one PDF, sent as one print job. Nothing gets mixed up.',
      },
      {
        icon: 'shield',
        title: 'No accidental reprints',
        body: 'If the printer jams or the PC restarts, Kaggaz asks you to check. It never prints twice on its own.',
      },
      {
        icon: 'printer',
        title: 'Works with your printer',
        body: 'Uses any printer already installed in Windows, B/W or colour, with or without automatic duplex.',
      },
    ],
  },
  {
    title: 'Business',
    items: [
      {
        icon: 'rupee',
        title: 'Your prices',
        body: 'Set your own per-side rates for B/W, colour and double-sided. The server does the maths.',
      },
      {
        icon: 'chart',
        title: 'Every order on record',
        body: 'Who ordered what, when it was paid and printed, with a full history for every job.',
      },
      {
        icon: 'refresh',
        title: 'Updates itself',
        body: 'The Windows app installs without admin rights and updates in the background.',
      },
    ],
  },
];

export const customerFeatures: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'phone',
    title: 'Nothing to install',
    body: 'Works in the browser. Sign in with your phone number, no passwords.',
  },
  {
    icon: 'sliders',
    title: 'Print exactly what you need',
    body: 'Page ranges, copies, colour and double-sided, on A4.',
  },
  {
    icon: 'rupee',
    title: 'Price before you pay',
    body: 'Calculated from the shop’s own rates. No surprises at the counter.',
  },
  {
    icon: 'pulse',
    title: 'Live order status',
    body: 'Paid → Queued → Printing → Ready for pickup, as it happens.',
  },
  {
    icon: 'ticket',
    title: 'Skip the queue',
    body: 'Walk in, say your pickup code, collect your prints.',
  },
  {
    icon: 'trash',
    title: 'Private by default',
    body: 'Files sit in private storage and are deleted automatically after printing.',
  },
];

export const packet = {
  eyebrow: 'The pickup slip',
  title: 'One packet. One slip. No mix-ups.',
  body: 'Every order prints as a single job: the customer’s pages, every copy, and one pickup slip on its own sheet. The slip shows the pickup code and date in large type, so finding the right packet takes a second.',
  points: [
    'Pickup code and date, printed large: #7 · 11 Nov',
    'Pages, copies and print settings at a glance',
    'Never the customer’s full phone number',
    'Reprints keep the same pickup code',
  ],
};

/**
 * Shop plans. `price` null → "Talk to us" (pricing not decided yet; see PRD §20).
 * Fill in e.g. price: '₹499', per: '/ month' when plans are set.
 */
export const plans: {
  name: string;
  price: string | null;
  per?: string;
  blurb: string;
  features: string[];
  featured?: boolean;
}[] = [
  {
    name: 'Monthly',
    price: null,
    blurb: 'Try Kaggaz at one counter, cancel any time.',
    features: [
      'Unlimited orders',
      'Kaggaz Shop Windows app',
      'Your own per-page prices',
      'Support on call',
    ],
  },
  {
    name: 'Yearly',
    price: null,
    blurb: 'For shops that print every day.',
    features: [
      'Everything in Monthly',
      'Two months free',
      'Help setting up your printer',
      'Priority support',
    ],
    featured: true,
  },
  {
    name: 'Multi-shop',
    price: null,
    blurb: 'For owners with more than one counter.',
    features: [
      'Everything in Yearly',
      'Several PCs and printers',
      'Orders and reports per shop',
      'Dedicated onboarding',
    ],
  },
];

export const reasons: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'lock',
    title: 'Private by design',
    body: 'Private storage, short-lived links, automatic deletion. Documents are never shared between shops.',
  },
  {
    icon: 'card',
    title: 'Paid before printing',
    body: 'A job only reaches your printer after the payment is verified on our server.',
  },
  {
    icon: 'eye',
    title: 'Built for real printers',
    body: 'Kaggaz watches the Windows print queue and tells you when something needs a look.',
  },
  {
    icon: 'bolt',
    title: 'Set up in an afternoon',
    body: 'Install the app, pair it with a one-time code, pick your printer. That’s it.',
  },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: 'What is Kaggaz?',
    a: 'Kaggaz lets your customers send print jobs to your shop from their phone. They upload a PDF, choose options and pay online; your shop PC prints it with a pickup slip; they collect it with a pickup code.',
  },
  {
    q: 'Do customers need to install an app or create an account?',
    a: 'No app. Customers use print.kaggaz.app in any browser and sign in with their phone number and a one-time code.',
  },
  {
    q: 'Which files can customers print?',
    a: 'PDF files on A4 paper. Every file is checked when it is uploaded; password-protected or damaged PDFs are turned away before payment.',
  },
  {
    q: 'What do I need at the shop?',
    a: 'A Windows 10 or 11 PC (64-bit) with an internet connection and your printer installed in Windows. Download the Kaggaz Shop app and pair it with the code we give you.',
  },
  {
    q: 'Will it print on its own?',
    a: 'Yes, if you turn on auto mode. Jobs within the limits you set (pages, copies, queue length) print automatically. Anything outside them waits for you to accept or reject.',
  },
  {
    q: 'What happens if the printer jams or the PC restarts?',
    a: 'Kaggaz never reprints by itself. If it can’t be sure a job finished, it marks it “Needs check” and you decide. Reprints keep the same pickup code.',
  },
  {
    q: 'How does pickup work?',
    a: 'Each paid order gets a daily pickup code for your shop, like #7 · 11 Nov. It is printed large on the slip and shown on the customer’s phone. Match the two and hand it over.',
  },
  {
    q: 'Are customer files safe?',
    a: 'Files are stored privately, accessed only through short-lived links, and deleted automatically after the order is printed. The slip never shows the customer’s full phone number.',
  },
  {
    q: 'Who sets the prices?',
    a: 'You do. Set per-side rates for black & white, colour and double-sided. The price is calculated on our server, so it is always the same for everyone.',
  },
  {
    q: 'Can I reject an order?',
    a: 'Yes. Pick a reason (file can’t be read, content not allowed, printer unavailable…) and the customer is told right away.',
  },
  {
    q: 'Does it work with colour and double-sided printers?',
    a: 'Yes. You tell the app what each printer can do, and Kaggaz never sends a colour or double-sided job to a printer you haven’t confirmed for it.',
  },
  {
    q: 'Where is Kaggaz available?',
    a: 'We are starting with print shops in Mandya, Karnataka. Want it at your shop elsewhere? Get in touch.',
  },
];
