// SignatureFieldControl — editable control for a `signature` field.
//
// Handoff decision 3: signature is a distinct capture type, rendered as a
// signature PAD (canvas), not a text box. Every real template we checked has a
// sign-off capture. The captured signature is stored as a PNG data URL, which is
// export-ready (embeds directly into the later PDF).
//
// Pointer events cover mouse, touch, and pen with one code path. Drawing state
// is kept in refs (no re-render per point); React state only tracks whether the
// pad currently holds a signature (to toggle the Clear button / empty hint).

import { useEffect, useRef, useState } from "react";
import { colors, fontSize, radius, spacing } from "../../../styles/tokens";
import type { SignatureValue } from "../reportContent";
import { FieldLabel } from "./TextFieldControl";

interface SignatureFieldControlProps {
  id: string;
  label: string;
  required: boolean;
  value: SignatureValue;
  onChange: (next: SignatureValue) => void;
}

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 180;

export function SignatureFieldControl({
  id,
  label,
  required,
  value,
  onChange,
}: SignatureFieldControlProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState<boolean>(value !== null);

  // On mount / when an incoming value changes from outside, paint it onto the
  // canvas so a pre-filled signature (e.g. agent path or reload) is visible.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = value;
      setHasInk(true);
    } else {
      setHasInk(false);
    }
    // Only re-sync when the external value identity changes.
  }, [value]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // Map CSS pixels to the canvas' internal coordinate space.
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointerPos(e);
  };

  const moveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const point = pointerPos(e);
    const last = lastPointRef.current ?? point;

    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    lastPointRef.current = point;
    if (!hasInk) setHasInk(true);
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Commit the current canvas as a PNG data URL.
    onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div data-testid={`signature-${id}`}>
      <FieldLabel label={label} required={required} />
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        data-testid={`signature-${id}-canvas`}
        onPointerDown={startStroke}
        onPointerMove={moveStroke}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        style={{
          display: "block",
          width: "100%",
          maxWidth: CANVAS_WIDTH,
          height: "auto",
          aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
          touchAction: "none",
          borderRadius: radius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          cursor: "crosshair",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
          marginTop: spacing.sm,
        }}
      >
        <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
          {hasInk ? "Signed" : "Sign above with finger, pen, or mouse"}
        </span>
        <button
          type="button"
          data-testid={`signature-${id}-clear`}
          onClick={clear}
          disabled={!hasInk}
          style={{
            minHeight: 44,
            padding: `${spacing.xs}px ${spacing.md}px`,
            fontSize: fontSize.sm,
            borderRadius: radius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: hasInk ? colors.text : colors.textMuted,
            cursor: hasInk ? "pointer" : "not-allowed",
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
