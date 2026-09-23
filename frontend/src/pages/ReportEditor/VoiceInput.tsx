// VoiceInput — a modern "hold to talk" speech-to-text control for the agent
// composer.
//
// Deliberately NOT the default live-dictation behaviour (words twitching into
// the field as you speak). Instead:
//
//   1. Press-and-hold (or tap-to-start / tap-to-stop) enters a distinct
//      RECORDING mode with a live waveform driven by the mic's actual amplitude
//      (Web Audio AnalyserNode), so the control feels responsive and alive.
//   2. The interim transcript is shown as a dimmed "ghost" preview in the
//      overlay — it is NOT written into the real textarea, so the field never
//      churns with half-formed words.
//   3. On STOP, the finalized transcript is committed once via onCommit, which
//      the parent APPENDS to whatever is already typed (voice + typing mix).
//
// Graceful degradation (a product principle): if the browser has no
// SpeechRecognition, this renders nothing, so the composer stays fully usable
// by typing. Nothing here depends on the network or the LLM gateway — it is
// on-device browser speech recognition.

import { useCallback, useEffect, useRef, useState } from "react";
import { colors, fontSize, radius, spacing } from "../../styles/tokens";

// --- Minimal Web Speech API typings -----------------------------------------
// The DOM lib does not ship SpeechRecognition types, so declare the small
// surface we use. Vendor-prefixed webkitSpeechRecognition is the common one.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

// getSpeechRecognitionCtor returns the browser's SpeechRecognition constructor
// (standard or webkit-prefixed), or null when the API is unavailable.
function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether voice input is supported in this browser. Callers can use this to
 * decide layout, though VoiceInput also self-hides when unsupported. */
export function voiceInputSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

interface VoiceInputProps {
  // Called once, on stop, with the finalized transcript (trimmed). The parent
  // appends it to the composer rather than replacing — so voice and typing mix.
  onCommit: (transcript: string) => void;
  // Disables the mic (e.g. while a turn is in flight).
  disabled?: boolean;
}

const WAVE_BARS = 28;

export function VoiceInput({ onCommit, disabled = false }: VoiceInputProps) {
  const [supported] = useState<boolean>(voiceInputSupported);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Amplitude levels (0..1) for the waveform bars, newest at the end.
  const [levels, setLevels] = useState<number[]>(() => new Array(WAVE_BARS).fill(0));

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTextRef = useRef<string>("");
  // The transcript box scrolls to its bottom on every update so the most recent
  // words stay in view (see the effect below).
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Web Audio graph for the waveform.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Tear everything down: recognition, animation frame, audio graph, mic stream.
  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore — already stopped
      }
      recognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // Ensure teardown on unmount.
  useEffect(() => cleanup, [cleanup]);

  // Keep the single-line transcript scrolled to its right edge so the most
  // recent words are always visible as the speaker talks; earlier words roll
  // off the left rather than the newest being clipped.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [interim]);

  // Drive the waveform from the analyser's time-domain data. The loop keeps
  // running while recording even before the analyser is ready — it just pushes a
  // 0 level in that brief window — so the bar strip is live and scrolling from
  // the moment the mic is clicked, then reacts to real amplitude the instant the
  // audio graph comes up. It reschedules itself; commitAndReset/cleanup cancel it.
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    let level = 0;
    if (analyser) {
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      // RMS amplitude around the 128 midpoint, normalized to ~0..1.
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      level = Math.min(1, rms * 3); // scale so normal speech fills the bar
    }
    setLevels((prev) => [...prev.slice(1), level]);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ensureAudioGraph acquires the mic stream + AudioContext + analyser ONCE and
  // keeps them warm for the rest of the session. The first recording still pays
  // the one-time cost of the permission handshake / device open, but every
  // subsequent start reuses the live graph, so the bars react instantly instead
  // of waiting on a fresh getUserMedia each time. It is idempotent: if the graph
  // already exists it just resumes a suspended context and returns.
  const ensureAudioGraph = useCallback(async () => {
    // Already warm — just make sure the context is running (browsers may
    // auto-suspend it) and reuse it.
    if (analyserRef.current && audioCtxRef.current) {
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume().catch(() => undefined);
      }
      return;
    }
    try {
      const stream =
        streamRef.current ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
      streamRef.current = stream;
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return; // no Web Audio — recognition still works, just no bars
      const ctx = audioCtxRef.current ?? new AudioCtx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => undefined);
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
    } catch {
      // Mic permission denied or unavailable: recognition may still work in
      // some browsers, but typically both fail together. Surface a gentle note.
      setError("Microphone unavailable. You can type instead.");
    }
  }, []);

  const start = useCallback(() => {
    if (disabled || recording) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    setError(null);
    setInterim("");
    finalTextRef.current = "";
    setLevels(new Array(WAVE_BARS).fill(0));

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTextRef.current += text;
        } else {
          interimText += text;
        }
      }
      // Display the running transcript (finalized + current interim) so the
      // speaker sees the last few words they said, not just the pending chunk.
      // The box is fixed-height and auto-scrolls to the bottom, so as more is
      // spoken the view rolls to keep the most recent words visible.
      const running = (finalTextRef.current + interimText).replace(/\s+/g, " ").trimStart();
      setInterim(running);
    };
    recognition.onerror = (ev) => {
      if (ev.error && ev.error !== "aborted" && ev.error !== "no-speech") {
        setError("Could not capture audio. You can type instead.");
      }
    };
    recognition.onend = () => {
      // Fired when recognition stops (by us or by silence). Commit whatever was
      // finalized, once.
      commitAndReset();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() throws if already started; ignore.
    }
    setRecording(true);

    // Start the animation loop RIGHT NOW so the bars are live from the click.
    // tick() no-ops until the analyser exists, so warming the audio graph in the
    // background (below) lets the bars begin moving the instant the mic is ready
    // — no wait on teardown/re-setup, and instant on every recording after the
    // first (the graph is kept warm).
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
    void ensureAudioGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, recording, tick, ensureAudioGraph]);

  // Commit the finalized transcript and reset recording state. Safe to call
  // more than once — the ref is cleared so a second call commits nothing.
  const commitAndReset = useCallback(() => {
    const text = finalTextRef.current.trim();
    finalTextRef.current = "";
    setRecording(false);
    setInterim("");
    setLevels(new Array(WAVE_BARS).fill(0));
    // Stop the animation loop, but DELIBERATELY keep the audio graph warm (the
    // mic stream and AudioContext stay open) so the next recording starts
    // instantly instead of paying the getUserMedia cost again. The graph is
    // fully released on unmount by cleanup(). To be a good citizen while idle,
    // suspend the context so it is not processing audio between recordings.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state === "running") {
      void audioCtxRef.current.suspend().catch(() => undefined);
    }
    if (text) onCommit(text);
  }, [onCommit]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop(); // triggers onend -> commitAndReset
      } catch {
        commitAndReset();
      }
    } else {
      commitAndReset();
    }
  }, [commitAndReset]);

  // Unsupported browser: render nothing so the composer stays type-only.
  if (!supported) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        // Hug content (so an idle/empty mic does not stretch the row) while
        // still allowing growth when recording: the overlay child decides
        // whether to grow. minWidth:0 lets the overlay shrink so its transcript
        // wraps rather than shoving the mic to the next line; nowrap keeps the
        // mic on the same row as the overlay.
        minWidth: 0,
        maxWidth: "100%",
        flexWrap: "nowrap",
      }}
    >
      <button
        type="button"
        data-testid="voice-input-button"
        aria-pressed={recording}
        aria-label={recording ? "Stop recording" : "Record voice input"}
        disabled={disabled}
        // Toggle: one click starts recording, the next click stops and commits.
        // A single handler covers mouse, touch, and keyboard (Enter/Space fire
        // click), so there is no separate pointer/keydown wiring to keep in sync.
        onClick={() => {
          if (recording) {
            stop();
          } else {
            start();
          }
        }}
        style={{
          minWidth: 44,
          minHeight: 44,
          // Never let the mic be squeezed or pushed to the next row; the overlay
          // text truncates instead.
          flexShrink: 0,
          borderRadius: "50%",
          border: `1px solid ${recording ? colors.dangerHover : colors.border}`,
          background: recording ? colors.danger : colors.surface,
          color: recording ? colors.onDanger : colors.primary,
          cursor: disabled ? "default" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          animation: recording ? "rm-pulse 1.2s ease-in-out infinite" : undefined,
        }}
      >
        {/* Modern inline icons: a mic (capsule + stand) idle, a rounded stop
            square while recording. Both inherit the button's currentColor. */}
        {recording ? <StopIcon /> : <MicIcon />}
      </button>

      {/* Recording overlay: live waveform + rolling recent-words transcript.
          When nothing has been transcribed yet the overlay hugs its content
          (waveform + short hint) instead of stretching the whole row; once words
          arrive the transcript region grows to fill the available width. */}
      {recording && (
        <div
          data-testid="voice-input-overlay"
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.md,
            // Grow to fill only when there is transcript to show; empty stays
            // compact so the box does not span the full outer width.
            flex: interim ? 1 : "0 0 auto",
            minWidth: 0,
            maxWidth: "100%",
            padding: `${spacing.xs}px ${spacing.md}px`,
            borderRadius: radius.md,
            border: `1px solid ${colors.borderSubtle}`,
            background: colors.surface,
          }}
        >
          <Waveform levels={levels} />
          {interim ? (
            // A single-line window showing only the MOST RECENT line: the text
            // stays on one line (nowrap) and the box is auto-scrolled to its
            // right edge (see the effect), so the newest words are always visible
            // while earlier words roll off the left. minWidth:0 lets it shrink so
            // it clips to one line rather than pushing the mic off the row.
            <div
              ref={transcriptRef}
              data-testid="voice-input-interim"
              style={{
                flex: 1,
                minWidth: 0,
                overflowX: "hidden",
                overflowY: "hidden",
                fontSize: fontSize.sm,
                lineHeight: 1.4,
                fontStyle: "italic",
                color: colors.textMuted,
                whiteSpace: "nowrap",
              }}
            >
              {interim}
            </div>
          ) : (
            <span
              data-testid="voice-input-interim"
              style={{
                fontSize: fontSize.sm,
                fontStyle: "italic",
                color: colors.textMuted,
                whiteSpace: "nowrap",
              }}
            >
              Listening…
            </span>
          )}
        </div>
      )}

      {error && (
        <span
          role="alert"
          data-testid="voice-input-error"
          style={{ fontSize: fontSize.xs, color: colors.dangerText }}
        >
          {error}
        </span>
      )}

      {/* Keyframes for the pulsing mic; scoped <style> so it does not touch the
          shared theme stylesheet another agent owns. */}
      <style>{`@keyframes rm-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(160, 27, 14, 0.5); }
        50% { box-shadow: 0 0 0 6px rgba(160, 27, 14, 0); }
      }`}</style>
    </div>
  );
}

// MicIcon is a modern microphone glyph: a rounded capsule mic head, a curved
// stand cradling it, and a short base stem. Drawn on a 24x24 grid, inheriting
// the button's currentColor for both stroke and the capsule fill.
function MicIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* Mic capsule. */}
      <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      {/* Cradle: the arc that hugs the capsule. */}
      <path d="M5 10.5a7 7 0 0 0 14 0" />
      {/* Stand + base. */}
      <line x1="12" y1="17.5" x2="12" y2="21" />
      <line x1="8.5" y1="21" x2="15.5" y2="21" />
    </svg>
  );
}

// StopIcon is a rounded stop square, the modern "tap to stop" affordance shown
// while recording. It inherits the button's currentColor as a solid fill.
function StopIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" />
    </svg>
  );
}

// Waveform renders the amplitude levels as a row of bars. Purely visual; height
// per bar tracks the mic amplitude so it reacts to the technician's voice.
function Waveform({ levels }: { levels: number[] }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: 28,
        // Fixed-width strip: it must not shrink, so the interim text beside it is
        // the element that truncates when the row runs out of space.
        flexShrink: 0,
      }}
    >
      {levels.map((level, i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: 3,
            height: `${Math.max(3, level * 28)}px`,
            borderRadius: 2,
            background: colors.primary,
            transition: "height 60ms linear",
          }}
        />
      ))}
    </div>
  );
}

export default VoiceInput;
