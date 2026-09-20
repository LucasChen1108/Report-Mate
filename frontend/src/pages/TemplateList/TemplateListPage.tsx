// TemplateListPage — lists saved templates and opens one into the editor.
//
// SCOPE (task 11.2): this page is the entry surface for the Template Builder.
// It:
//   - on mount, retrieves the template list via listTemplates() through the
//     typed API client and displays them (Req 5.4),
//   - shows BOTH seed and custom templates in the SAME list (Req 7.3), marking
//     seed templates with a "Seed" badge for clarity (they still appear
//     together in the one list),
//   - provides an "open" affordance per template that loads that template's
//     FULL schema via getTemplate(id) (Req 5.2), then navigates to its edit URL
//     with the loaded record in typed navigation state,
//   - provides a "New template" affordance that navigates to /templates/new,
//   - handles loading and error states for both the list fetch and each open
//     fetch (a failed open shows a message and does NOT navigate).
//
// All persistence calls go through the injected TemplateService. Components do
// not know whether that service is backed by the API or development mocks.
//
// OUT OF SCOPE here (owned by other tasks):
//   - TemplateBuilderPage itself (task 11.1) — this page only receives callbacks
//     and never imports/edits it.
//   - styling polish (task 12.1): styling here is minimal with large tap
//     targets only.
//   - tests (tasks 11.4 / 11.5).

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routeBuilders, ROUTES } from "../../config/routes";
import type { TemplateEditNavigationState } from "../../routing/navigationState";
import type { TemplateSummary } from "../../services/contracts";
import { useServices } from "../../services/ServiceProvider";

// Minimal control styling with large (>=44px) tap targets. Full styling is
// task 12.1.
const buttonStyle: React.CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  fontSize: 16,
  padding: "8px 16px",
  borderRadius: 8,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#1a5fb4",
  color: "#fff",
  border: "1px solid #14477f",
};

const openButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#fff",
  color: "#1a5fb4",
  border: "1px solid #1a5fb4",
};

export function TemplateListPage() {
  const navigate = useNavigate();
  const { templates: templateService } = useServices();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // The id currently being opened (its schema is fetching) so we can disable
  // its control and show progress; null when no open is in flight.
  const [openingId, setOpeningId] = useState<string | null>(null);
  // A failed open surfaces a message here and does NOT navigate (Req 5.2 open
  // flow error handling).
  const [openError, setOpenError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const summaries = await templateService.list();
      setTemplates(summaries);
    } catch (err) {
      setListError(
        err instanceof Error
          ? err.message
          : "Could not load templates. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [templateService]);

  // Retrieve the list on mount (Req 5.4).
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Open flow: load the FULL schema for this template (Req 5.2), then hand the
  // loaded record to the edit route. On failure show a message and do not
  // navigate. TemplateBuilderRoute can also load by URL for direct visits.
  const handleOpen = useCallback(
    async (id: string) => {
      setOpeningId(id);
      setOpenError(null);
      try {
        const record = await templateService.get(id);
        const state: TemplateEditNavigationState = { template: record };
        navigate(routeBuilders.template(record.id), { state });
      } catch (err) {
        setOpenError(
          err instanceof Error
            ? err.message
            : "Could not open the template. Please try again.",
        );
      } finally {
        setOpeningId(null);
      }
    },
    [navigate, templateService],
  );

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0 }}>Templates</h1>
        <button
          type="button"
          onClick={() => navigate(ROUTES.newTemplate)}
          data-testid="new-template-button"
          style={primaryButtonStyle}
        >
          New template
        </button>
      </header>

      {openError && (
        <p
          role="alert"
          data-testid="open-error"
          style={{ margin: "0 0 12px", color: "#c0392b" }}
        >
          {openError}
        </p>
      )}

      {loading && (
        <p data-testid="list-loading" style={{ margin: 0 }}>
          Loading templates…
        </p>
      )}

      {!loading && listError && (
        <div data-testid="list-error">
          <p role="alert" style={{ margin: "0 0 12px", color: "#c0392b" }}>
            {listError}
          </p>
          <button
            type="button"
            onClick={() => void loadList()}
            data-testid="list-retry-button"
            style={openButtonStyle}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !listError && templates.length === 0 && (
        <p data-testid="list-empty" style={{ margin: 0 }}>
          No templates yet. Create one with “New template”.
        </p>
      )}

      {!loading && !listError && templates.length > 0 && (
        <ul
          data-testid="template-list"
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {templates.map((template) => {
            const isOpening = openingId === template.id;
            return (
              <li
                key={template.id}
                data-testid="template-list-item"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 0",
                  borderBottom: "1px solid #ddd",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: 16, wordBreak: "break-word" }}>
                    {template.name}
                  </span>
                  {template.isSeed && (
                    <span
                      data-testid="seed-badge"
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "#e6f0fb",
                        color: "#14477f",
                        border: "1px solid #1a5fb4",
                      }}
                    >
                      Seed
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void handleOpen(template.id)}
                  disabled={openingId !== null}
                  data-testid="open-template-button"
                  style={{
                    ...openButtonStyle,
                    opacity: openingId !== null && !isOpening ? 0.6 : 1,
                  }}
                >
                  {isOpening ? "Opening…" : "Open"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default TemplateListPage;
