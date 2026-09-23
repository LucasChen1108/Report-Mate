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

  // Drive the waveform from the analyser's time-domain data.
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    // RMS amplitude around the 128 midpoint, normalized to ~0..1.
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / buf.length);
    const level = Math.min(1, rms * 3); // scale so normal speech fills the bar
    setLevels((prev) => [...prev.slice(1), level]);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startWaveform = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return; // no Web Audio — recognition still works, just no bars
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Mic permission denied or unavailable: recognition may still work in
      // some browsers, but typically both fail together. Surface a gentle note.
      setError("Microphone unavailable. You can type instead.");
    }
  }, [tick]);

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
      setInterim(interimText);
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
    void startWaveform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, recording, startWaveform]);

  // Commit the finalized transcript and reset recording state. Safe to call
  // more than once — the ref is cleared so a second call commits nothing.
  const commitAndReset = useCallback(() => {
    const text = finalTextRef.current.trim();
    finalTextRef.current = "";
    setRecording(false);
    setInterim("");
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
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
    <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
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
          borderRadius: "50%",
          border: `1px solid ${recording ? colors.dangerHover : colors.border}`,
          background: recording ? colors.danger : colors.surface,
          color: recording ? colors.onDanger : colors.primary,
          cursor: disabled ? "default" : "pointer",
          fontSize: fontSize.lg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          animation: recording ? "rm-pulse 1.2s ease-in-out infinite" : undefined,
        }}
      >
        {/* Mic glyph; a square when recording to read as "stop". */}
        {recording ? "■" : "🎤"}
      </button>

      {/* Recording overlay: live waveform + dimmed interim ghost transcript. */}
      {recording && (
        <div
          data-testid="voice-input-overlay"
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.md,
            flex: 1,
            minWidth: 0,
            padding: `${spacing.xs}px ${spacing.md}px`,
            borderRadius: radius.md,
            border: `1px solid ${colors.borderSubtle}`,
            background: colors.surface,
          }}
        >
          <Waveform levels={levels} />
          <span
            data-testid="voice-input-interim"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: fontSize.sm,
              fontStyle: "italic",
              color: colors.textMuted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {interim || "Listening… tap the mic again to add"}
          </span>
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
