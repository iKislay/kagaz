'use client';

import jsQR from 'jsqr';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { shopFromScannedText } from '@kagaz/shared';
import { Spinner, cx } from '@/components/ui';

type CameraState = 'starting' | 'live' | 'unavailable';

/** Longest side of the frame we decode: plenty for a QR, cheap on phones. */
const DECODE_SIZE = 640;
const SCAN_EVERY_MS = 150;

/**
 * "Scan QR" (header button + sheet). Reads the shop QR printed on the counter poster with the
 * phone camera and opens that shop's order page. Only Kagaz shop links are followed
 * (shopFromScannedText) — never a foreign URL from a QR. When the camera can't be used (no
 * HTTPS, permission denied, desktop without a camera) the customer can take or pick a photo.
 */
export function ScanQrButton({ variant = 'toolbar' }: { variant?: 'toolbar' | 'card' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'toolbar' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-separator bg-surface px-3 py-1 text-[13px] font-semibold text-accent transition-colors hover:bg-selection"
          aria-label="Scan a shop QR code"
        >
          <QrIcon className="size-4" />
          Scan QR
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mac-button">
          <QrIcon className="size-[18px]" />
          Scan shop QR
        </button>
      )}
      {open && <ScannerSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function ScannerSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [message, setMessage] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const doneRef = useRef(false);

  /** Decode one image; returns true when it was a Kagaz shop code (and navigates). */
  const handleImage = useCallback(
    (source: CanvasImageSource, width: number, height: number): boolean => {
      if (!width || !height) return false;
      const scale = Math.min(1, DECODE_SIZE / Math.max(width, height));
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const canvas = (canvasRef.current ??= document.createElement('canvas'));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(source, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {
        inversionAttempts: 'attemptBoth',
      });
      if (!code?.data) return false;
      const shop = shopFromScannedText(code.data);
      if (!shop) {
        setMessage(
          'That QR code isn’t a Kagaz shop code. Look for the “Scan to print here” poster.',
        );
        return false;
      }
      doneRef.current = true;
      setGoing(true);
      router.push(`/order/new?shop=${encodeURIComponent(shop)}`);
      return true;
    },
    [router],
  );

  // Camera: rear camera, decode a frame every SCAN_EVERY_MS until a shop code is found.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = () => {
      const video = videoRef.current;
      if (cancelled || doneRef.current || !video) return;
      if (video.readyState >= 2 && handleImage(video, video.videoWidth, video.videoHeight)) return;
      timer = setTimeout(tick, SCAN_EVERY_MS);
    };

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCamera('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setCamera('live');
        tick();
      } catch {
        if (!cancelled) setCamera('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [handleImage]);

  // Esc closes; the page behind doesn't scroll while the sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    try {
      const bitmap = await createImageBitmap(file);
      const found = handleImage(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      if (!found) {
        setMessage((m) => m ?? 'No QR code found in that photo. Try again, a little closer.');
      }
    } catch {
      setMessage('Couldn’t read that photo. Please try another one.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan a shop QR code"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md overflow-hidden rounded-t-[18px] bg-surface shadow-2xl sm:rounded-[18px]">
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div>
            <h2 className="text-[17px] font-semibold">Scan shop QR</h2>
            <p className="text-[13px] text-text-secondary">
              Point at the QR code on the shop counter.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-[14px] font-semibold text-accent hover:bg-selection"
          >
            Close
          </button>
        </div>

        <div className="relative mx-5 aspect-square overflow-hidden rounded-[14px] bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            className={cx('size-full object-cover', camera !== 'live' && 'invisible')}
          />
          {camera === 'live' && <Viewfinder />}
          {camera === 'starting' && (
            <div className="absolute inset-0 grid place-items-center text-[14px] text-white/80">
              <span className="flex items-center gap-2">
                <Spinner /> Starting camera…
              </span>
            </div>
          )}
          {camera === 'unavailable' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-[14px] text-white/85">
              <div>
                <QrIcon className="mx-auto mb-3 size-10 opacity-70" />
                The camera isn’t available here. Take a photo of the QR code instead.
              </div>
            </div>
          )}
          {going && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 text-[15px] font-semibold text-white">
              <span className="flex items-center gap-2">
                <Spinner /> Opening shop…
              </span>
            </div>
          )}
        </div>

        <div className="px-5 pt-3 pb-5">
          {message && (
            <p role="status" className="mb-3 rounded-xl bg-orange/12 px-3 py-2 text-[13px]">
              {message}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Take or choose a photo of the QR code"
            onChange={(e) => {
              void onPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cx(
              'w-full',
              camera === 'unavailable'
                ? 'mac-button'
                : 'rounded-full border border-separator py-2 text-[14px] font-semibold text-accent hover:bg-selection',
            )}
          >
            Take a photo of the QR instead
          </button>
        </div>
      </div>
    </div>
  );
}

function Viewfinder() {
  const corner = 'absolute size-12 border-white';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-[14%]">
      <span className={cx(corner, 'top-0 left-0 rounded-tl-2xl border-t-4 border-l-4')} />
      <span className={cx(corner, 'top-0 right-0 rounded-tr-2xl border-t-4 border-r-4')} />
      <span className={cx(corner, 'bottom-0 left-0 rounded-bl-2xl border-b-4 border-l-4')} />
      <span className={cx(corner, 'right-0 bottom-0 rounded-br-2xl border-r-4 border-b-4')} />
    </div>
  );
}

function QrIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.2" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1.2" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1.2" />
      <path d="M14.5 14.5h2.5v2.5M20.5 14.5v0M14.5 20.5h0M17 20.5h3.5V17" />
    </svg>
  );
}
