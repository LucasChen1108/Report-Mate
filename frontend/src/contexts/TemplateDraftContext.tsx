import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { TemplateSchema } from "../api/types";

export interface TemplateDraft {
  schema: TemplateSchema;
  name: string;
}

interface TemplateDraftContextValue {
  draft: TemplateDraft | null;
  publishSchema: (schema: TemplateSchema) => void;
  publishName: (name: string) => void;
}

const TemplateDraftContext = createContext<TemplateDraftContextValue | null>(
  null,
);

export function TemplateDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);

  const publishSchema = useCallback((schema: TemplateSchema) => {
    setDraft((current) => ({ schema, name: current?.name ?? "" }));
  }, []);

  const publishName = useCallback((name: string) => {
    setDraft((current) => current ? { ...current, name } : current);
  }, []);

  const value = useMemo(
    () => ({ draft, publishSchema, publishName }),
    [draft, publishName, publishSchema],
  );

  return (
    <TemplateDraftContext.Provider value={value}>
      {children}
    </TemplateDraftContext.Provider>
  );
}

export function useTemplateDraft(): TemplateDraftContextValue {
  const context = useContext(TemplateDraftContext);
  if (!context) {
    throw new Error(
      "useTemplateDraft must be used within a TemplateDraftProvider",
    );
  }
  return context;
}
