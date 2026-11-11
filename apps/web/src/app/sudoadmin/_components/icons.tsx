/** Extra line icons for the console (same style as admin/_components/icons.tsx). */
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

export const sudoIcons = {
  plans: (
    <Icon>
      <path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" />
    </Icon>
  ),
  admins: (
    <Icon>
      <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3zM12 8a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM8 17c.8-1.6 2.2-2.4 4-2.4s3.2.8 4 2.4" />
    </Icon>
  ),
  external: (
    <Icon>
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </Icon>
  ),
  plus: (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
};
