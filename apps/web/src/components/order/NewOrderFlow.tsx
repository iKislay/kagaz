'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEMO_PAYMENT_BANNER,
  type PrintOptions,
  type PublicConfig,
  type PublicOrder,
  type ShopSummary,
  formatPaise,
} from '@kagaz/shared';
import {
  Group,
  Notice,
  ProgressBar,
  Row,
  SegmentedControl,
  Spinner,
  Stepper,
  TextField,
  cx,
} from '@/components/ui';
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
import { saveTrackingToken } from '@/lib/tracking';

type Phase = 'idle' | 'uploading' | 'validating' | 'ready' | 'paying';

const DEFAULT_OPTIONS: PrintOptions = {
  copies: 1,
  colour: false,
  duplex: false,
  paperSize: 'A4',
  pageRange: '',
};

/**
 * PRD journey 6.1: upload → options → server quote → pay (demo) → tracking.
 * The browser never computes or sends a price; every number shown comes from the API.
 */
export function NewOrderFlow({ shop, config }: { shop: ShopSummary; config: PublicConfig }) {
  const router = useRouter();
  const [options, setOptions] = useState<PrintOptions>(DEFAULT_OPTIONS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [requoting, setRequoting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  /** Local preview of the customer's own file (never leaves the browser this way). */
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const isDemo = config.paymentMode === 'DEMO';
  const atCounter = config.paymentMode === 'COUNTER';

  useEffect(() => () => void (fileUrl && URL.revokeObjectURL(fileUrl)), [fileUrl]);
  const maxMb = Math.floor(config.limits.maxUploadBytes / 1024 / 1024);

  // ─── Upload ───
  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setRangeError(null);
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        setError('Please choose a PDF file.');
        return;
      }
      if (file.size > config.limits.maxUploadBytes) {
        setError(`This file is too large. The limit is ${maxMb} MB.`);
        return;
      }

      setFileName(file.name);
      setFileUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      setPhase('uploading');
      setProgress(0);
      try {
        // A new file always starts a fresh draft; an abandoned one simply expires.
        const created = await createOrder(shop.id, options);
        saveTrackingToken(created.order.id, created.trackingToken);
        setToken(created.trackingToken);
        setOrder(created.order);

        const upload = await requestUploadUrl(created.order.id, file.size, created.trackingToken);
        await uploadToSignedUrl(upload, file, setProgress);
        setPhase('validating');
        setReviewing(false);
        const validated = await completeUpload(
          created.order.id,
          upload.fileId,
          created.trackingToken,
        );
        setOrder(validated);
        setPhase('ready');
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'PAGE_RANGE_INVALID') {
          // The file is fine; only the page range doesn't fit this document.
          setRangeError(err.message);
          setPhase('ready');
          return;
        }
        setError(messageOf(err));
        setFileName(null);
        setOrder(null);
        setPhase('idle');
      }
    },
    [config.limits.maxUploadBytes, maxMb, options, shop.id],
  );

  // ─── Options → server re-quote (debounced, stale responses ignored) ───
  const changeOptions = (patch: Partial<PrintOptions>) => setOptions((o) => ({ ...o, ...patch }));

  useEffect(() => {
    if (!order || !token || phase !== 'ready') return;
    const seq = ++requestSeq.current;
    setRequoting(true);
    const timer = setTimeout(async () => {
      try {
        const updated = await updateOptions(order.id, options, token);
        if (seq !== requestSeq.current) return;
        setOrder(updated);
        setRangeError(null);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        if (err instanceof ApiRequestError && err.code === 'PAGE_RANGE_INVALID') {
          setRangeError(err.message);
        } else {
          setError(messageOf(err));
        }
      } finally {
        if (seq === requestSeq.current) setRequoting(false);
      }
    }, 400);
    return () => clearTimeout(timer);
    // Deliberately keyed on options only: re-quote when the customer changes something,
    // not when the order object itself updates.
  }, [options]);

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
    phase === 'ready' &&
    order?.status === 'AWAITING_PAYMENT' &&
    !!quote &&
    !requoting &&
    !rangeError;

  return (
    <section>
      <p className="text-[13px] font-medium text-text-secondary">{shop.name}</p>
      <h1 className="mac-title mt-0.5">{reviewing ? 'Review your order' : 'New order'}</h1>

      {reviewing && quote && order ? (
        <ReviewStep
          shop={shop}
          order={order}
          fileName={fileName}
          fileUrl={fileUrl}
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
          <UploadCard
            phase={phase}
            progress={progress}
            fileName={fileName}
            pageCount={order?.file?.pageCount ?? null}
            maxMb={maxMb}
            maxPages={config.limits.maxPages}
            onFile={handleFile}
          />
          {error && <Notice tone="red">{error}</Notice>}

          <Group title="Print options">
            <Row label="Copies">
              <Stepper
                label="copies"
                value={options.copies}
                min={1}
                max={config.limits.maxCopies}
                onChange={(copies) => changeOptions({ copies })}
              />
            </Row>
            <Row
              label="Colour"
              hint={!shop.capabilities.colour ? 'Not available at this shop' : undefined}
            >
              <SegmentedControl
                label="Colour"
                value={options.colour ? 'colour' : 'bw'}
                options={[
                  { value: 'bw', label: 'B/W' },
                  { value: 'colour', label: 'Colour', disabled: !shop.capabilities.colour },
                ]}
                onChange={(v) => changeOptions({ colour: v === 'colour' })}
              />
            </Row>
            <Row
              label="Sides"
              hint={!shop.capabilities.duplex ? 'Double-sided not available here' : undefined}
            >
              <SegmentedControl
                label="Sides"
                value={options.duplex ? 'double' : 'single'}
                options={[
                  { value: 'single', label: 'Single' },
                  { value: 'double', label: 'Double', disabled: !shop.capabilities.duplex },
                ]}
                onChange={(v) => changeOptions({ duplex: v === 'double' })}
              />
            </Row>
            <Row label="Pages" hint={rangeError ?? 'Leave empty for all pages, e.g. 1-3, 5'}>
              <TextField
                label="Page range"
                value={options.pageRange ?? ''}
                placeholder="All pages"
                error={rangeError}
                onChange={(pageRange) => changeOptions({ pageRange })}
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
                  hint={`${quote.printedSides} printed sides at ${formatPaise(quote.ratePaise)} each`}
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
                label={<span className="text-text-secondary">Upload a PDF to see the price</span>}
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

/** Final check before placing the order: file preview, every option, the total, how to pay. */
function ReviewStep({
  shop,
  order,
  fileName,
  fileUrl,
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
  fileName: string | null;
  fileUrl: string | null;
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
      {fileUrl && (
        <div className="mac-card mt-6 overflow-hidden">
          <object
            data={fileUrl}
            type="application/pdf"
            className="block h-[420px] w-full bg-bg"
            aria-label="File preview"
          >
            <div className="px-4 py-6 text-center text-[14px] text-text-secondary">
              Preview isn’t available in this browser.{' '}
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent"
              >
                Open your file
              </a>
            </div>
          </object>
        </div>
      )}

      <Group
        title="Summary"
        footer={
          <button type="button" onClick={onEdit} className="font-medium text-accent">
            Edit options
          </button>
        }
      >
        <Row label="Shop" hint={shop.address}>
          <span className="text-right text-[15px]">{shop.name}</span>
        </Row>
        <Row label="File" hint={`${order.file?.pageCount ?? quote.selectedPages} pages in the PDF`}>
          <span className="max-w-[55vw] truncate text-[15px]">{fileName ?? 'Your PDF'}</span>
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
            {o.colour ? 'Colour' : 'Black & white'} · {o.duplex ? 'Double-sided' : 'Single-sided'} ·
            A4
          </span>
        </Row>
        <Row
          label={<span className="font-semibold">Total</span>}
          hint={`${quote.printedSides} printed sides at ${formatPaise(quote.ratePaise)}`}
        >
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

function UploadCard({
  phase,
  progress,
  fileName,
  pageCount,
  maxMb,
  maxPages,
  onFile,
}: {
  phase: Phase;
  progress: number;
  fileName: string | null;
  pageCount: number | null;
  maxMb: number;
  maxPages: number;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = phase === 'uploading' || phase === 'validating' || phase === 'paying';

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
        const file = e.dataTransfer.files[0];
        if (file && !busy) onFile(file);
      }}
      className={cx(
        'mac-card mt-6 flex items-center gap-4 p-5 transition-colors',
        dragging && 'border-accent bg-accent/5',
      )}
    >
      <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-red/10 text-[11px] font-bold text-red">
        PDF
      </div>
      <div className="min-w-0 flex-1">
        {fileName ? (
          <>
            <div className="truncate text-[15px] font-semibold">{fileName}</div>
            <div className="mt-0.5 text-[13px] text-text-secondary">
              {phase === 'uploading' && `Uploading… ${Math.round(progress * 100)}%`}
              {phase === 'validating' && 'Checking your document…'}
              {(phase === 'ready' || phase === 'paying') &&
                pageCount !== null &&
                `${pageCount} page${pageCount === 1 ? '' : 's'} · ready to print`}
            </div>
            {phase === 'uploading' && (
              <div className="mt-2">
                <ProgressBar value={progress} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-[15px] font-semibold">Choose a PDF to print</div>
            <div className="mt-0.5 text-[13px] text-text-secondary">
              Drop it here or browse · up to {maxMb} MB, {maxPages} pages
            </div>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Choose a PDF"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="shrink-0 rounded-full border border-separator bg-surface px-4 py-1.5 text-[13px] font-semibold text-accent transition-colors hover:bg-selection disabled:opacity-40"
      >
        {busy ? <Spinner /> : fileName ? 'Replace' : 'Browse'}
      </button>
    </div>
  );
}

function messageOf(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';
}
