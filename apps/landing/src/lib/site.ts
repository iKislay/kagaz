/**
 * Site settings for kaggaz.app. All values are NEXT_PUBLIC_* and baked in at BUILD time (static
 * export): change them in the host's build settings (or the root .env locally) and rebuild.
 * They are public by definition — never put secrets here.
 */

const trimSlash = (v: string) => v.replace(/\/+$/, '');
const env = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : null);

/** Customer ordering app (apps/web). */
export const CUSTOMER_APP_URL = trimSlash(
  env(process.env.NEXT_PUBLIC_CUSTOMER_APP_URL) ?? 'https://print.kaggaz.app',
);

/**
 * Public base URL of the shop-app release folder (Velopack output of
 * scripts/build-shop-agent-installer.ps1, uploaded by `pnpm release:shop-agent`), e.g. the
 * Cloudflare R2 public bucket URL. The same URL is the Windows app's UpdateFeedUrl.
 * Unset → the download buttons show "Coming soon".
 */
export const SHOP_APP_RELEASES_URL = (() => {
  const v = env(process.env.NEXT_PUBLIC_SHOP_APP_RELEASES_URL);
  return v ? trimSlash(v) : null;
})();

/** Installer file name produced by Velopack (packId "KagazShop", channel "win"). */
export const SHOP_APP_SETUP_FILE = 'KagazShop-win-Setup.exe';

export const SHOP_APP_DOWNLOAD_URL = SHOP_APP_RELEASES_URL
  ? `${SHOP_APP_RELEASES_URL}/${SHOP_APP_SETUP_FILE}`
  : null;

/** Optional contact details shown in the footer and CTAs. Hidden when unset. */
export const CONTACT_EMAIL = env(process.env.NEXT_PUBLIC_CONTACT_EMAIL);
export const CONTACT_PHONE = env(process.env.NEXT_PUBLIC_CONTACT_PHONE);

/** Where "Talk to us" buttons go: email if set, else phone, else the FAQ. */
export const CONTACT_HREF = CONTACT_EMAIL
  ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Kaggaz for my print shop')}`
  : CONTACT_PHONE
    ? `tel:${CONTACT_PHONE.replace(/\s+/g, '')}`
    : '/#faq';

export const BRAND = 'Kaggaz';
