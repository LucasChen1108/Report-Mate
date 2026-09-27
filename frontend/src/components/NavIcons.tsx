// NavIcons — small hand-drawn inline SVG icons for the navigation shell.
//
// Inline SVG (no icon-library dependency), all drawn on a 24x24 grid and
// inheriting the button's currentColor for stroke/fill, so the active/inactive
// nav coloring in AppLayout applies to them automatically. Kept intentionally
// simple and high-contrast for field-condition legibility.

import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
}

const base = (size: number): CSSProperties => ({
  display: "block",
  width: size,
  height: size,
});

// Shared SVG wrapper: outline style, round caps, inherits currentColor.
function Svg({ size = 24, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={base(size)}
    >
      {children}
    </svg>
  );
}

// Generate Report — a document with a pen/edit stroke (create/fill a report).
export function GenerateReportIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
      <path d="M8 8h5" />
      <path d="M8 12h4" />
      <path d="M17.5 3.5a1.75 1.75 0 0 1 2.5 2.5L15 11l-3 .8.8-3z" />
    </Svg>
  );
}

// My Reports — a stack of list rows (the reports list/dashboard).
export function MyReportsIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="8" y1="7" x2="20" y2="7" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="17" x2="20" y2="17" />
      <circle cx="4" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="17" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// Templates — stacked layers (template blocks).
export function TemplatesIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </Svg>
  );
}

// Workers — two people (team management).
export function WorkersIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5" />
      <path d="M18 14.5a6 6 0 0 1 3 5.5" />
    </Svg>
  );
}

// Profile — a single person.
export function ProfileIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

// Menu / overflow — three horizontal lines (the mobile header menu).
export function MenuIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </Svg>
  );
}

// Logout — a door with an arrow leaving it.
export function LogoutIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" />
      <path d="M16 8l4 4-4 4" />
      <line x1="20" y1="12" x2="10" y2="12" />
    </Svg>
  );
}
