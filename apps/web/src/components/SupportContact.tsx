import { type PublicConfig, formatIndianPhone } from '@kagaz/shared';

type Support = PublicConfig['support'];

export const hasSupport = (s: Support | null | undefined): s is Support =>
  !!s && !!(s.phone || s.whatsapp || s.email);

/**
 * Kaggaz support contact from GET /api/config (SUPPORT_* env on the API). Renders nothing when
 * none is configured — contact details are never invented.
 */
export function SupportContact({
  support,
  label = 'Contact Kaggaz:',
  className = '',
}: {
  support: Support | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!hasSupport(support)) return null;
  const link = 'font-medium text-forest underline-offset-2 hover:underline';
  const items = [
    support.phone && (
      <a key="phone" href={`tel:${support.phone}`} className={link}>
        {formatIndianPhone(support.phone)}
      </a>
    ),
    support.whatsapp && (
      <a
        key="wa"
        href={`https://wa.me/${support.whatsapp.replace(/\D/g, '')}`}
        target="_blank"
        rel="noreferrer"
        className={link}
      >
        WhatsApp
      </a>
    ),
    support.email && (
      <a key="email" href={`mailto:${support.email}`} className={link}>
        {support.email}
      </a>
    ),
  ].filter(Boolean);
  return (
    <span className={className}>
      {label}{' '}
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {item}
        </span>
      ))}
    </span>
  );
}
