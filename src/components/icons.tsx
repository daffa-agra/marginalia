import type { SVGProps } from 'react';

/**
 * Authored icon set: 16px box, 1.5 stroke, currentColor.
 * One set, one size, one stroke — no glyphs standing in for icons.
 */
const PATHS = {
  shelf: (
    <>
      <path d="M2 13.5h12" />
      <path d="M3.5 13.5V4a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v9.5" />
      <path d="M8.25 13.5V6.5H10.5v7" />
      <path d="m11.5 13.5 1.9-7.2" />
    </>
  ),
  quote: (
    <>
      <path d="M6.5 4.5c-1.8 0-3 1.3-3 3.1 0 1.6 1 2.6 2.4 2.6 1.2 0 2-.8 2-1.9 0-1-.7-1.7-1.7-1.7h-.3c0-.8.5-1.3 1.3-1.4" />
      <path d="M12.5 4.5c-1.8 0-3 1.3-3 3.1 0 1.6 1 2.6 2.4 2.6 1.2 0 2-.8 2-1.9 0-1-.7-1.7-1.7-1.7h-.3c0-.8.5-1.3 1.3-1.4" />
    </>
  ),
  chart: (
    <>
      <path d="M2 13.5h12" />
      <path d="M4.25 13.5V9.25h2.5v4.25" />
      <path d="M8.25 13.5V5.5h2.5v8" />
      <path d="M12.25 13.5v-6" />
    </>
  ),
  import: (
    <>
      <path d="M8 2.5v7" />
      <path d="m5.25 6.75 2.75 2.75 2.75-2.75" />
      <path d="M2.75 11.5v1.25a.75.75 0 0 0 .75.75h9a.75.75 0 0 0 .75-.75V11.5" />
    </>
  ),
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  /* Two arrows chasing each other: a sync, not a refresh (which implies loss). */
  sync: (
    <>
      <path d="M13 8a5 5 0 0 1-8.5 3.6" />
      <path d="M3 8a5 5 0 0 1 8.5-3.6" />
      <path d="M11.5 1.9v2.6H8.9" />
      <path d="M4.5 14.1v-2.6h2.6" />
    </>
  ),
  key: (
    <>
      <circle cx="5.25" cy="10.75" r="2.25" />
      <path d="m7 9 6-6" />
      <path d="m11.25 4.75 1.75 1.75" />
    </>
  ),
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  chevronDown: <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />,
  check: <path d="m3.25 8.5 3.25 3.25 6.25-7" />,
  back: <path d="M12.5 8H3.75M7.25 3.75 3 8l4.25 4.25" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  trash: (
    <>
      <path d="M3 4.75h10" />
      <path d="M6.25 4.75V3.5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25" />
      <path d="M4.5 4.75 5.25 13a.75.75 0 0 0 .75.65h4a.75.75 0 0 0 .75-.65l.75-8.25" />
      <path d="M6.75 7v4M9.25 7v4" />
    </>
  ),
  copy: (
    <>
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.25" />
      <path d="M10.25 5.75v-2a1 1 0 0 0-1-1H3.75a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h2" />
    </>
  ),
  edit: (
    <>
      <path d="M9.75 2.75 13.25 6.25 6 13.5H2.5v-3.5z" />
      <path d="m8.5 4 3.5 3.5" />
    </>
  ),
  star: (
    <path
      d="M8 2.4l1.72 3.62 3.9.53-2.85 2.69.72 3.86L8 11.26l-3.49 1.84.72-3.86L2.38 6.55l3.9-.53z"
      strokeWidth="1.4"
    />
  ),
  statusWant: <circle cx="8" cy="8" r="4.75" />,
  statusReading: (
    <>
      <circle cx="8" cy="8" r="4.75" />
      <path d="M8 3.25a4.75 4.75 0 0 1 0 9.5z" fill="currentColor" stroke="none" />
    </>
  ),
  statusFinished: <circle cx="8" cy="8" r="4.75" fill="currentColor" />,
  statusAbandoned: (
    <>
      <circle cx="8" cy="8" r="4.75" />
      <path d="m5.75 5.75 4.5 4.5" />
    </>
  ),
  undo: (
    <>
      <path d="M3 7.5h6.25a3.75 3.75 0 0 1 0 7.5H6" />
      <path d="M5.75 4.25 2.5 7.5l3.25 3.25" />
    </>
  ),
  alert: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.75" />
      <circle cx="8" cy="11" r=".75" fill="currentColor" stroke="none" />
    </>
  ),
  offline: (
    <>
      <path d="M2.5 8.5a7.5 7.5 0 0 1 3.1-2.3M11 6.4a7.5 7.5 0 0 1 2.5 2.1" />
      <path d="M5.25 10.9a4 4 0 0 1 4.2-.6" />
      <circle cx="8" cy="13" r=".9" fill="currentColor" stroke="none" />
      <path d="m2.5 2.5 11 11" />
    </>
  ),
  bookmark: (
    <path d="M4.25 2.75h7.5a.75.75 0 0 1 .75.75v9.75l-4.5-3-4.5 3V3.5a.75.75 0 0 1 .75-.75z" />
  ),
  menu: (
    <>
      <path d="M2.75 4.75h10.5M2.75 8h10.5M2.75 11.25h10.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
  ...rest
}: { name: IconName; size?: number; className?: string } & Omit<
  SVGProps<SVGSVGElement>,
  'name' | 'children'
>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The brand mark: an open book. The same inked rule reappears as the margin rule. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="brand-mark"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 4.4C8.2 3.2 5.9 3 3.6 3.7v11c2.3-.7 4.6-.5 6.4.7 1.8-1.2 4.1-1.4 6.4-.7v-11C14.1 3 11.8 3.2 10 4.4z" />
      <path d="M10 4.4v11" />
    </svg>
  );
}
