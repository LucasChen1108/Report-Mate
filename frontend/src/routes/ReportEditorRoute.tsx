// ReportEditorRoute — loads what /reports/new and /reports/:reportId render.
//
// The two entry paths converge on ONE thing: a ReportRecord. The editor never
// renders a bare template.
//
//   /reports/new?templateId=X   getTemplate(X) -> createReport({templateId})
//   /reports/:reportId          getReport(id)
//
// WHY CREATE THE DRAFT UP FRONT, before the technician types anything: it means
// a report id exists from the first render, so every save in the editor is a
// plain PUT. The alternative — create on first save, update after — puts a
// create-vs-update branch in the page and an "is this saved yet" question in
// every code path that touches it. An empty draft row costs nothing; a
// half-written save path costs a lost report.
//
// AND THE URL IS REWRITTEN TO MATCH. As soon as that draft exists, /reports/new
// is REPLACED with /reports/<id>. Without it the address bar keeps saying
// "new" for a report that is no longer new, and the consequences are not
// cosmetic:
//
//   - a reload runs this effect again, creates ANOTHER draft, and shows the
//     technician a blank form. Their work is still on the server, but they
//     have no way to reach it and every reason to think it is gone. On a
//     phone, in the field, a reload is not an unusual thing to do.
//   - the URL is not shareable or bookmarkable, and the back button lands on
//     a page that quietly creates a third draft.
//
// `replace`, not `push`: /reports/new is not somewhere the back button should
// return to, precisely because returning there creates another draft.
//
// WHY BOTH CALLS ON THE NEW PATH: createReport alone returns everything the
// editor renders (it snapshots the schema onto the draft), but not the
// TEMPLATE'S NAME — a ReportRecord carries a title, not the template's name. The
// getTemplate call supplies the heading and, usefully, fails fast on a bad
// templateId BEFORE a junk draft row is created.
//
// ?fixture=<id> short-circuits both paths into the editor's bundled seed
// fixtures with no network call at all — the dev escape hatch that keeps the
// renderer workable while the reports API is down. It is checked first,
// deliberately, so it works on /reports/new with no templateId.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ReportRecord } from "../api/reportTypes";
import { createReport, getReport } from "../api/reports";
import { getTemplate } from "../api/templates";
import { ReportEditorPage } from "../pages/ReportEditor/ReportEditorPage";
import { colors, fontSize, radius, spacing } from "../styles/tokens";

// What the route is holding while it resolves the two entry paths.
type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; report: ReportRecord; templateName?: string }
  | { kind: "error"; message: string };

export function ReportEditorRoute() {
  const { reportId } = useParams<{ reportId: string }>();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get("templateId");
  const fixtureId = searchParams.get("fixture");

  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  // The key whose result `state` currently holds. Used to suppress the
  // "Loading report…" panel when the effect re-runs for a key we have already
  // resolved — which is exactly what the /new -> /reports/<id> replacement
  // below triggers. Blanking a filled-in form for a frame there would look to
  // the technician like the draft vanishing.
  const loadedKey = useRef<string | null>(null);

  // The load in flight, keyed by what it is loading.
  //
  // StrictMode runs effects twice in development, and on the /new path a second
  // run would POST a SECOND draft report and leave an orphan row behind on every
  // load — the one effect here where a double-invoke is not harmless.
  //
  // So the promise is cached rather than the "already started" fact, and each
  // effect run ATTACHES to it. Guarding with a plain started-flag instead looks
  // right and is subtly broken: the second run bails out early while the first
  // run's cleanup has already marked its own result cancelled, and the page
  // hangs on "Loading report…" forever. One request, and whichever run is still
  // mounted renders its result.
  const inFlight = useRef<{ key: string; promise: Promise<LoadState> } | null>(
    null,
  );

  useEffect(() => {
    // Dev escape hatch: nothing to load.
    if (fixtureId) return;

    const key = reportId ? `report:${reportId}` : `new:${templateId ?? ""}`;

    const load = async (): Promise<LoadState> => {
      try {
        if (reportId) {
          const report = await getReport(reportId);
          return { kind: "ready", report };
        }

        if (!templateId) {
          return {
            kind: "error",
            message:
              "No template chosen. Open a report from the dashboard, or start one from a template.",
          };
        }

        // Fail fast on a bad id before creating a draft row against it.
        const template = await getTemplate(templateId);
        const report = await createReport({ templateId });
        return { kind: "ready", report, templateName: template.name };
      } catch (err) {
        return {
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Could not load the report. Check your connection and try again.",
        };
      }
    };

    if (inFlight.current?.key !== key) {
      inFlight.current = {
        key,
        // A failed load is not cached: dropping it lets a remount retry rather
        // than serving the same failure forever.
        promise: load().then((next) => {
          if (next.kind === "error" && inFlight.current?.key === key) {
            inFlight.current = null;
          }
          return next;
        }),
      };
    }

    let cancelled = false;
    if (loadedKey.current !== key) {
      setState({ kind: "loading" });
    }
    void inFlight.current.promise.then((next) => {
      if (cancelled) return;
      loadedKey.current = key;
      setState(next);
    });

    return () => {
      cancelled = true;
    };
  }, [reportId, templateId, fixtureId]);

  // Canonicalize /reports/new -> /reports/<id> once the draft exists.
  //
  // The cache is primed under the destination key FIRST, so the route change
  // re-runs the effect above, finds the answer already there, and attaches to
  // it instead of issuing a redundant GET for the record we are holding.
  useEffect(() => {
    if (fixtureId) return;
    // Already on the canonical URL, or nothing to canonicalize to yet.
    if (reportId) return;
    if (state.kind !== "ready") return;

    const key = `report:${state.report.id}`;
    inFlight.current = { key, promise: Promise.resolve(state) };
    loadedKey.current = key;
    navigate(`/reports/${state.report.id}`, { replace: true });
  }, [state, reportId, fixtureId, navigate]);

  // Dev escape hatch — render the bundled fixture, no backend involved.
  if (fixtureId) {
    return <ReportEditorPage fixtureId={fixtureId} />;
  }

  if (state.kind === "loading") {
    return <RouteMessage title="Loading report…" />;
  }

  if (state.kind === "error") {
    return (
      <RouteMessage title="Could not open this report" detail={state.message}>
        <Link
          to="/dashboard"
          style={{
            display: "inline-block",
            minHeight: 44,
            lineHeight: "44px",
            padding: `0 ${spacing.lg}px`,
            borderRadius: radius.md,
            border: `1px solid ${colors.primary}`,
            background: colors.surface,
            color: colors.primary,
            textDecoration: "none",
            fontSize: fontSize.base,
          }}
        >
          Back to dashboard
        </Link>
      </RouteMessage>
    );
  }

  return (
    <ReportEditorPage report={state.report} templateName={state.templateName} />
  );
}

// A centered status panel for the loading and failure states. Small enough to
// live here rather than pull in a shared component the other routes do not use.
function RouteMessage({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      style={{
        maxWidth: 640,
        margin: `${spacing.xl}px auto`,
        padding: spacing.xl,
        background: colors.surface,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
        textAlign: "center",
      }}
    >
      <h1 style={{ margin: 0, fontSize: fontSize.lg, color: colors.text }}>
        {title}
      </h1>
      {detail && (
        <p
          style={{
            margin: `${spacing.md}px 0 0`,
            fontSize: fontSize.base,
            color: colors.textMuted,
          }}
        >
          {detail}
        </p>
      )}
      {children && <div style={{ marginTop: spacing.lg }}>{children}</div>}
    </div>
  );
}

export default ReportEditorRoute;
