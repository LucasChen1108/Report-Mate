package reports

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// exportContentType is the content type recorded on the attachments row and
// sent when the export is served back.
const exportContentType = "text/html; charset=utf-8"

// defaultExportDir mirrors config.defaultExportDir. It is duplicated here
// because cmd/server composes this package as reports.NewHandler(pool) and
// hands it no configuration; rather than change that signature, the export
// directory is read from the environment with the same default the config
// package applies, so both agree on where exports live.
const defaultExportDir = "./var/exports"

// exportDirFromEnv resolves the directory rendered exports are written to.
func exportDirFromEnv() string {
	if dir := strings.TrimSpace(os.Getenv("EXPORT_DIR")); dir != "" {
		return dir
	}
	return defaultExportDir
}

// exportView is the data the export document renders from. It is a flat,
// already-formatted view rather than the raw record: html/template should make
// escaping decisions, not formatting ones, and every branch a template can take
// is a branch nobody reviews.
type exportView struct {
	Title            string
	TemplateName     string
	TemplateRevision int
	ReportID         string
	CustomerName     string
	TechnicianName   string
	Status           string
	FilledBy         string
	CreatedAt        string
	UpdatedAt        string
	ExportedAt       string
	Sections         []exportSection
	Parts            []PartRow
	HasParts         bool
}

// exportSection is one rendered section of the report.
type exportSection struct {
	Label  string
	Fields []exportField
}

// exportField is one rendered field. Kind selects how the template presents the
// value, so the template itself never switches on a field type.
type exportField struct {
	Label string
	// Kind is one of "text", "list", "image" or "empty".
	Kind     string
	Text     string
	Items    []string
	Image    template.URL
	Caption  string
	FileName string
}

// renderExport renders a report into a SELF-CONTAINED HTML document: inline
// CSS, inline images, and no external reference of any kind. The artifact has
// to open and print from a filesystem years from now, on a machine that has
// never heard of this server.
//
// It is deliberately HTML and not PDF. The box this runs on cannot afford a
// headless Chrome, and a later phase converts these snapshots to PDF
// server-side without changing this function's callers or the export endpoint.
//
// The document is built with html/template and never by concatenation: every
// value in it — field values, captions, customer names — is user input, and
// this file gets opened in a browser.
func renderExport(record ReportRecord, templateName, technicianName string) ([]byte, error) {
	view := buildExportView(record, templateName, technicianName)

	var buf bytes.Buffer
	if err := exportTemplate.Execute(&buf, view); err != nil {
		return nil, fmt.Errorf("reports: render export: %w", err)
	}
	return buf.Bytes(), nil
}

// buildExportView flattens a report and its schema snapshot into the render
// model. It walks the SNAPSHOT, not the template's current schema, so the
// document reproduces the report as it was filled and signed off.
func buildExportView(record ReportRecord, templateName, technicianName string) exportView {
	view := exportView{
		Title:            record.Title,
		TemplateName:     templateName,
		TemplateRevision: record.TemplateRevision,
		ReportID:         record.ID,
		CustomerName:     record.CustomerName,
		TechnicianName:   technicianName,
		Status:           record.Status,
		FilledBy:         record.Content.FilledBy,
		CreatedAt:        formatTimestamp(&record.CreatedAt),
		UpdatedAt:        formatTimestamp(&record.UpdatedAt),
		ExportedAt:       formatTimestamp(record.ExportedAt),
		Parts:            record.Content.Parts,
		HasParts:         len(record.Content.Parts) > 0,
	}

	for _, section := range record.SchemaSnapshot.Sections {
		rendered := exportSection{Label: section.Label}
		for _, field := range section.Fields {
			rendered.Fields = append(rendered.Fields, buildExportField(field, record.Content.Values[field.ID]))
		}
		view.Sections = append(view.Sections, rendered)
	}
	return view
}

// buildExportField turns one field and its raw value into the rendered form.
// A value that is absent, null, or empty renders as an explicit "not filled in"
// marker rather than a blank space, so a reader can tell an unanswered field
// from a formatting failure.
func buildExportField(field templates.Field, raw json.RawMessage) exportField {
	rendered := exportField{Label: field.Label, Kind: "empty"}

	if isEmptyValue(field, raw) {
		return rendered
	}

	switch field.Type {
	case templates.FieldChecklist:
		items, ok := decodeStringSlice(raw)
		if !ok || len(items) == 0 {
			return rendered
		}
		rendered.Kind = "list"
		rendered.Items = items

	case templates.FieldPhoto:
		var photo photoValue
		if err := json.Unmarshal(raw, &photo); err != nil || photo.DataURL == nil {
			return rendered
		}
		rendered.Caption = photo.Caption
		rendered.FileName = photo.FileName
		if safe, ok := safeImageDataURL(*photo.DataURL); ok {
			rendered.Kind = "image"
			rendered.Image = safe
			return rendered
		}
		// The image is not an inline base64 image, so it cannot be embedded in
		// a self-contained document. Say so in the document rather than
		// emitting a broken <img> or, worse, a URL of an unvetted scheme.
		rendered.Kind = "text"
		rendered.Text = "[image omitted — not an inline image]"

	case templates.FieldSignature:
		value, ok := decodeString(raw)
		if !ok {
			return rendered
		}
		if safe, ok := safeImageDataURL(value); ok {
			rendered.Kind = "image"
			rendered.Image = safe
			return rendered
		}
		rendered.Kind = "text"
		rendered.Text = value

	default:
		value, ok := decodeString(raw)
		if !ok {
			return rendered
		}
		rendered.Kind = "text"
		rendered.Text = value
	}

	return rendered
}

// safeImageDataURL vets a value for use in an <img src> and, only when it
// passes, wraps it as a template.URL.
//
// WHY THE WRAPPER IS NEEDED AND WHY IT IS GATED: html/template refuses URL
// schemes it does not recognize as safe and rewrites them to "#ZgotmplZ",
// which silently blanks every photo in the export — data: is not on its safe
// list. template.URL bypasses that check, so it can only be applied to a value
// this function has proven is an inline base64 image. Anything else (a
// javascript: URL, a data:text/html payload, an SVG document) is refused and
// the caller renders a note instead.
func safeImageDataURL(value string) (template.URL, bool) {
	const prefix = "data:image/"

	if !strings.HasPrefix(value, prefix) {
		return "", false
	}
	separator := strings.Index(value, ",")
	if separator < 0 {
		return "", false
	}

	// The media type must be image/<subtype>;base64 and nothing else: no
	// parameters, no alternative encodings.
	header := value[len(prefix):separator]
	subtype, encoding, found := strings.Cut(header, ";")
	if !found || encoding != "base64" || subtype == "" {
		return "", false
	}
	// SVG is an active document format; excluded even though it is an image
	// type, since the export is opened in a browser.
	if strings.EqualFold(subtype, "svg+xml") {
		return "", false
	}
	for _, r := range subtype {
		if !isMediaSubtypeRune(r) {
			return "", false
		}
	}

	// The payload must be base64 and nothing else. Checked byte-wise rather
	// than with a regexp because these payloads run to megabytes.
	for i := separator + 1; i < len(value); i++ {
		if !isBase64Byte(value[i]) {
			return "", false
		}
	}

	return template.URL(value), true
}

// isMediaSubtypeRune reports whether r may appear in a media subtype token.
func isMediaSubtypeRune(r rune) bool {
	switch {
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		return true
	case r == '.', r == '+', r == '-':
		return true
	}
	return false
}

// isBase64Byte reports whether b may appear in a base64 payload, allowing the
// line breaks some encoders insert.
func isBase64Byte(b byte) bool {
	switch {
	case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9':
		return true
	case b == '+', b == '/', b == '=', b == '\r', b == '\n':
		return true
	}
	return false
}

// formatTimestamp renders a timestamp for the document, or an em dash when
// there is none. The export is read by people, so it is a readable UTC
// timestamp rather than RFC 3339.
func formatTimestamp(value *time.Time) string {
	if value == nil {
		return "—"
	}
	return value.UTC().Format("2006-01-02 15:04 UTC")
}

// exportStorageKey builds the path an export is stored at, RELATIVE to the
// export directory: one directory per report, one timestamped file per export.
// Keeping it relative means the export volume can be moved or remounted
// elsewhere without rewriting every attachments row.
func exportStorageKey(reportID string, now time.Time) string {
	return path.Join(reportID, fmt.Sprintf("export-%s.html", now.UTC().Format("20060102T150405.000000000")))
}

// writeExport writes a rendered export to disk under exportDir, creating the
// per-report directory as needed, and returns the absolute path written.
//
// It is called from inside the save-and-export transaction on purpose: if this
// fails, the transaction rolls back and the report is never left marked
// exported with no artifact behind it.
func writeExport(exportDir, storageKey string, document []byte) (string, error) {
	fullPath, err := resolveExportPath(exportDir, storageKey)
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return "", fmt.Errorf("reports: create export directory: %w", err)
	}
	if err := os.WriteFile(fullPath, document, 0o644); err != nil {
		return "", fmt.Errorf("reports: write export: %w", err)
	}
	return fullPath, nil
}

// readExport reads a stored export back for serving.
func readExport(exportDir, storageKey string) ([]byte, error) {
	fullPath, err := resolveExportPath(exportDir, storageKey)
	if err != nil {
		return nil, err
	}

	document, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, fmt.Errorf("reports: read export: %w", err)
	}
	return document, nil
}

// resolveExportPath joins a stored storage key onto the export directory and
// refuses anything that escapes it.
//
// The keys this package writes are always safe, but they are read back out of
// the database, and a path assembled from database content and handed to the
// filesystem is exactly the shape of a traversal bug. The check is here so the
// property holds regardless of what wrote the row.
func resolveExportPath(exportDir, storageKey string) (string, error) {
	if storageKey == "" {
		return "", fmt.Errorf("reports: export storage key is empty")
	}

	base, err := filepath.Abs(exportDir)
	if err != nil {
		return "", fmt.Errorf("reports: resolve export directory: %w", err)
	}

	fullPath := filepath.Join(base, filepath.FromSlash(storageKey))
	if fullPath != base && !strings.HasPrefix(fullPath, base+string(os.PathSeparator)) {
		return "", fmt.Errorf("reports: export storage key %q escapes the export directory", storageKey)
	}
	return fullPath, nil
}

// exportTemplate is the self-contained export document: one file, inline CSS,
// inline images, no external reference. The @page and print rules are here so
// the same file a dispatcher reads on screen is the one that prints correctly.
var exportTemplate = template.Must(template.New("export").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #14181f; background: #f4f5f7;
  }
  .sheet {
    max-width: 800px; margin: 0 auto; padding: 40px;
    background: #fff; border: 1px solid #dfe3e8; border-radius: 4px;
  }
  header { border-bottom: 3px solid #14181f; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { margin: 0 0 4px; font-size: 22px; line-height: 1.3; }
  .subtitle { margin: 0; color: #5b6472; font-size: 13px; }
  .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin: 20px 0 8px; }
  .meta div { display: flex; gap: 8px; font-size: 13px; }
  .meta dt, .meta .k { color: #5b6472; min-width: 110px; }
  .meta .v { font-weight: 600; word-break: break-word; }
  section { margin-top: 28px; page-break-inside: avoid; }
  h2 {
    margin: 0 0 12px; padding-bottom: 6px; font-size: 15px; text-transform: uppercase;
    letter-spacing: 0.06em; color: #5b6472; border-bottom: 1px solid #e4e7ec;
  }
  .field { padding: 10px 0; border-bottom: 1px solid #f0f2f5; page-break-inside: avoid; }
  .field:last-child { border-bottom: 0; }
  .label { display: block; font-size: 12px; color: #5b6472; margin-bottom: 4px; }
  .value { white-space: pre-wrap; word-break: break-word; }
  .empty { color: #98a1ae; font-style: italic; }
  ul.value { margin: 0; padding-left: 20px; white-space: normal; }
  figure { margin: 6px 0 0; }
  figure img { max-width: 100%; max-height: 420px; border: 1px solid #e4e7ec; border-radius: 3px; }
  figcaption { margin-top: 6px; font-size: 12px; color: #5b6472; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #e4e7ec; }
  th { background: #f7f8fa; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #5b6472; }
  td.qty, th.qty { text-align: right; white-space: nowrap; }
  footer {
    margin-top: 36px; padding-top: 14px; border-top: 1px solid #e4e7ec;
    font-size: 11px; color: #78818f; line-height: 1.7;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; }
  }
</style>
</head>
<body>
<main class="sheet">
  <header>
    <h1>{{.Title}}</h1>
    <p class="subtitle">{{.TemplateName}}</p>
  </header>

  <div class="meta">
    <div><span class="k">Customer</span><span class="v">{{if .CustomerName}}{{.CustomerName}}{{else}}—{{end}}</span></div>
    <div><span class="k">Technician</span><span class="v">{{if .TechnicianName}}{{.TechnicianName}}{{else}}—{{end}}</span></div>
    <div><span class="k">Created</span><span class="v">{{.CreatedAt}}</span></div>
    <div><span class="k">Last updated</span><span class="v">{{.UpdatedAt}}</span></div>
    <div><span class="k">Exported</span><span class="v">{{.ExportedAt}}</span></div>
    <div><span class="k">Status</span><span class="v">{{.Status}}</span></div>
  </div>

  {{range .Sections}}
  <section>
    <h2>{{.Label}}</h2>
    {{range .Fields}}
    <div class="field">
      <span class="label">{{.Label}}</span>
      {{if eq .Kind "text"}}
        <div class="value">{{.Text}}</div>
      {{else if eq .Kind "list"}}
        <ul class="value">{{range .Items}}<li>{{.}}</li>{{end}}</ul>
      {{else if eq .Kind "image"}}
        <figure>
          <img src="{{.Image}}" alt="{{.Label}}">
          {{if or .Caption .FileName}}<figcaption>{{.Caption}}{{if and .Caption .FileName}} · {{end}}{{.FileName}}</figcaption>{{end}}
        </figure>
      {{else}}
        <div class="value empty">Not filled in</div>
      {{end}}
    </div>
    {{end}}
  </section>
  {{end}}

  <section>
    <h2>Parts Used</h2>
    {{if .HasParts}}
    <table>
      <thead><tr><th>Part</th><th>Part number</th><th class="qty">Quantity</th></tr></thead>
      <tbody>
        {{range .Parts}}
        <tr>
          <td>{{if .Part}}{{.Part}}{{else}}—{{end}}</td>
          <td>{{if .PartNumber}}{{.PartNumber}}{{else}}—{{end}}</td>
          <td class="qty">{{if .Quantity}}{{.Quantity}}{{else}}0{{end}}</td>
        </tr>
        {{end}}
      </tbody>
    </table>
    {{else}}
    <div class="value empty">No parts were used on this job.</div>
    {{end}}
  </section>

  <footer>
    Filled against template &ldquo;{{.TemplateName}}&rdquo; revision {{.TemplateRevision}} ({{.FilledBy}} entry).<br>
    This document is a snapshot of the template as it was at fill time; later edits to the template do not change it.<br>
    Report {{.ReportID}} · generated by Report Mate.
  </footer>
</main>
</body>
</html>
`))
