/** Hosts whose printed shop QR codes the in-page scanner accepts (plus the current origin). */
const QR_HOSTS = /^(www\.)?kaggaz\.in$/;
const SHOP_PATH = /^\/s\/([a-z0-9][a-z0-9-]{1,48}[a-z0-9])\/?$/;

/**
 * A scanned QR text → the local path of a Kaggaz shop (`/s/<slug>`), or null for anything else.
 * Scanned text is untrusted: we never navigate to it, only to the path rebuilt from the slug.
 */
export function shopPathFromQr(text: string, currentOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.origin !== currentOrigin) return null;
  if (url.origin !== currentOrigin && !QR_HOSTS.test(url.hostname)) return null;
  const slug = SHOP_PATH.exec(url.pathname)?.[1];
  return slug ? `/s/${slug}` : null;
}
