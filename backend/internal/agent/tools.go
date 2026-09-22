package agent

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// toolResult is what a tool hands back to the loop. It is JSON-encoded into the
// next prompt so the model sees the outcome of its call. An Ok:false result
// still goes back to the model (with a Detail explaining the rejection) so it
// can adjust rather than silently failing.
type toolResult struct {
	Ok     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
	Data   any    `json:"data,omitempty"`
}

// runState is the mutable per-run state a tool handler operates on. It carries
// the draft's schema snapshot, an in-memory copy of the report content that
// fill_field mutates, the context providers, the set of flagged field ids, and
// the run log. The content is a pointer because fill_field writes into it; a
// run persists it exactly once, on save_draft, so a failed run leaves the
// persisted draft untouched.
type runState struct {
	schema  templates.TemplateSchema
	content *reports.ReportContent // in-memory copy, mutated by fill_field
	jobID   *string
	jobs    JobHistoryProvider
	parts   PartsCatalogProvider
	flagged map[string]struct{} // field ids flagged missing
	log     *RunLog
}

// toolHandler dispatches one parsed tool call against the run state. Handlers
// are registered by tool name in a toolRegistry and populated by later tasks
// (fill_field in 5.2; the context/flag/save tools in 5.5). This file only
// establishes the registry scaffolding.
type toolHandler func(st *runState, call toolCall) toolResult

// toolRegistry maps a tool name to its handler. It is populated at composition
// time via register; dispatch looks a call up by its Tool field.
type toolRegistry struct {
	handlers map[string]toolHandler
}

// newToolRegistry returns an initialized, empty registry. Handlers are added by
// later tasks with register.
func newToolRegistry() *toolRegistry {
	return &toolRegistry{handlers: make(map[string]toolHandler)}
}

// register adds a handler under the given tool name, overwriting any prior
// handler registered under the same name.
func (r *toolRegistry) register(name string, h toolHandler) {
	r.handlers[name] = h
}

// dispatch looks up the handler for call.Tool and invokes it against st. When
// no handler is registered for the tool, it returns an Ok:false result rather
// than panicking. parseToolCall already guards against a missing "tool" field
// upstream, but an unknown-but-present tool is still handled gracefully here so
// the model gets a result it can react to.
func (r *toolRegistry) dispatch(st *runState, call toolCall) toolResult {
	h, ok := r.handlers[call.Tool]
	if !ok {
		return toolResult{Ok: false, Detail: "unknown tool"}
	}
	return h(st, call)
}

// fillableType reports whether the agent may write a field of this type. The
// agent fills text, number, select, and checklist fields; photo and signature
// fields are captured by the human, so they are never fillable (Req 2.1, 2.3,
// 3.4).
func fillableType(t templates.FieldType) bool {
	switch t {
	case templates.FieldText, templates.FieldNumber, templates.FieldSelect, templates.FieldChecklist:
		return true
	default:
		return false
	}
}

// registerFillFieldTool registers the fill_field handler on r under the name
// "fill_field". It is a standalone registration so it composes cleanly with the
// other tools registered elsewhere (task 5.5) without a single monolithic
// registration function that the two tasks would both have to edit.
func registerFillFieldTool(r *toolRegistry) {
	r.register("fill_field", fillFieldHandler)
}

// fillFieldHandler validates and writes one field of the draft in response to a
// fill_field tool call. It enforces, in order (Req 2.1–2.6, 3.4):
//
//  1. The target field id must be declared by st.schema; an unknown id is
//     rejected and logged, content unchanged (Req 2.2).
//  2. A photo or signature field is human-captured, never agent-filled; it is
//     rejected and logged (Req 2.3, 3.4).
//  3. The value must satisfy the field's type rule, MIRRORING
//     reports.validateValue EXACTLY so a value accepted here can never be
//     rejected by reports.ValidateContent at persist time:
//     - text / select: a JSON string; a select value must be "" or one of the
//     field's declared options (Req 2.4, 2.6).
//     - number: stored as a JSON string on the wire (reports.validateValue
//     decodes a string then ParseFloat's it). A JSON number is accepted for
//     the model's convenience and normalized to its string form; a numeric
//     JSON string is accepted as-is; "" is accepted (a legal mid-edit state).
//     Anything else is rejected and logged (Req 2.5).
//     - checklist: a JSON array of strings, each drawn from the field's
//     declared options (Req 2.4, 2.6).
//
// On success it writes the normalized value into st.content.Values[field_id] as
// json.RawMessage in the exact wire shape reports expects, logs the write, and
// returns Ok:true. Every rejection leaves st.content untouched, records the
// rejection in the run log (tool name, args, and a result naming the field id
// and, where relevant, the offending value/type), and returns Ok:false so the
// model can react (flag the field or retry) rather than failing silently.
func fillFieldHandler(st *runState, call toolCall) toolResult {
	args := fillFieldArgs(call)

	// Step 1: the field id must be declared by the schema.
	field, found := lookupField(st.schema, call.FieldID)
	if !found {
		return rejectFill(st, args, toolResult{
			Ok:     false,
			Detail: "unknown field id: " + call.FieldID,
		})
	}

	// Step 2: photo and signature fields are human-captured, never fillable.
	if !fillableType(field.Type) {
		return rejectFill(st, args, toolResult{
			Ok: false,
			Detail: "field " + field.ID + " is of type " + string(field.Type) +
				", which is captured by the technician and cannot be filled by the agent",
		})
	}

	// Step 3: validate + normalize by type, mirroring reports.validateValue.
	normalized, detail, ok := normalizeFillValue(field, call.Value)
	if !ok {
		return rejectFill(st, args, toolResult{Ok: false, Detail: detail})
	}

	// Step 4: write the normalized value into the in-memory content copy.
	if st.content.Values == nil {
		st.content.Values = make(map[string]json.RawMessage)
	}
	st.content.Values[field.ID] = normalized

	result := toolResult{Ok: true, Detail: "wrote field " + field.ID}
	logFill(st, args, result)
	return result
}

// fillFieldArgs is the arguments record logged for a fill_field dispatch,
// encoded as JSON. It mirrors the tool call's own fields so a run can be
// replayed from the log; the raw value bytes are preserved as received.
func fillFieldArgs(call toolCall) json.RawMessage {
	value := call.Value
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	args := struct {
		FieldID string          `json:"field_id"`
		Value   json.RawMessage `json:"value"`
	}{FieldID: call.FieldID, Value: value}
	encoded, _ := json.Marshal(args)
	return json.RawMessage(encoded)
}

// rejectFill logs a rejected fill_field call and returns its Ok:false result.
// It performs no write, so st.content is left exactly as it was — the atomicity
// guarantee for a run that never reaches save_draft.
func rejectFill(st *runState, args json.RawMessage, result toolResult) toolResult {
	logFill(st, args, result)
	return result
}

// logFill records one fill_field dispatch (args + result) in the run log,
// JSON-encoding the result the way it is fed back to the model.
func logFill(st *runState, args json.RawMessage, result toolResult) {
	if st.log == nil {
		return
	}
	encoded, _ := json.Marshal(result)
	st.log.Tool("fill_field", args, json.RawMessage(encoded))
}

// lookupField walks the schema's sections in order and returns the field with
// the given id. Field ids are unique across a template (templates.Validate
// enforces it), so the first match is the only match.
func lookupField(schema templates.TemplateSchema, fieldID string) (templates.Field, bool) {
	for _, section := range schema.Sections {
		for _, field := range section.Fields {
			if field.ID == fieldID {
				return field, true
			}
		}
	}
	return templates.Field{}, false
}

// normalizeFillValue validates raw against field's type rule and returns the
// value in the exact wire shape reports.validateValue accepts. On rejection it
// returns ok=false and a human-readable detail naming the field and the
// offending value/type. It is the single point that keeps fill_field's accept
// rule identical to the Content_Validator's, so a fill_field write can never be
// rejected later at persist time.
func normalizeFillValue(field templates.Field, raw json.RawMessage) (json.RawMessage, string, bool) {
	switch field.Type {
	case templates.FieldText:
		value, ok := decodeJSONString(raw)
		if !ok {
			return nil, "field " + field.ID + " (text) requires a string value", false
		}
		return encodeJSONString(value), "", true

	case templates.FieldSelect:
		value, ok := decodeJSONString(raw)
		if !ok {
			return nil, "field " + field.ID + " (select) requires a string value", false
		}
		if value != "" && !containsString(field.Options, value) {
			return nil, "value " + strconv.Quote(value) + " is not one of the options for field " + field.ID, false
		}
		return encodeJSONString(value), "", true

	case templates.FieldNumber:
		// reports.validateValue stores a number as a JSON string and requires a
		// non-empty value to ParseFloat. Accept a JSON number (normalize to its
		// string form) or a JSON string; "" is a legal mid-edit state.
		str, ok := numberToWireString(raw)
		if !ok {
			return nil, "field " + field.ID + " (number) requires a number or numeric string", false
		}
		if trimmed := strings.TrimSpace(str); trimmed != "" {
			if _, err := strconv.ParseFloat(trimmed, 64); err != nil {
				return nil, "field " + field.ID + " value " + strconv.Quote(str) + " is not a number", false
			}
		}
		return encodeJSONString(str), "", true

	case templates.FieldChecklist:
		values, ok := decodeJSONStringSlice(raw)
		if !ok {
			return nil, "field " + field.ID + " (checklist) requires an array of strings", false
		}
		for _, value := range values {
			if !containsString(field.Options, value) {
				return nil, "value " + strconv.Quote(value) + " is not one of the options for field " + field.ID, false
			}
		}
		return encodeJSONStringSlice(values), "", true

	default:
		// fillableType already excludes photo/signature and any unknown type
		// before this is reached; guard anyway so a future fillable type cannot
		// silently write an unvalidated value.
		return nil, "field " + field.ID + " has a type that cannot be filled by the agent", false
	}
}

// numberToWireString coerces a fill_field number value to the string form
// reports stores. It accepts a JSON string (returned as-is) or a JSON number
// (re-encoded to its canonical string). ok is false for any other JSON type.
func numberToWireString(raw json.RawMessage) (string, bool) {
	if str, ok := decodeJSONString(raw); ok {
		return str, true
	}
	var number json.Number
	if err := json.Unmarshal(raw, &number); err == nil {
		return number.String(), true
	}
	return "", false
}

// decodeJSONString decodes raw as a JSON string. It mirrors reports.decodeString
// (which the agent package cannot call — it is unexported there).
func decodeJSONString(raw json.RawMessage) (string, bool) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// decodeJSONStringSlice decodes raw as a JSON array of strings, mirroring
// reports.decodeStringSlice.
func decodeJSONStringSlice(raw json.RawMessage) ([]string, bool) {
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, false
	}
	return values, true
}

// encodeJSONString marshals a string into the JSON wire form reports expects.
// A string always marshals cleanly, so the error is impossible and dropped.
func encodeJSONString(value string) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return json.RawMessage(encoded)
}

// encodeJSONStringSlice marshals a string slice into a JSON array, normalizing a
// nil slice to an empty JSON array so the stored value is always [] rather than
// null (matching how reports treats an empty checklist).
func encodeJSONStringSlice(values []string) json.RawMessage {
	if values == nil {
		values = []string{}
	}
	encoded, _ := json.Marshal(values)
	return json.RawMessage(encoded)
}

// containsString reports whether value is one of options, mirroring
// reports.containsOption.
func containsString(options []string, value string) bool {
	for _, option := range options {
		if option == value {
			return true
		}
	}
	return false
}

// buildRegistry assembles the full tool registry the runner dispatches against.
// It registers every tool the model is allowed to call MID-loop: fill_field
// (task 5.2) plus the four context/flag tools below.
//
// save_draft is intentionally NOT registered here. It is not a normal registry
// handler: the runner treats save_draft specially — it terminates the loop and
// invokes the injected persist closure (tasks 10.1/11.1) rather than mutating
// runState in place. Registering it here would be wrong, so dispatch of an
// unregistered save_draft never happens: the runner intercepts it before it
// reaches the registry.
func buildRegistry() *toolRegistry {
	r := newToolRegistry()
	registerFillFieldTool(r) // fill_field, from task 5.2
	r.register("flag_missing_field", flagMissingFieldHandler)
	r.register("get_template_schema", getTemplateSchemaHandler)
	r.register("get_job_history", getJobHistoryHandler)
	r.register("get_parts_catalog", getPartsCatalogHandler)
	return r
}

// logTool records one dispatched tool call (args + result) in the run log under
// the given tool name, JSON-encoding the result the way it is fed back to the
// model. It is the generalized companion to logFill (which is pinned to
// "fill_field"); the four handlers below use it so each logs under its own name
// without duplicating the nil-guard/encode dance.
func logTool(st *runState, name string, args json.RawMessage, result toolResult) {
	if st.log == nil {
		return
	}
	encoded, _ := json.Marshal(result)
	st.log.Tool(name, args, json.RawMessage(encoded))
}

// flagMissingFieldHandler records a required field the model could not
// confidently fill (Req 3.1, 3.3). It writes NO value into st.content — the
// field stays empty for the technician to complete — and records the id in
// st.flagged (a set, so duplicate flags collapse). It may flag any field type,
// including a required photo or signature field, which is reported back as
// needing human capture rather than agent fill (Req 3.4).
//
// An unknown field id is rejected (Ok:false) and logged, leaving st.flagged
// unchanged so the model can correct itself.
func flagMissingFieldHandler(st *runState, call toolCall) toolResult {
	args := flagArgs(call)

	field, found := lookupField(st.schema, call.FieldID)
	if !found {
		result := toolResult{Ok: false, Detail: "unknown field id: " + call.FieldID}
		logTool(st, "flag_missing_field", args, result)
		return result
	}

	if st.flagged == nil {
		st.flagged = make(map[string]struct{})
	}
	st.flagged[field.ID] = struct{}{}

	result := toolResult{Ok: true, Detail: "flagged field " + field.ID + " as missing"}
	logTool(st, "flag_missing_field", args, result)
	return result
}

// flagArgs is the arguments record logged for a flag_missing_field dispatch. It
// carries the field id the model asked to flag so a run can be replayed.
func flagArgs(call toolCall) json.RawMessage {
	args := struct {
		FieldID string `json:"field_id"`
	}{FieldID: call.FieldID}
	encoded, _ := json.Marshal(args)
	return json.RawMessage(encoded)
}

// getTemplateSchemaHandler returns the active template's structure so the model
// knows which fields exist, their types, whether they are required, and (for
// select/checklist) their options (Req 5.1). It returns a shaped view rather
// than the raw TemplateSchema so the model sees exactly the five attributes it
// needs per field and nothing else.
func getTemplateSchemaHandler(st *runState, call toolCall) toolResult {
	view := schemaView(st.schema)
	result := toolResult{Ok: true, Data: view}
	logTool(st, "get_template_schema", noArgs(), result)
	return result
}

// schemaFieldView is the per-field shape returned by get_template_schema:
// exactly id, label, type, required, and options (Req 5.1).
type schemaFieldView struct {
	ID       string              `json:"id"`
	Label    string              `json:"label"`
	Type     templates.FieldType `json:"type"`
	Required bool                `json:"required"`
	Options  []string            `json:"options,omitempty"`
}

// schemaSectionView is the per-section shape returned by get_template_schema.
type schemaSectionView struct {
	ID     string            `json:"id"`
	Label  string            `json:"label"`
	Fields []schemaFieldView `json:"fields"`
}

// schemaView projects a TemplateSchema into the ordered sections → fields shape
// get_template_schema hands to the model, preserving section and field order.
func schemaView(schema templates.TemplateSchema) []schemaSectionView {
	sections := make([]schemaSectionView, 0, len(schema.Sections))
	for _, section := range schema.Sections {
		fields := make([]schemaFieldView, 0, len(section.Fields))
		for _, field := range section.Fields {
			fields = append(fields, schemaFieldView{
				ID:       field.ID,
				Label:    field.Label,
				Type:     field.Type,
				Required: field.Required,
				Options:  field.Options,
			})
		}
		sections = append(sections, schemaSectionView{
			ID:     section.ID,
			Label:  section.Label,
			Fields: fields,
		})
	}
	return sections
}

// getJobHistoryHandler returns this customer's past jobs for context (Req 5.2).
// It prefers an explicit job_id from the call, falling back to the run's own
// jobID. An empty history is a success (Ok:true with an empty slice), so the
// agent degrades gracefully while no job data exists (Req 5.3). A provider
// error is surfaced as Ok:false so the model can proceed without the context.
//
// TODO: the toolHandler signature carries no request context, so this uses
// context.Background(). The empty provider is cheap/local today; when a real
// JobHistoryProvider lands (a DB query), the request context should be threaded
// through runState so a cancelled run cancels the query too.
func getJobHistoryHandler(st *runState, call toolCall) toolResult {
	jobID := st.jobID
	if strings.TrimSpace(call.JobID) != "" {
		id := call.JobID
		jobID = &id
	}

	entries, err := st.jobs.History(context.Background(), jobID)
	if err != nil {
		result := toolResult{Ok: false, Detail: "could not load job history"}
		logTool(st, "get_job_history", jobHistoryArgs(jobID), result)
		return result
	}

	result := toolResult{Ok: true, Data: entries}
	logTool(st, "get_job_history", jobHistoryArgs(jobID), result)
	return result
}

// jobHistoryArgs is the arguments record logged for a get_job_history dispatch,
// recording the resolved job id (or null when the run has none).
func jobHistoryArgs(jobID *string) json.RawMessage {
	var value any
	if jobID != nil {
		value = *jobID
	}
	args := struct {
		JobID any `json:"job_id"`
	}{JobID: value}
	encoded, _ := json.Marshal(args)
	return json.RawMessage(encoded)
}

// getPartsCatalogHandler returns the parts catalog so the model can match
// mentioned parts to real catalog entries (Req 5.4). An empty catalog is a
// success (Ok:true with an empty slice) so the run continues while no catalog
// data exists (Req 5.5). A provider error is surfaced as Ok:false.
//
// TODO: uses context.Background() for the same reason as get_job_history — the
// handler signature carries no request context yet. Thread the request context
// through runState when a real PartsCatalogProvider (a DB query) lands.
func getPartsCatalogHandler(st *runState, call toolCall) toolResult {
	entries, err := st.parts.Catalog(context.Background())
	if err != nil {
		result := toolResult{Ok: false, Detail: "could not load parts catalog"}
		logTool(st, "get_parts_catalog", noArgs(), result)
		return result
	}

	result := toolResult{Ok: true, Data: entries}
	logTool(st, "get_parts_catalog", noArgs(), result)
	return result
}

// noArgs is the arguments record logged for a tool call that carries no
// arguments (get_template_schema, get_parts_catalog): an empty JSON object.
func noArgs() json.RawMessage {
	return json.RawMessage("{}")
}
