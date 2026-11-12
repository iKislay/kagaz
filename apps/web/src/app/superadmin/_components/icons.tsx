/** Small line icons for the admin source list (1.6px strokes, currentColor). */
import { type ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
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
  overview: (
    <Icon>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  ),
  shops: (
    <Icon>
      <path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6" />
    </Icon>
  ),
  metrics: (
    <Icon>
      <path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19v-4M3 21h18" />
    </Icon>
  ),
  billing: (
    <Icon>
      <path d="M3 6h18v12H3zM3 10h18M7 15h4" />
    </Icon>
  ),
  orders: (
    <Icon>
      <path d="M7 3h10l3 3v15H4V3h3zM8 9h8M8 13h8M8 17h5" />
    </Icon>
  ),
  health: (
    <Icon>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </Icon>
  ),
  reconciliation: (
    <Icon>
      <path d="M12 3v18M5 7h14M5 7l-3 7h6L5 7zM19 7l-3 7h6l-3-7zM8 21h8" />
    </Icon>
  ),
  audit: (
    <Icon>
      <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3zM9 12l2 2 4-4" />
    </Icon>
  ),
  demo: (
    <Icon>
      <path d="M9 3h6M10 3v6L4 19a1.5 1.5 0 001.3 2h13.4a1.5 1.5 0 001.3-2L14 9V3M7 15h10" />
    </Icon>
  ),
  logout: (
    <Icon>
      <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
    </Icon>
  ),
};
