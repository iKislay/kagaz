'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEMO_PAYMENT_BANNER,
  type PagePick,
  type PrintOptions,
  type PublicConfig,
  type PublicOrder,
  type Quote,
  type ShopSummary,
  colourModeLabel,
  formatPaise,
  pagePicksToOptions,
} from '@kagaz/shared';
import {
  Group,
  Notice,
  ProgressBar,
  Row,
  SegmentedControl,
  Spinner,
  Stepper,
  cx,
} from '@/components/ui';
import { PagePicker, type PreviewPage } from '@/components/order/PagePicker';
import {
  ApiRequestError,
  completeUpload,
  createOrder,
  getOrder,
  payOrder,
  requestUploadUrl,
  updateOptions,
  uploadToSignedUrl,
} from '@/lib/api';
import {
  ACCEPTED_FILES,
  ComposeError,
  type SourceKind,
  fileToPdf,
  mergePdfs,
} from '@/lib/compose-document';
import { renderThumbnails } from '@/lib/pdf-thumbnails';
import { saveTrackingToken } from '@/lib/tracking';

type Phase = 'idle' | 'uploading' | 'validating' | 'ready' | 'paying';

/** One file the customer added, already converted to PDF in the browser. */
interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  pdf: Uint8Array;
}

/** Per source: one pick and one thumbnail per page. */
type Picks = Record<string, PagePick[]>;
type Thumbs = Record<string, (string | null)[]>;

const THUMB_WIDTH = 120;
const KIND_LABEL: Record<SourceKind, string> = { pdf: 'PDF', image: 'IMG', docx: 'DOC' };

/**
 * PRD journey 6.1: add files → preview and pick pages → options → server quote → pay → tracking.
 * Every file (PDF, photo, Word) becomes one merged PDF in the browser; the API validates it as
 * any PDF. The browser never computes or sends a price; every number shown comes from the API.
 */
export function NewOrderFlow({ shop, config }: { shop: ShopSummary; config: PublicConfig }) {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [picks, setPicks] = useState<Picks>({});
  const [thumbs, setThumbs] = useState<Thumbs>({});
  const [copies, setCopies] = useState(1);
  const [duplex, setDuplex] = useState(false);
  /** Colour for newly added pages: follows the customer's last whole-document choice. */
  const [colourDefault, setColourDefault] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  /** Name of the file being converted while files are added; separate from the upload phase. */
  const [preparing, setPreparing] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requoting, setRequoting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const uploadSeq = useRef(0);
  const requestSeq = useRef(0);
  const thumbJobs = useRef(new Map<string, AbortController>());
  const isDemo = config.paymentMode === 'DEMO';
  const atCounter = config.paymentMode === 'COUNTER';
  const colourAvailable = shop.capabilities.colour;
  const maxMb = Math.floor(config.limits.maxUploadBytes / 1024 / 1024);

  // Pages in document order across all files (page n of the uploaded PDF = pages[n - 1]).
  const pages: PreviewPage[] = useMemo(
    () =>
      sources.flatMap((s) =>
        (picks[s.id] ?? []).map((pick, i) => ({ ...pick, thumb: thumbs[s.id]?.[i] ?? null })),
      ),
    [sources, picks, thumbs],
  );
  const pageCount = pages.length;
  const selection = useMemo(() => pagePicksToOptions(pages), [pages]);
  const options: PrintOptions | null = selection
    ? { ...selection, copies, duplex, paperSize: 'A4' }
    : null;
  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    const jobs = thumbJobs.current;
    return () => jobs.forEach((job) => job.abort());
  }, []);

  // ─── Add / remove files ───
  const addFiles = async (files: File[]) => {
    setError(null);
    const added: { source: Source; pageCount: number }[] = [];
    let total = pageCount;
    const problems: string[] = [];
    for (const file of files) {
      setPreparing(file.name);
      try {
        if (file.size > config.limits.maxUploadBytes) {
          throw new ComposeError(`${file.name} is too large. The limit is ${maxMb} MB.`);
        }
        const { kind, pdf, pageCount: count } = await fileToPdf(file);
        if (total + count > config.limits.maxPages) {
          throw new ComposeError(
            `${file.name} would make ${total + count} pages. The limit is ${config.limits.maxPages}.`,
          );
        }
        total += count;
        added.push({
          source: { id: crypto.randomUUID(), name: file.name, kind, pdf },
          pageCount: count,
        });
      } catch (err) {
        problems.push(
          err instanceof ComposeError ? err.message : `${file.name} couldn't be prepared.`,
        );
      }
    }
    setPreparing(null);
    if (problems.length) setError(problems.join(' '));
    if (added.length === 0) return;

    setPicks((p) => ({
      ...p,
      ...Object.fromEntries(
        added.map(({ source, pageCount: n }) => [
          source.id,
          Array.from({ length: n }, () => ({
            print: true,
            colour: colourAvailable && colourDefault,
          })),
        ]),
      ),
    }));
    setSources((s) => [...s, ...added.map((a) => a.source)]);
    for (const { source, pageCount: n } of added) startThumbnails(source, n);
  };

  const startThumbnails = (source: Source, n: number) => {
    const job = new AbortController();
    thumbJobs.current.set(source.id, job);
    setThumbs((t) => ({ ...t, [source.id]: Array<string | null>(n).fill(null) }));
    renderThumbnails(
      source.pdf,
      THUMB_WIDTH,
      (i, url) =>
        setThumbs((t) => {
          const row = t[source.id];
          return row ? { ...t, [source.id]: row.map((old, j) => (j === i ? url : old)) } : t;
        }),
      job.signal,
    )
      .catch(() => undefined) // a missing thumbnail only leaves its placeholder
      .finally(() => thumbJobs.current.delete(source.id));
  };

  const removeSource = (id: string) => {
    thumbJobs.current.get(id)?.abort();
    setSources((s) => s.filter((x) => x.id !== id));
    setPicks(({ [id]: _removed, ...rest }) => rest);
    setThumbs(({ [id]: _removed, ...rest }) => rest);
    setError(null);
  };

  /** Apply `change` to page `index` of the merged document. */
  const updatePick = (index: number, change: (p: PagePick) => PagePick) =>
    setPicks((p) => {
      let offset = index;
      for (const s of sources) {
        const row = p[s.id] ?? [];
        if (offset < row.length) {
          const at = offset;
          return { ...p, [s.id]: row.map((x, j) => (j === at ? change(x) : x)) };
        }
        offset -= row.length;
      }
      return p;
    });

  const setAllColour = (colour: boolean) => {
    setColourDefault(colour);
    setPicks((p) =>
      Object.fromEntries(
        Object.entries(p).map(([id, row]) => [id, row.map((x) => ({ ...x, colour }))]),
      ),
    );
  };

  // ─── Upload: every change to the file list uploads the merged PDF as a fresh draft ───
  const sourcesKey = sources.map((s) => s.id).join();
  useEffect(() => {
    const seq = ++uploadSeq.current;
    setOrder(null);
    setToken(null);
    setReviewing(false);
    if (sources.length === 0) {
      setPhase('idle');
      return;
    }
    void (async () => {
      const stale = () => seq !== uploadSeq.current;
      setPhase('uploading');
      setProgress(0);
      try {
        const merged = await mergePdfs(sources.map((s) => s.pdf));
        if (stale()) return;
        if (merged.size > config.limits.maxUploadBytes) {
          throw new ComposeError(
            `Together these files are ${(merged.size / 1024 / 1024).toFixed(1)} MB. The limit is ${maxMb} MB: remove a file.`,
          );
        }
        // Created with all pages; the options effect sends the customer's picks once it is ready.
        const created = await createOrder(shop.id, {
          copies,
          duplex,
          colour: false,
          paperSize: 'A4',
        });
        if (stale()) return;
        saveTrackingToken(created.order.id, created.trackingToken);
        const upload = await requestUploadUrl(created.order.id, merged.size, created.trackingToken);
        await uploadToSignedUrl(upload, merged, (f) => {
          if (!stale()) setProgress(f);
        });
        if (stale()) return;
        setPhase('validating');
        const validated = await completeUpload(
          created.order.id,
          upload.fileId,
          created.trackingToken,
        );
        if (stale()) return;
        setToken(created.trackingToken);
        setOrder(validated);
        setPhase('ready');
      } catch (err) {
        if (stale()) return;
        setError(err instanceof ComposeError ? err.message : messageOf(err));
        setPhase('idle');
      }
    })();
    // Keyed on the file list only: picks and options are sent by the options effect below.
  }, [sourcesKey]);

  // ─── Options → server re-quote (debounced, stale responses ignored) ───
  const readyOrderId = phase === 'ready' || phase === 'paying' ? (order?.id ?? null) : null;
  useEffect(() => {
    if (!readyOrderId || !token || !options) return;
    const seq = ++requestSeq.current;
    setRequoting(true);
    const timer = setTimeout(async () => {
      try {
        const updated = await updateOptions(readyOrderId, options, token);
        if (seq !== requestSeq.current) return;
        setOrder(updated);
        setError(null);
      } catch (err) {
        if (seq === requestSeq.current) setError(messageOf(err));
      } finally {
        if (seq === requestSeq.current) setRequoting(false);
      }
    }, 400);
    return () => clearTimeout(timer);
    // Re-quote when the picks/options change or a new upload becomes ready, not on every order update.
  }, [optionsKey, readyOrderId]);

  // ─── Pay ───
  const pay = async () => {
    if (!order || !token) return;
    setPhase('paying');
    setError(null);
    try {
      const res = await payOrder(order.id, token);
      router.push(`/order/${res.order.id}#t=${encodeURIComponent(token)}`);
    } catch (err) {
      setError(messageOf(err));
      // P2.5: the shop changed its prices — show the new server quote before paying again.
      if (err instanceof ApiRequestError && err.code === 'PRICE_CHANGED') {
        await getOrder(order.id, token).then(setOrder, () => undefined);
      }
      setPhase('ready');
    }
  };

  const quote = order?.quote ?? null;
  const canPay =
    phase === 'ready' && order?.status === 'AWAITING_PAYMENT' && !!quote && !!options && !requoting;
  const colourPages = pages.filter((p) => p.print && p.colour).length;
  const printedPages = pages.filter((p) => p.print).length;
  const colourValue = colourPages === 0 ? 'bw' : colourPages === printedPages ? 'colour' : 'mixed';

  return (
    <section>
      <p className="text-[13px] font-medium text-text-secondary">{shop.name}</p>
      <h1 className="mac-title mt-0.5">{reviewing ? 'Review your order' : 'New order'}</h1>

      {reviewing && quote && order ? (
        <ReviewStep
          shop={shop}
          order={order}
          sources={sources}
          pages={pages}
          isDemo={isDemo}
          atCounter={atCounter}
          paying={phase === 'paying'}
          canPay={canPay}
          error={error}
          onEdit={() => setReviewing(false)}
          onPay={pay}
        />
      ) : (
        <>
          <SourcesCard
            sources={sources}
            phase={phase}
            preparing={preparing}
            progress={progress}
            pageCount={pageCount}
            maxMb={maxMb}
            maxPages={config.limits.maxPages}
            onFiles={addFiles}
            onRemove={removeSource}
          />
          {error && <Notice tone="red">{error}</Notice>}

          {pageCount > 0 && (
            <Group
              title="Pages"
              footer={
                printedPages === 0
                  ? 'Choose at least one page to print.'
                  : `${printedPages} of ${pageCount} pages will print. Tap a page to skip it${colourAvailable ? ', or its Colour / B/W label to change just that page' : ''}.`
              }
            >
              <PagePicker
                pages={pages}
                colourAvailable={colourAvailable}
                onTogglePrint={(i) => updatePick(i, (p) => ({ ...p, print: !p.print }))}
                onToggleColour={(i) => updatePick(i, (p) => ({ ...p, colour: !p.colour }))}
              />
            </Group>
          )}

          <Group title="Print options">
            <Row label="Copies">
              <Stepper
                label="copies"
                value={copies}
                min={1}
                max={config.limits.maxCopies}
                onChange={setCopies}
              />
            </Row>
            <Row
              label="Colour"
              hint={
                !colourAvailable
                  ? 'Not available at this shop'
                  : colourValue === 'mixed'
                    ? `${colourPages} colour, ${printedPages - colourPages} B/W pages`
                    : undefined
              }
            >
              <SegmentedControl
                label="Colour"
                value={colourValue}
                options={[
                  { value: 'bw', label: 'B/W' },
                  { value: 'colour', label: 'Colour', disabled: !colourAvailable },
                ]}
                onChange={(v) => setAllColour(v === 'colour')}
              />
            </Row>
            <Row
              label="Sides"
              hint={!shop.capabilities.duplex ? 'Double-sided not available here' : undefined}
            >
              <SegmentedControl
                label="Sides"
                value={duplex ? 'double' : 'single'}
                options={[
                  { value: 'single', label: 'Single' },
                  { value: 'double', label: 'Double', disabled: !shop.capabilities.duplex },
                ]}
                onChange={(v) => setDuplex(v === 'double')}
              />
            </Row>
            <Row label="Paper">
              <span className="text-[15px] text-text-secondary">A4</span>
            </Row>
          </Group>

          <Group
            title="Price"
            footer={
              isDemo
                ? `${DEMO_PAYMENT_BANNER}. This is a demo — no money moves.`
                : atCounter
                  ? 'You pay the shop when you collect your prints. Nothing is charged online.'
                  : undefined
            }
          >
            {quote ? (
              <>
                <Row
                  label={`${quote.selectedPages} page${quote.selectedPages === 1 ? '' : 's'} × ${quote.copies} cop${quote.copies === 1 ? 'y' : 'ies'}`}
                  hint={sidesHint(quote)}
                >
                  <span className="text-[15px] tabular-nums">
                    {formatPaise(quote.subtotalPaise)}
                  </span>
                </Row>
                {quote.minimumChargeApplied && (
                  <Row label="Minimum charge" hint="This shop has a minimum order value">
                    <span className="text-[15px] tabular-nums">
                      {formatPaise(quote.totalPaise)}
                    </span>
                  </Row>
                )}
                <Row label={<span className="font-semibold">Total</span>}>
                  <span
                    className={cx(
                      'text-[17px] font-semibold tabular-nums',
                      requoting && 'opacity-40',
                    )}
                  >
                    {formatPaise(quote.totalPaise)}
                  </span>
                </Row>
              </>
            ) : (
              <Row
                label={<span className="text-text-secondary">Add a file to see the price</span>}
              />
            )}
          </Group>

          <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              className="mac-button disabled:opacity-40"
              disabled={!canPay}
              onClick={() => setReviewing(true)}
            >
              Continue{quote ? ` · ${formatPaise(quote.totalPaise)}` : ''}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** "12 printed sides at ₹2.00 each", or the colour / B/W split of a mixed order. */
function sidesHint(quote: Quote): string {
  const mixed = quote.mixedColour;
  if (!mixed) return `${quote.printedSides} printed sides at ${formatPaise(quote.ratePaise)} each`;
  const bw = quote.printedSides - mixed.colourSides;
  return `${mixed.colourSides} colour sides at ${formatPaise(mixed.colourRatePaise)}, ${bw} B/W at ${formatPaise(quote.ratePaise)}`;
}

/** Final check before placing the order: the pages that will print, every option, the total. */
function ReviewStep({
  shop,
  order,
  sources,
  pages,
  isDemo,
  atCounter,
  paying,
  canPay,
  error,
  onEdit,
  onPay,
}: {
  shop: ShopSummary;
  order: PublicOrder;
  sources: Source[];
  pages: PreviewPage[];
  isDemo: boolean;
  atCounter: boolean;
  paying: boolean;
  canPay: boolean;
  error: string | null;
  onEdit: () => void;
  onPay: () => void;
}) {
  const quote = order.quote!;
  const o = order.options;
  return (
    <>
      <Group title="Pages to print">
        <PagePicker pages={pages} colourAvailable={o.colour} readOnly />
      </Group>

      <Group
        title="Summary"
        footer={
          <button type="button" onClick={onEdit} className="font-medium text-accent">
            Edit order
          </button>
        }
      >
        <Row label="Shop" hint={shop.address}>
          <span className="text-right text-[15px]">{shop.name}</span>
        </Row>
        <Row
          label={sources.length === 1 ? 'File' : `${sources.length} files`}
          hint={`${pages.length} pages in total`}
        >
          <span className="block max-w-[55vw] truncate text-[15px]">
            {sources.map((s) => s.name).join(', ')}
          </span>
        </Row>
        <Row label="Pages">
          <span className="text-[15px]">
            {o.pageRange ? o.pageRange : 'All'} · {quote.selectedPages} selected
          </span>
        </Row>
        <Row label="Copies">
          <span className="text-[15px] tabular-nums">{o.copies}</span>
        </Row>
        <Row label="Print">
          <span className="text-[15px]">
            {colourModeLabel(o)} · {o.duplex ? 'Double-sided' : 'Single-sided'} · A4
          </span>
        </Row>
        <Row label={<span className="font-semibold">Total</span>} hint={sidesHint(quote)}>
          <span className="text-[19px] font-semibold tabular-nums">
            {formatPaise(quote.totalPaise)}
          </span>
        </Row>
      </Group>

      {error && <Notice tone="red">{error}</Notice>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="mac-button h-auto flex-col gap-0.5 py-3 disabled:opacity-40"
          disabled={!canPay || paying}
          onClick={onPay}
        >
          {paying ? (
            <span className="flex items-center gap-2">
              <Spinner /> Placing order…
            </span>
          ) : (
            <>
              <span className="text-[15px] font-semibold">
                {atCounter
                  ? 'Pay at counter'
                  : `Pay ${formatPaise(quote.totalPaise)}${isDemo ? ' (demo)' : ''}`}
              </span>
              {atCounter && (
                <span className="text-[12px] font-normal opacity-85">
                  Pay {formatPaise(quote.totalPaise)} when you collect
                </span>
              )}
            </>
          )}
        </button>
        <button
          type="button"
          disabled
          aria-disabled
          className="flex h-auto cursor-not-allowed flex-col items-center gap-0.5 rounded-full border border-separator bg-surface px-6 py-3 text-text-secondary"
        >
          <span className="text-[15px] font-semibold">Pay online</span>
          <span className="text-[12px]">Coming soon</span>
        </button>
      </div>
      {atCounter && (
        <p className="mt-3 text-center text-[13px] text-text-secondary">
          You get a pickup number right away. The shop checks your file and prints it. Tell them
          your number and pay at the counter.
        </p>
      )}
    </>
  );
}

/** The customer's files: add (pick or drop, several at once), remove, and the upload status. */
function SourcesCard({
  sources,
  phase,
  preparing,
  progress,
  pageCount,
  maxMb,
  maxPages,
  onFiles,
  onRemove,
}: {
  sources: Source[];
  phase: Phase;
  preparing: string | null;
  progress: number;
  pageCount: number;
  maxMb: number;
  maxPages: number;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = preparing !== null || phase === 'paying';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = [...e.dataTransfer.files];
        if (files.length && !busy) onFiles(files);
      }}
      className={cx('mac-card mt-6 p-5 transition-colors', dragging && 'border-accent bg-accent/5')}
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">
            {sources.length ? 'Your files' : 'Choose files to print'}
          </div>
          <div className="mt-0.5 text-[13px] text-text-secondary">
            {preparing !== null
              ? `Preparing ${preparing}…`
              : phase === 'uploading'
                ? `Uploading… ${Math.round(progress * 100)}%`
                : phase === 'validating'
                  ? 'Checking your document…'
                  : phase === 'ready' || phase === 'paying'
                    ? `${pageCount} page${pageCount === 1 ? '' : 's'} · ready to print`
                    : `PDF, photos or Word (.docx) · drop them here or browse · up to ${maxMb} MB, ${maxPages} pages`}
          </div>
          {phase === 'uploading' && (
            <div className="mt-2">
              <ProgressBar value={progress} />
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="sr-only"
          aria-label="Choose files to print"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) onFiles(files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="shrink-0 rounded-full border border-separator bg-surface px-4 py-1.5 text-[13px] font-semibold text-accent transition-colors hover:bg-selection disabled:opacity-40"
        >
          {preparing !== null ? <Spinner /> : sources.length ? 'Add more' : 'Browse'}
        </button>
      </div>

      {sources.length > 0 && (
        <ul className="mt-4 divide-y divide-separator border-t border-separator">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <span
                className={cx(
                  'grid size-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold',
                  s.kind === 'pdf' ? 'bg-red/10 text-red' : 'bg-accent/10 text-accent',
                )}
              >
                {KIND_LABEL[s.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{s.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(s.id)}
                aria-label={`Remove ${s.name}`}
                className="shrink-0 rounded-full px-2 py-1 text-[13px] font-medium text-red hover:bg-selection disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function messageOf(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';
}
