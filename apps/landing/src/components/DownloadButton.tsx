import { SHOP_APP_DOWNLOAD_URL } from '@/lib/site';
import { icons } from './icons';

/**
 * "Download for Windows" — links straight to the Velopack Setup.exe in the release bucket.
 * Until NEXT_PUBLIC_SHOP_APP_RELEASES_URL is set it renders a disabled "Coming soon" button,
 * never a dead link.
 */
export function DownloadButton({
  variant = 'primary',
  label = 'Download for Windows',
  compact = false,
}: {
  variant?: 'primary' | 'secondary';
  label?: string;
  compact?: boolean;
}) {
  const cls = `${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}${compact ? ' !px-3.5 !py-1.5 !text-[13px]' : ''}`;

  if (!SHOP_APP_DOWNLOAD_URL) {
    return (
      <span
        aria-disabled
        className={`${cls} btn-disabled`}
        title="The installer is not published yet"
      >
        {icons.windows}
        {compact ? 'Coming soon' : `${label} · Coming soon`}
      </span>
    );
  }
  return (
    <a href={SHOP_APP_DOWNLOAD_URL} className={cls} rel="nofollow">
      {icons.windows}
      {label}
    </a>
  );
}
