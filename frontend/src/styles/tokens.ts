// tokens.ts — the single source of truth for the mobile-first, high-contrast
// theme (task 12.1, Req 8.1–8.4).
//
// This module mirrors the CSS custom properties declared in theme.css. Keep the
// two in sync: theme.css exposes these values as `--rm-*` custom properties for
// stylesheets/JSX, and this module exposes the same values (plus a few helper
// style objects) as typed TS so inline React styles can consume the tokens
// instead of hardcoding their own values (per src/styles/README.md).
//
// Why both? Components in this codebase style with inline `style={...}` objects
// (no CSS-in-JS lib), so TS tokens are the ergonomic way for them to consume the
// theme; the CSS file provides the mobile-first RESET/base + custom properties
// for anything that prefers classes/`var(--rm-*)`.
//
// -----------------------------------------------------------------------------
// CONTRAST (Req 8.3): every text/control color below is paired with the
// background it is used against, and each pair meets WCAG 4.5:1. Computed
// ratios (relative-luminance formula) — verified in task 12.1:
//
//   text (#1a1a1a) on surface (#ffffff) ................. 17.40:1
//   text (#1a1a1a) on page bg (#f5f6f8) ................. 16.10:1
//   muted text (#4a5160) on surface (#ffffff) ...........  7.96:1
//   border (#3a3f4b) on surface (#ffffff) ............... 10.54:1
//   onPrimary (#ffffff) on primary (#14477f) ............  9.39:1
//   onPrimary (#ffffff) on primaryHover (#0d3560) ....... 12.39:1
//   onDanger (#ffffff) on danger (#a01b0e) ..............  7.90:1
//   danger text (#a01b0e) on surface (#ffffff) ..........  7.90:1
//   success text (#12692b) on surface (#ffffff) .........  6.82:1
//   seed badge text (#14477f) on seed bg (#e6f0fb) ......  8.14:1
//   text (#1a1a1a) on drop-highlight (#dbe8ff) .......... 14.09:1
//
// All pairs clear 4.5:1 with margin, keeping text legible in outdoor sun
// (the field-conditions goal in src/styles/README.md).
// -----------------------------------------------------------------------------

/**
 * MIN_TAP_TARGET — the minimum interactive control size in CSS pixels (Req 8.2).
 * Every button, input, drag handle, checkbox wrapper, and choice control uses
 * this as its min-width/min-height so tap targets are comfortably usable
 * one-handed / gloves-on.
 */
export const MIN_TAP_TARGET = 44;

/**
 * BASE_FONT_SIZE — the base body font size in CSS pixels. >=16px so mobile
 * browsers do not auto-zoom when focusing an input (Req 8.1).
 */
export const BASE_FONT_SIZE = 16;

/** Mobile-first breakpoints. Phone is the default (no media query); these are
 * min-width upgrades for wider viewports (Req 8.1). */
export const breakpoints = {
  /** small tablets / large phones landscape */
  sm: 600,
  /** tablets / small desktop */
  md: 900,
} as const;

/** High-contrast color palette (see the contrast table above). */
export const colors = {
  /** app page background (behind cards) */
  pageBg: "#f5f6f8",
  /** card / control surface */
  surface: "#ffffff",
  /** subtle raised surface (section body) */
  surfaceMuted: "#fafbfc",
  /** primary text — 17.4:1 on surface */
  text: "#1a1a1a",
  /** secondary/label text — 7.96:1 on surface */
  textMuted: "#4a5160",
  /** default control border — 10.5:1 on surface */
  border: "#3a3f4b",
  /** softer divider border (decorative, not carrying text contrast) */
  borderSubtle: "#c7ccd6",
  /** primary action background */
  primary: "#14477f",
  /** primary action hover/active background */
  primaryHover: "#0d3560",
  /** text/icon on a primary background — 9.39:1 */
  onPrimary: "#ffffff",
  /** destructive action background */
  danger: "#a01b0e",
  /** destructive action hover/active background */
  dangerHover: "#7d150a",
  /** text/icon on a danger background — 7.9:1 */
  onDanger: "#ffffff",
  /** danger text on a light surface — 7.9:1 */
  dangerText: "#a01b0e",
  /** success/confirmation text on a light surface — 6.82:1 */
  successText: "#12692b",
  /** focus ring / accent (same as primary; 9.39:1 on surface) */
  accent: "#14477f",
  /** highlight fill for an active drop target */
  dropHighlight: "#dbe8ff",
  /** seed badge fill (badge text uses primary — 8.14:1) */
  seedBadgeBg: "#e6f0fb",
} as const;

/** Spacing scale (CSS px). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/** Font size scale (CSS px). `base` is the >=16px body size (Req 8.1). */
export const fontSize = {
  xs: 12,
  sm: 14,
  base: BASE_FONT_SIZE,
  lg: 18,
  xl: 24,
} as const;

/** Corner radius scale (CSS px). */
export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
} as const;

// --- Shared inline-style helpers --------------------------------------------
// Reusable style objects so components consume the tokens instead of repeating
// literals. These are the "big tap target" primitives from src/styles/README.md.

/** Enforces the >=44x44 CSS px minimum tap target (Req 8.2). */
export const tapTargetStyle = {
  minWidth: MIN_TAP_TARGET,
  minHeight: MIN_TAP_TARGET,
} as const;

/** Base control (input/select-like) style: readable font, large hit area. */
export const controlStyle = {
  minHeight: MIN_TAP_TARGET,
  fontSize: fontSize.base,
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderRadius: radius.md,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.text,
} as const;

/** Primary button style (high-contrast, large tap target). */
export const primaryButtonStyle = {
  ...tapTargetStyle,
  minHeight: MIN_TAP_TARGET,
  fontSize: fontSize.base,
  padding: `${spacing.sm}px ${spacing.lg}px`,
  borderRadius: radius.md,
  background: colors.primary,
  color: colors.onPrimary,
  border: `1px solid ${colors.primaryHover}`,
  cursor: "pointer",
} as const;

/** Secondary/outline button style (high-contrast text on surface). */
export const secondaryButtonStyle = {
  ...tapTargetStyle,
  minHeight: MIN_TAP_TARGET,
  fontSize: fontSize.base,
  padding: `${spacing.sm}px ${spacing.lg}px`,
  borderRadius: radius.md,
  background: colors.surface,
  color: colors.primary,
  border: `1px solid ${colors.primary}`,
  cursor: "pointer",
} as const;
