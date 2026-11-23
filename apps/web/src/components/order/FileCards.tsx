'use client';

import { useRef, useState } from 'react';
import { UPLOAD_ACCEPT } from '@kagaz/shared';
import { ProgressBar, Spinner, cx } from '@/components/ui';

export type CardStatus = 'queued' | 'uploading' | 'checking' | 'ready' | 'error';

/** One file the customer picked, as shown on its card (the browser keeps the name; the API never sees it). */
export interface FileCard {
  key: string;
  name: string;
  kind: 'pdf' | 'image' | 'other';
  /** Local preview image (object URL) or null while it renders / when it can't. */
  thumb: string | null;
  status: CardStatus;
  progress: number;
  /** Server file id once the upload URL was issued. */
  fileId: string | null;
  pageCount: number | null;
  /** First page in the combined document (from the API). */
  firstPage: number | null;
  error: string | null;
}

const BUSY: readonly CardStatus[] = ['queued', 'uploading', 'checking'];
export const isBusy = (c: FileCard) => BUSY.includes(c.status);

/**
 * Picked files as cards (iLovePDF-style): thumbnail, name, pages or progress, remove / cancel,
 * drag to reorder (arrow buttons for keyboard), drop more files anywhere, and an "Add" tile.
 */
export function FileCards({
  cards,
  maxFiles,
  maxMb,
  maxPages,
  disabled,
  onAdd,
  onRemove,
  onMove,
  onReorderDone,
}: {
  cards: FileCard[];
  maxFiles: number;
  maxMb: number;
  maxPages: number;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  /** Move a card to `toIndex` (live, while dragging or via arrows). */
  onMove: (key: string, toIndex: number) => void;
  /** Persist the new order (drag ended / arrow pressed). */
  onReorderDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const full = cards.filter((c) => c.status !== 'error').length >= maxFiles;

  const browse = () => inputRef.current?.click();
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <div
      onDragOver={(e) => {
        if (!hasFiles(e) || disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        if (!disabled) onAdd(Array.from(e.dataTransfer.files));
      }}
      className={cx(
        'mac-card mt-6 p-4 transition-colors',
        dropping && 'border-accent bg-accent/5 ring-2 ring-accent/30',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        aria-label="Choose files to print"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onAdd(files);
        }}
      />

      {cards.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <DocIcon />
          <div className="mt-3 text-[17px] font-semibold">Choose files to print</div>
          <div className="mt-1 max-w-sm text-[13px] text-text-secondary">
            PDFs and photos (JPEG, PNG, WebP). Select several at once or drop them here. Up to{' '}
            {maxFiles} files, {maxMb} MB each, {maxPages} pages in total.
          </div>
          <button type="button" className="mac-button mt-5" disabled={disabled} onClick={browse}>
            Choose files
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div className="text-[13px] text-text-secondary">
              {cards.length} file{cards.length === 1 ? '' : 's'} · drag to change the print order
            </div>
            <button
              type="button"
              disabled={disabled || full}
              onClick={browse}
              className="shrink-0 rounded-full border border-separator bg-surface px-3.5 py-1 text-[13px] font-semibold text-accent transition-colors hover:bg-selection disabled:opacity-40"
            >
              Add files
            </button>
          </div>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" aria-label="Files">
            {cards.map((card, index) => (
              <li
                key={card.key}
                draggable={!disabled && card.status !== 'error'}
                onDragStart={(e) => {
                  setDragKey(card.key);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', card.key);
                }}
                onDragOver={(e) => {
                  if (!dragKey || hasFiles(e)) return;
                  e.preventDefault();
                  if (dragKey !== card.key) onMove(dragKey, index);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  onReorderDone();
                }}
                className={cx(
                  'group relative flex flex-col rounded-xl border border-separator bg-surface p-2 transition-shadow',
                  !disabled && card.status !== 'error' && 'cursor-grab active:cursor-grabbing',
                  dragKey === card.key && 'opacity-50 shadow-lg',
                )}
              >
                <Card
                  card={card}
                  index={index}
                  count={cards.length}
                  disabled={disabled}
                  onRemove={() => onRemove(card.key)}
                  onMove={(to) => {
                    onMove(card.key, to);
                    onReorderDone();
                  }}
                />
              </li>
            ))}
            {!full && (
              <li>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={browse}
                  className="flex aspect-[3/4] h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-separator text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  <span className="text-[28px] leading-none font-light">+</span>
                  <span className="text-[13px] font-medium">Add more</span>
                </button>
              </li>
            )}
          </ol>
        </>
      )}
    </div>
  );
}

function Card({
  card,
  index,
  count,
  disabled,
  onRemove,
  onMove,
}: {
  card: FileCard;
  index: number;
  count: number;
  disabled: boolean;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const busy = isBusy(card);
  return (
    <>
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-bg">
        {card.thumb ? (
          <img
            src={card.thumb}
            alt=""
            draggable={false}
            className={cx(
              'h-full w-full object-contain',
              card.kind === 'pdf' && 'bg-white shadow-sm',
              busy && 'opacity-60',
            )}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <span
              className={cx(
                'rounded-lg px-2 py-1 text-[11px] font-bold',
                card.kind === 'pdf'
                  ? 'bg-red/10 text-red'
                  : card.kind === 'image'
                    ? 'bg-accent/10 text-accent'
                    : 'bg-selection text-text-secondary',
              )}
            >
              {card.kind === 'pdf' ? 'PDF' : card.kind === 'image' ? 'IMG' : 'FILE'}
            </span>
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 grid min-w-5 place-items-center rounded-full bg-black/55 px-1.5 text-[11px] font-semibold text-white tabular-nums">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`${busy ? 'Cancel upload of' : 'Remove'} ${card.name}`}
          title={busy ? 'Cancel upload' : 'Remove'}
          className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/55 text-white transition-colors hover:bg-red focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        >
          <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {(card.status === 'checking' || card.status === 'queued') && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner />
          </div>
        )}
      </div>

      <div className="mt-2 min-w-0 px-0.5">
        <div className="truncate text-[13px] font-medium" title={card.name}>
          {card.name}
        </div>
        <div
          className={cx(
            'mt-0.5 truncate text-[12px]',
            card.status === 'error' ? 'text-red' : 'text-text-secondary',
          )}
          title={card.error ?? undefined}
          aria-live="polite"
        >
          {statusLine(card)}
        </div>
        {card.status === 'uploading' && (
          <div className="mt-1.5">
            <ProgressBar value={card.progress} />
          </div>
        )}
        {card.status === 'error' && card.error && (
          <p className="mt-1 text-[12px] leading-snug text-red">{card.error}</p>
        )}
      </div>

      {card.status !== 'error' && count > 1 && (
        <div className="mt-1 flex justify-between opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <MoveButton
            label={`Move ${card.name} earlier`}
            disabled={disabled || index === 0}
            onClick={() => onMove(index - 1)}
            flip
          />
          <MoveButton
            label={`Move ${card.name} later`}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(index + 1)}
          />
        </div>
      )}
    </>
  );
}

function statusLine(card: FileCard): string {
  switch (card.status) {
    case 'queued':
      return 'Waiting…';
    case 'uploading':
      return `Uploading… ${Math.round(card.progress * 100)}%`;
    case 'checking':
      return 'Checking…';
    case 'error':
      return 'Can’t print this file';
    case 'ready': {
      const n = card.pageCount ?? 0;
      const pages = `${n} page${n === 1 ? '' : 's'}`;
      if (card.kind === 'image') return `Photo · 1 A4 page`;
      return card.firstPage && card.firstPage > 1 && n
        ? `${pages} · p. ${card.firstPage}–${card.firstPage + n - 1}`
        : pages;
    }
  }
}

function MoveButton({
  label,
  disabled,
  onClick,
  flip,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  flip?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-full text-text-secondary hover:bg-selection hover:text-text disabled:invisible"
    >
      <svg viewBox="0 0 12 12" className={cx('size-3', flip && 'rotate-180')} aria-hidden>
        <path
          d="M4.5 2.5L8 6l-3.5 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-12 text-accent" aria-hidden>
      <rect x="9" y="5" width="24" height="32" rx="3" fill="currentColor" opacity=".14" />
      <rect
        x="15"
        y="11"
        width="24"
        height="32"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M21 21h12M21 27h12M21 33h7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
