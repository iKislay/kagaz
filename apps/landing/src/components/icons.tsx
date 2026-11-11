/** Small line icons (1.6px stroke, currentColor) in the SF Symbols spirit. */
import type { ReactNode } from 'react';

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const icons = {
  upload: (
    <Icon>
      <path d="M12 15V4m0 0-4 4m4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Icon>
  ),
  sliders: (
    <Icon>
      <path d="M4 7h10m4 0h2M4 17h4m4 0h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Icon>
  ),
  card: (
    <Icon>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </Icon>
  ),
  printer: (
    <Icon>
      <path d="M7 9V4h10v5" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v6H7z" />
    </Icon>
  ),
  ticket: (
    <Icon>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
      <path d="M10 9.5h4M10 13h4" />
    </Icon>
  ),
  list: (
    <Icon>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </Icon>
  ),
  bolt: (
    <Icon>
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
    </Icon>
  ),
  shield: (
    <Icon>
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  lock: (
    <Icon>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>
  ),
  trash: (
    <Icon>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
    </Icon>
  ),
  rupee: (
    <Icon>
      <path d="M7 4h10M7 8.5h10M9 4c3.5 0 5 2 5 4.5S12.5 13 9 13H7l7 7" />
    </Icon>
  ),
  chart: (
    <Icon>
      <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
    </Icon>
  ),
  refresh: (
    <Icon>
      <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8m0-4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16m0 4v-4h-4" />
    </Icon>
  ),
  layers: (
    <Icon>
      <path d="m12 4 9 5-9 5-9-5z" />
      <path d="m3 14 9 5 9-5" />
    </Icon>
  ),
  eye: (
    <Icon>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  ),
  phone: (
    <Icon>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </Icon>
  ),
  pulse: (
    <Icon>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </Icon>
  ),
  check: (
    <Icon size={16}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  ),
  download: (
    <Icon size={18}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" />
    </Icon>
  ),
  arrow: (
    <Icon size={16}>
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </Icon>
  ),
  windows: (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
    </svg>
  ),
};

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[8px] bg-accent font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      K
    </span>
  );
}
