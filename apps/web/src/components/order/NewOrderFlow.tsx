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
  removeFile,
  reorderFiles,
  requestUploadUrl,
  updateOptions,
  uploadToSignedUrl,
} from '@/lib/api';
import { pdfThumbnail } from '@/lib/pdf-render';
import { saveTrackingToken } from '@/lib/tracking';
import { type FileCard, FileCards, isBusy } from './FileCards';
import { PrintPreview } from './PrintPreview';

const DEFAULT_OPTIONS: PrintOptions = {
  copies: 1,
  colour: false,
  duplex: false,
  paperSize: 'A4',
  pageRange: '',
};

/** Uploads running at once; the rest wait their turn on their card. */
const PARALLEL_UPLOADS = 2;

/** Quick client-side hint only; the API decides by content (CLAUDE.md invariant 11). */
function kindOf(file: File): FileCard['kind'] | 'heic' | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/.test(name)) {
    return 'image';
  }
  if (/^image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/.test(name)) return 'heic';
  return null;
}

/** Newer server state wins (responses of parallel requests can arrive out of order). */
const newer = (prev: PublicOrder | null, next: PublicOrder) =>
  !prev || Date.parse(next.updatedAt) >= Date.parse(prev.updatedAt) ? next : prev;

/**
 * PRD journey 6.1 with several files (ADR-005): pick PDFs and photos → options → server quote over
 * all pages → print preview → pay. The browser never computes or sends a price.
 */
export function NewOrderFlow({ shop, config }: { shop: ShopSummary; config: PublicConfig }) {
  const router = useRouter();
  const [options, setOptions] = useState<PrintOptions>(DEFAULT_OPTIONS);
  const [cards, setCards] = useState<FileCard[]>([]);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [requoting, setRequoting] = useState(false);
  const [requoteNonce, setRequoteNonce] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [paying, setPaying] = useState(false);

  const isDemo = config.paymentMode === 'DEMO';
  const atCounter = config.paymentMode === 'COUNTER';
  const maxMb = Math.floor(config.limits.maxUploadBytes / 1024 / 1024);
  const maxFiles = config.limits.maxFiles;

  // Refs for async work that outlives a render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const orderPromise = useRef<Promise<{ id: string; token: string }> | null>(null);
  const files = useRef(new Map<string, File>());
  const aborts = useRef(new Map<string, AbortController>());
  const started = useRef(new Set<string>());
  const requestSeq = useRef(0);

  const applyOrder = useCallback((next: PublicOrder) => setOrder((prev) => newer(prev, next)), []);
  const patch = useCallback(
    (key: string, p: Partial<FileCard>) =>
      setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c))),
    [],
  );

  // Revoke thumbnails on unmount.
  useEffect(
    () => () => {
      for (const c of cardsRef.current) if (c.thumb) URL.revokeObjectURL(c.thumb);
      for (const a of aborts.current.values()) a.abort();
    },
    [],
  );

  // Pages per card come from the API's file list.
  useEffect(() => {
    if (!order) return;
    const byId = new Map(order.files.map((f) => [f.id, f]));
    setCards((cs) => {
      let changed = false;
      const next = cs.map((c) => {
        const f = c.fileId ? byId.get(c.fileId) : undefined;
        if (!f || (f.pageCount === c.pageCount && f.firstPage === c.firstPage)) return c;
        changed = true;
        return { ...c, pageCount: f.pageCount, firstPage: f.firstPage };
      });
      return changed ? next : cs;
    });
  }, [order]);

  /** The draft order is created with the first file; every upload shares it. */
  const ensureOrder = useCallback(() => {
    orderPromise.current ??= createOrder(shop.id, optionsRef.current).then(
      (created) => {
        saveTrackingToken(created.order.id, created.trackingToken);
        setToken(created.trackingToken);
        applyOrder(created.order);
        return { id: created.order.id, token: created.trackingToken };
      },
      (err: unknown) => {
        orderPromise.current = null;
        throw err;
      },
    );
    return orderPromise.current;
  }, [applyOrder, shop.id]);

  // ─── Upload one card: signed URL → PUT with progress → server validation ───
  const startUpload = useCallback(
    async (key: string) => {
      const file = files.current.get(key);
      if (!file) return;
      const ctrl = new AbortController();
      aborts.current.set(key, ctrl);
      patch(key, { status: 'uploading', progress: 0 });
      try {
        const { id, token } = await ensureOrder();
        const upload = await requestUploadUrl(id, file.size, token);
        const fileId = upload.fileId;
        if (ctrl.signal.aborted) {
          void removeFile(id, fileId, token).then(applyOrder, () => undefined);
          return;
        }
        patch(key, { fileId });
        await uploadToSignedUrl(upload, file, (progress) => patch(key, { progress }), ctrl.signal);
        patch(key, { status: 'checking', progress: 1 });
        const validated = await completeUpload(id, upload.fileId, token);
        applyOrder(validated);
        patch(key, { status: 'ready' });
      } catch (err) {
        if (ctrl.signal.aborted) return; // cancelled by the customer; the card is gone
        if (err instanceof ApiRequestError && err.code === 'PAGE_RANGE_INVALID') {
          // The file is fine; only the page range doesn't fit the document any more.
          patch(key, { status: 'ready' });
          setRangeError(err.message);
          const ids = await orderPromise.current;
          if (ids) void getOrder(ids.id, ids.token).then(applyOrder, () => undefined);
          return;
        }
        patch(key, { status: 'error', error: messageOf(err) });
      } finally {
        aborts.current.delete(key);
      }
    },
    [applyOrder, ensureOrder, patch],
  );

  // Start queued uploads, a few at a time.
  useEffect(() => {
    const running = cards.filter((c) => c.status === 'uploading' || c.status === 'checking');
    const free = PARALLEL_UPLOADS - running.length;
    if (free <= 0) return;
    for (const c of cards.filter((c) => c.status === 'queued').slice(0, free)) {
      if (started.current.has(c.key)) continue;
      started.current.add(c.key);
      void startUpload(c.key);
    }
  }, [cards, startUpload]);

  // ─── Add / remove / reorder ───
  const addFiles = (picked: File[]) => {
    setError(null);
    const room = maxFiles - cardsRef.current.filter((c) => c.status !== 'error').length;
    if (picked.length > room) {
      setError(`An order can have at most ${maxFiles} files. Only the first ${room} were added.`);
    }
    const added: FileCard[] = picked.slice(0, Math.max(0, room)).map((file) => {
      const key = crypto.randomUUID();
      const kind = kindOf(file);
      const card: FileCard = {
        key,
        name: file.name,
        kind: kind === 'pdf' ? 'pdf' : kind === 'image' || kind === 'heic' ? 'image' : 'other',
        thumb: kind === 'image' ? URL.createObjectURL(file) : null,
        status: 'queued',
        progress: 0,
        fileId: null,
        pageCount: null,
        firstPage: null,
        error: null,
      };
      if (kind === 'heic') {
        return {
          ...card,
          kind: 'image',
          status: 'error',
          error: 'HEIC photos aren’t supported yet. Save it as JPEG and add it again.',
        };
      }
      if (!kind) {
        return {
          ...card,
          status: 'error',
          error: 'Only PDFs and photos (JPEG, PNG, WebP). Save Word files as PDF first.',
        };
      }
      if (file.size > config.limits.maxUploadBytes) {
        return { ...card, status: 'error', error: `Too large. The limit is ${maxMb} MB per file.` };
      }
      files.current.set(key, file);
      if (kind === 'pdf') {
        void pdfThumbnail(file).then(
          (thumb) => patch(key, { thumb }),
          () => undefined,
        );
      }
      return card;
    });
    setCards((cs) => [...cs, ...added]);
  };

  const remove = (key: string) => {
    const card = cardsRef.current.find((c) => c.key === key);
    if (!card) return;
    aborts.current.get(key)?.abort();
    files.current.delete(key);
    if (card.thumb) URL.revokeObjectURL(card.thumb);
    setCards((cs) => cs.filter((c) => c.key !== key));
    if (!card.fileId || card.status === 'error') return;
    void (async () => {
      const ids = await orderPromise.current;
      if (!ids) return;
      try {
        const updated = await removeFile(ids.id, card.fileId!, ids.token);
        applyOrder(updated);
        // Files left but no price: the page range no longer fits — ask the server why.
        if (updated.files.length && !updated.quote) setRequoteNonce((n) => n + 1);
        else setRangeError(null);
      } catch (err) {
        setError(messageOf(err));
      }
    })();
  };

  const move = (key: string, to: number) =>
    setCards((cs) => {
      const from = cs.findIndex((c) => c.key === key);
      if (from === -1 || to < 0 || to >= cs.length || from === to) return cs;
      const next = [...cs];
      const [card] = next.splice(from, 1);
      next.splice(to, 0, card!);
      return next;
    });

  const saveOrder = () => {
    void (async () => {
      const ids = await orderPromise.current;
      const fileIds = cardsRef.current.flatMap((c) => (c.fileId ? [c.fileId] : []));
      if (!ids || fileIds.length < 2) return;
      try {
        applyOrder(await reorderFiles(ids.id, fileIds, ids.token));
      } catch (err) {
        setError(messageOf(err));
      }
    })();
  };

  // ─── Options → server re-quote (debounced, stale responses ignored) ───
  const changeOptions = (p: Partial<PrintOptions>) => setOptions((o) => ({ ...o, ...p }));
  const orderId = order?.id ?? null;

  useEffect(() => {
    if (!orderId || !token) return;
    const seq = ++requestSeq.current;
    setRequoting(true);
    const timer = setTimeout(async () => {
      try {
        const updated = await updateOptions(orderId, options, token);
        if (seq !== requestSeq.current) return;
        applyOrder(updated);
        setRangeError(null);
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
    // Keyed on what the customer changes, not on every order update.
  }, [options, orderId, token, requoteNonce]);

  // ─── Pay ───
  const pay = async () => {
    if (!order || !token) return;
    setPaying(true);
    setError(null);
    try {
      const res = await payOrder(order.id, token);
      router.push(`/order/${res.order.id}#t=${encodeURIComponent(token)}`);
    } catch (err) {
      setError(messageOf(err));
      // P2.5: the shop changed its prices — show the new server quote before paying again.
      if (err instanceof ApiRequestError && err.code === 'PRICE_CHANGED') {
        await getOrder(order.id, token).then(applyOrder, () => undefined);
      }
      setPaying(false);
    }
  };

  const uploading = cards.some(isBusy);
  const readyCount = cards.filter((c) => c.status === 'ready').length;
  const failedCount = cards.filter((c) => c.status === 'error').length;
  const quote = readyCount ? (order?.quote ?? null) : null;
  const canContinue =
    order?.status === 'AWAITING_PAYMENT' &&
    !!quote &&
    readyCount > 0 &&
    !uploading &&
    !requoting &&
    !rangeError;

  return (
    <section>
      <p className="text-[13px] font-medium text-text-secondary">{shop.name}</p>
      <h1 className="mac-title mt-0.5">{reviewing ? 'Review your order' : 'New order'}</h1>

      {reviewing && order && token && quote ? (
        <ReviewStep
          shop={shop}
          order={order}
          token={token}
          cards={cards}
          isDemo={isDemo}
          atCounter={atCounter}
          paying={paying}
          canPay={canContinue && !paying}
          error={error}
          onEdit={() => setReviewing(false)}
          onPay={pay}
        />
      ) : (
        <>
          <FileCards
            cards={cards}
            maxFiles={maxFiles}
            maxMb={maxMb}
            maxPages={config.limits.maxPages}
            disabled={paying}
            onAdd={addFiles}
            onRemove={remove}
            onMove={move}
            onReorderDone={saveOrder}
          />
          {error && <Notice tone="red">{error}</Notice>}
          {failedCount > 0 && readyCount > 0 && (
            <p className="mt-2 px-4 text-[12px] text-text-secondary">
              Files that can’t be printed aren’t part of the order. Remove them or add a fixed copy.
            </p>
          )}

          <Group title="Print options" footer="These apply to all files.">
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
            <Row
              label="Pages"
              hint={
                rangeError ??
                (cards.length > 1
                  ? 'All files count as one document, e.g. 1-3, 5'
                  : 'Leave empty for all pages, e.g. 1-3, 5')
              }
            >
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
                      (requoting || uploading) && 'opacity-40',
                    )}
                  >
                    {formatPaise(quote.totalPaise)}
                  </span>
                </Row>
              </>
            ) : (
              <Row
                label={
                  <span className="flex items-center gap-2 text-text-secondary">
                    {uploading && <Spinner />}
                    {uploading
                      ? 'Checking your files…'
                      : rangeError
                        ? 'Fix the page range to see the price'
                        : 'Add a file to see the price'}
                  </span>
                }
              />
            )}
          </Group>

          <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            {uploading && (
              <span className="text-center text-[13px] text-text-secondary sm:mr-2">
                Waiting for uploads to finish…
              </span>
            )}
            <button
              type="button"
              className="mac-button disabled:opacity-40"
              disabled={!canContinue}
              onClick={() => {
                setError(null);
                setReviewing(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Preview & continue{quote ? ` · ${formatPaise(quote.totalPaise)}` : ''}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Final check before placing the order: print preview, every option, the total, how to pay. */
function ReviewStep({
  shop,
  order,
  token,
  cards,
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
  token: string;
  cards: FileCard[];
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
  const ready = cards.filter((c) => c.status === 'ready');
  const total = order.file?.pageCount ?? quote.selectedPages;
  return (
    <>
      <PrintPreview order={order} token={token} />

      <Group
        title="Summary"
        footer={
          <button type="button" onClick={onEdit} className="font-medium text-accent">
            Edit files or options
          </button>
        }
      >
        <Row label="Shop" hint={shop.address}>
          <span className="text-right text-[15px]">{shop.name}</span>
        </Row>
        <Row
          label={ready.length === 1 ? 'File' : 'Files'}
          hint={`${total} page${total === 1 ? '' : 's'} in total`}
        >
          <span className="block max-w-[50vw] truncate text-right text-[15px] sm:max-w-[320px]">
            {ready.length === 1 ? ready[0]!.name : `${ready.length} files`}
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
          You get a pickup number right away. The shop checks your files and prints them. Tell them
          your number and pay at the counter.
        </p>
      )}
    </>
  );
}

function messageOf(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';
}
