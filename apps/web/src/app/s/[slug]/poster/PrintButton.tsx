'use client';

export function PrintButton() {
  return (
    <button type="button" className="mac-button" onClick={() => window.print()}>
      Print poster
    </button>
  );
}
