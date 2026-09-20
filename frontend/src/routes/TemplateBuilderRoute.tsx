// TemplateBuilderRoute — serves both /templates/new and /templates/:id/edit.
//
// TemplateBuilderPage takes initial props, not route params, and reads them
// ONCE to seed its reducer. This wrapper resolves the :templateId param into
// those props:
//
//   /templates/new        -> render the builder with no initial props (it opens
//                            on its own single default section).
//   /templates/:id/edit   -> getTemplate(id) first, then render the builder with
//                            initialSchema / initialName / initialTemplateId.
//                            Passing initialTemplateId is what flips the page's
//                            save from create (POST) to update (PUT).
//
// WHY THE BUILDER IS NOT MOUNTED UNTIL THE FETCH RESOLVES: its reducer seeds
// from initialSchema on first render only, so mounting it with `undefined` and
// filling in later would leave the user editing the default empty template
// while the real one sits unused in state. The `key` below is the same defense
// against param changes: navigating /templates/a/edit -> /templates/b/edit
// remounts the builder rather than leaving it seeded with template a.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TemplateBuilderPage } from "../pages/TemplateBuilder/TemplateBuilderPage";
import { getTemplate } from "../api/templates";
import type { TemplateRecord } from "../api/templates";
import { ApiAuthorizationError, ApiError } from "../api/client";
import { colors, fontSize, secondaryButtonStyle, spacing } from "../styles/tokens";

const messageStyle = {
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  padding: spacing.lg,
  fontSize: fontSize.base,
} as const;

export function TemplateBuilderRoute() {
  const { templateId } = useParams<{ templateId: string }>();

  const [record, setRecord] = useState<TemplateRecord | null>(null);
  // Only the edit route loads; /templates/new renders immediately.
  const [loading, setLoading] = useState(templateId !== undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (templateId === undefined) {
      // The "new" route: nothing to fetch, and clear any state left from a
      // previous edit render.
      setRecord(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Guard against a slow first response resolving after the user has already
    // navigated to a different template.
    let cancelled = false;

    setLoading(true);
    setError(null);

    getTemplate(templateId)
      .then((loaded) => {
        if (!cancelled) {
          setRecord(loaded);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeError(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [templateId]);

  if (loading) {
    return (
      <p style={{ ...messageStyle, color: colors.textMuted }}>Loading template…</p>
    );
  }

  if (error !== null) {
    return (
      <div style={{ padding: spacing.lg }}>
        <p role="alert" style={{ ...messageStyle, color: colors.dangerText, padding: 0 }}>
          {error}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ ...secondaryButtonStyle, marginTop: spacing.md }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (record !== null) {
    return (
      <TemplateBuilderPage
        key={record.id}
        initialSchema={record.schema}
        initialName={record.name}
        initialTemplateId={record.id}
      />
    );
  }

  // /templates/new — a blank builder.
  return <TemplateBuilderPage key="new" />;
}

// Map a rejection from the typed API client to a message for the user.
function describeError(err: unknown): string {
  if (err instanceof ApiAuthorizationError) {
    return err.message;
  }
  if (err instanceof ApiError) {
    return err.status === 404
      ? "That template no longer exists."
      : `Could not load the template: ${err.message}`;
  }
  return "Could not load the template. Check your connection and try again.";
}

export default TemplateBuilderRoute;
