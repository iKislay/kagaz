'use client';

import jsQR from 'jsqr';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { shopPathFromQr } from '@kagaz/shared';

/** "Scan QR" button + full-screen camera scanner for the shop's counter QR code. */
export function QrScanButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="mac-button shrink-0" onClick={() => setOpen(true)}>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            d="M1.5 5V2.5a1 1 0 0 1 1-1H5M11 1.5h2.5a1 1 0 0 1 1 1V5M14.5 11v2.5a1 1 0 0 1-1 1H11M5 14.5H2.5a1 1 0 0 1-1-1V11"
            strokeLinecap="round"
          />
          <rect x="5" y="5" width="6" height="6" rx="1" />
        </svg>
        Scan QR
      </button>
      {open && <QrScanner onClose={() => setOpen(false)} />}
    </>
  );
}

function QrScanner({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('Point your camera at the QR code on the counter.');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const scan = () => {
      const v = video.current;
      if (stopped || !v || !ctx) return;
      if (v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
        const scale = Math.min(1, 640 / v.videoWidth); // decoding a smaller frame is plenty fast
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code) {
          const path = shopPathFromQr(code.data, window.location.origin);
          if (path) {
            stopped = true;
            router.push(path);
            return;
          }
          setMessage('That isn’t a Kaggaz shop code. Scan the QR code on the shop counter.');
        }
      }
      frame = requestAnimationFrame(scan);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        stream = s;
        if (stopped || !video.current) return;
        video.current.srcObject = s;
        void video.current.play();
        frame = requestAnimationFrame(scan);
      })
      .catch(() => {
        setFailed(true);
        setMessage(
          'Can’t open the camera. Allow camera access, or scan with your phone’s camera app.',
        );
      });
    if (!navigator.mediaDevices) {
      setFailed(true);
      setMessage('Scan the code with your phone’s camera app.');
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [router]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Scan QR code"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        {!failed && (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="size-[min(68vw,300px)] rounded-[28px] border-[3px] border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
      </div>
      <div className="bg-black px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center">
        <p className="text-[15px] text-white/90">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-full bg-white/15 px-6 py-2 text-[15px] font-semibold text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}
