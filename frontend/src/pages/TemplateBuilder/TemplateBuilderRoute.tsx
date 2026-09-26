import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useTemplateDraft } from "../../contexts/TemplateDraftContext";
import { getNavigatedTemplate } from "../../routing/navigationState";
import type { TemplateRecord } from "../../services/contracts";
import { useServices } from "../../services/ServiceProvider";
import { TemplateBuilderPage } from "./TemplateBuilderPage";

interface TemplateBuilderRouteProps {
  mode: "new" | "edit";
}

interface ExistingTemplateBuilderRouteProps {
  onSchemaChange: ReturnType<typeof useTemplateDraft>["publishSchema"];
  onNameChange: ReturnType<typeof useTemplateDraft>["publishName"];
}

function ExistingTemplateBuilderRoute({
  onSchemaChange,
  onNameChange,
}: ExistingTemplateBuilderRouteProps) {
  const { templates: templateService } = useServices();
  const { id } = useParams<"id">();
  const location = useLocation();
  const navigatedTemplate = id
    ? getNavigatedTemplate(location.state, id)
    : null;
  const [record, setRecord] = useState<TemplateRecord | null>(
    navigatedTemplate,
  );
  const [loading, setLoading] = useState(navigatedTemplate === null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!id) {
      setRecord(null);
      setLoading(false);
      setError("The template URL is missing an id.");
      return;
    }

    if (navigatedTemplate) {
      setRecord(navigatedTemplate);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setRecord(null);
    setLoading(true);
    setError(null);

    void templateService.get(id)
      .then((loaded) => {
        if (active) setRecord(loaded);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load the template. Please try again.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, loadAttempt, navigatedTemplate, templateService]);

  const retry = useCallback(() => {
    setLoadAttempt((current) => current + 1);
  }, []);

  if (loading) {
    return (
      <main className="rm-page">
        <p role="status">Loading template…</p>
      </main>
    );
  }

  if (error || !record || record.id !== id) {
    return (
      <main className="rm-page">
        <h1>Template unavailable</h1>
        <p role="alert">{error ?? "The requested template could not be loaded."}</p>
        {id && (
          <button type="button" onClick={retry}>
            Retry
          </button>
        )}
      </main>
    );
  }

  return (
    <TemplateBuilderPage
      key={`edit:${record.id}`}
      initialSchema={record.schema}
      initialName={record.name}
      initialTemplateId={record.id}
      onSchemaChange={onSchemaChange}
      onNameChange={onNameChange}
    />
  );
}

export function TemplateBuilderRoute({ mode }: TemplateBuilderRouteProps) {
  const { publishSchema, publishName } = useTemplateDraft();

  if (mode === "new") {
    return (
      <TemplateBuilderPage
        key="new"
        onSchemaChange={publishSchema}
        onNameChange={publishName}
      />
    );
  }

  return (
    <ExistingTemplateBuilderRoute
      onSchemaChange={publishSchema}
      onNameChange={publishName}
    />
  );
}
