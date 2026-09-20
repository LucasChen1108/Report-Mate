// fixtures.ts — standalone development data for the Report Renderer.
//
// The backend is not wired yet (no reports API, no service_reports rows), so
// the renderer is developed against these fixtures instead of live data. They
// mirror the three seed templates authored in
// backend/internal/templates/seeds.go so what we build against here matches the
// real contract byte-for-byte (same section ids, field ids, types, options).
//
// When the backend lands, ReportEditorPage swaps these fixtures for
// getTemplate()/getReport() calls through src/api — the component shape does
// not change.

import type { TemplateSchema } from "../../api/types";
import type { PartRow, ReportContent } from "./reportContent";
import { emptyContentForSchema, newPartRowId } from "./reportContent";

// --- Seed schema: HVAC Service Visit ----------------------------------------
// Exercises all six field types (text, number, select, checklist, photo,
// signature). Mirror of hvacServiceVisit() in seeds.go.
export const hvacServiceVisitSchema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_visit_info",
      label: "Visit Information",
      fields: [
        { id: "fld_arrival_notes", type: "text", label: "Arrival notes", required: false },
        { id: "fld_meter_reading", type: "number", label: "Meter reading", required: true },
      ],
    },
    {
      id: "sec_diagnostics",
      label: "Diagnostics",
      fields: [
        {
          id: "fld_system_type",
          type: "select",
          label: "System type",
          required: true,
          options: ["Split", "Packaged", "Ductless"],
        },
        {
          id: "fld_safety_checks",
          type: "checklist",
          label: "Safety checks completed",
          required: true,
          options: ["Power isolated", "Refrigerant checked", "Area cleared"],
        },
        { id: "fld_unit_photo", type: "photo", label: "Unit photo", required: false },
      ],
    },
    {
      id: "sec_signoff",
      label: "Sign-off",
      fields: [
        {
          id: "fld_customer_signoff",
          type: "signature",
          label: "Customer sign-off",
          required: true,
        },
      ],
    },
  ],
};

// --- Seed schema: General Maintenance Report --------------------------------
// Mirror of generalMaintenanceReport() in seeds.go.
export const generalMaintenanceReportSchema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_job_summary",
      label: "Job Summary",
      fields: [
        { id: "fld_work_performed", type: "text", label: "Work performed", required: true },
        { id: "fld_followup_notes", type: "text", label: "Follow-up notes", required: false },
      ],
    },
    {
      id: "sec_parts_observations",
      label: "Parts & Observations",
      fields: [
        {
          id: "fld_parts_replaced",
          type: "checklist",
          label: "Parts replaced",
          required: false,
          options: ["Air filter", "Belt", "Capacitor", "Thermostat"],
        },
        {
          id: "fld_condition_photo",
          type: "photo",
          label: "Equipment condition photo",
          required: false,
        },
      ],
    },
    {
      id: "sec_customer_approval",
      label: "Customer Approval",
      fields: [
        {
          id: "fld_approval_signature",
          type: "signature",
          label: "Customer approval signature",
          required: true,
        },
      ],
    },
  ],
};

// --- Seed schema: Safety Inspection -----------------------------------------
// Mirror of safetyInspection() in seeds.go.
export const safetyInspectionSchema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_site",
      label: "Site",
      fields: [
        {
          id: "fld_site_type",
          type: "select",
          label: "Site type",
          required: true,
          options: ["Residential", "Commercial", "Industrial"],
        },
        { id: "fld_site_address", type: "text", label: "Site address", required: true },
      ],
    },
    {
      id: "sec_checks",
      label: "Checks",
      fields: [
        {
          id: "fld_ppe_checks",
          type: "checklist",
          label: "PPE verified",
          required: true,
          options: ["Gloves", "Eye protection", "Hard hat", "Hearing protection"],
        },
        {
          id: "fld_hazard_checks",
          type: "checklist",
          label: "Hazards controlled",
          required: true,
          options: ["Electrical isolated", "Gas shut off", "Area barricaded"],
        },
      ],
    },
    {
      id: "sec_attestation",
      label: "Attestation",
      fields: [
        {
          id: "fld_inspector_signature",
          type: "signature",
          label: "Inspector attestation signature",
          required: true,
        },
      ],
    },
  ],
};

/** A selectable fixture: a named seed schema the dev harness can switch between. */
export interface SchemaFixture {
  id: string;
  name: string;
  schema: TemplateSchema;
}

/** All three seed schemas, in the same order as SeedTemplates() in Go. */
export const seedFixtures: SchemaFixture[] = [
  { id: "hvac", name: "HVAC Service Visit", schema: hvacServiceVisitSchema },
  { id: "general", name: "General Maintenance Report", schema: generalMaintenanceReportSchema },
  { id: "safety", name: "Safety Inspection", schema: safetyInspectionSchema },
];

// --- Sample mock content ----------------------------------------------------
// A partially-filled HVAC report so the renderer shows realistic data without a
// backend: a couple of fields left blank (to exercise the empty/required-ish
// look), a checklist with a subset chosen, a photo with a caption but no image
// (so the placeholder shows), and a couple of Parts Used rows. Signature is
// left unsigned so the empty signature pad is visible.

const sampleParts: PartRow[] = [
  { id: newPartRowId(), part: "Capacitor 45/5 MFD", partNumber: "CAP-455-370", quantity: "1" },
  { id: newPartRowId(), part: "Air filter 16x25x1", partNumber: "AF-162501", quantity: "2" },
];

/** Partially-filled sample content for the HVAC seed schema. Built on top of the
 * empty content so every field id is present and correctly shaped. */
export function sampleHvacContent(): ReportContent {
  const content = emptyContentForSchema(hvacServiceVisitSchema);
  content.values["fld_arrival_notes"] =
    "Arrived on site 09:15. Customer reported weak airflow from the upstairs vents and an intermittent rattle when the compressor starts.";
  content.values["fld_meter_reading"] = "42.6";
  content.values["fld_system_type"] = "Split";
  content.values["fld_safety_checks"] = ["Power isolated", "Area cleared"];
  content.values["fld_unit_photo"] = {
    dataUrl: null,
    caption: "Outdoor condenser unit, before service.",
  };
  // fld_customer_signoff intentionally left null (unsigned) to show the pad.
  content.parts = sampleParts;
  content.filledBy = "manual";
  return content;
}

/** Empty content for whichever fixture the harness selects. */
export function emptyContentFor(fixture: SchemaFixture): ReportContent {
  return emptyContentForSchema(fixture.schema);
}
