/**
 * Order tracking tokens on this device. The API also sets an httpOnly cookie; we keep a copy
 * so the tracking page can build a shareable link (token in the URL fragment, which is never
 * sent to any server). Storage can be unavailable (private mode) — always fail soft.
 */
const key = (orderId: string) => `kgz_t_${orderId}`;

export function saveTrackingToken(orderId: string, token: string): void {
  try {
    localStorage.setItem(key(orderId), token);
  } catch {
    /* storage unavailable */
  }
}

export function loadTrackingToken(orderId: string): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('t');
  if (fromHash) {
    saveTrackingToken(orderId, fromHash);
    return fromHash;
  }
  try {
    return localStorage.getItem(key(orderId));
  } catch {
    return null;
  }
}

export function trackingUrl(orderId: string, token: string): string {
  return `${window.location.origin}/order/${orderId}#t=${encodeURIComponent(token)}`;
}
