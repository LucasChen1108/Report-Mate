package dashboard

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// Leading columns every export carries before the template's own fields. They
// are the report metadata the table shows outside the field grid.
var leadingCSVHeaders = []string{"Date", "Status", "Customer", "Revision"}

// csvDateLayout is how a report's timestamp is written. RFC3339 is unambiguous
// about the offset, which a spreadsheet's locale-guessing is not, and both
// Excel and Sheets parse it as a date.
const csvDateLayout = time.RFC3339

// writeCSV renders a TableView as CSV: the leading metadata columns, then one
// column per template field, then a row per report.
//
// It takes the same TableView the JSON endpoint returns, so the export is by
// construction the same columns and the same flattened cells the user is
// looking at on screen — there is no second formatting path to drift.
func writeCSV(w io.Writer, view TableView) error {
	writer := csv.NewWriter(w)

	header := make([]string, 0, len(leadingCSVHeaders)+len(view.Columns))
	header = append(header, leadingCSVHeaders...)
	header = append(header, csvColumnHeaders(view.Columns)...)
	if err := writer.Write(header); err != nil {
		return fmt.Errorf("dashboard: csv header: %w", err)
	}

	for _, row := range view.Rows {
		record := make([]string, 0, len(header))
		record = append(record,
			row.CreatedAt.Format(csvDateLayout),
			row.Status,
			row.CustomerName,
			strconv.Itoa(row.TemplateRevision),
		)
		for _, column := range view.Columns {
			record = append(record, row.Cells[column.FieldID])
		}
		if err := writer.Write(record); err != nil {
			return fmt.Errorf("dashboard: csv row %q: %w", row.ReportID, err)
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return fmt.Errorf("dashboard: csv flush: %w", err)
	}
	return nil
}

// csvColumnHeaders names each field column. A label is used as-is unless two
// sections of the template use the same one — then both are qualified with
// their section, because two identically named columns in a spreadsheet are
// indistinguishable once the file leaves the app.
func csvColumnHeaders(columns []TableColumn) []string {
	seen := make(map[string]int, len(columns))
	for _, column := range columns {
		seen[column.Label]++
	}

	headers := make([]string, 0, len(columns))
	for _, column := range columns {
		if seen[column.Label] > 1 && column.SectionLabel != "" {
			headers = append(headers, column.SectionLabel+" / "+column.Label)
			continue
		}
		headers = append(headers, column.Label)
	}
	return headers
}

// csvFilename derives the download name from the template name, e.g.
// "HVAC Service Report" -> "hvac-service-report-reports-2026-09-21.csv".
// The result is ASCII, lowercase and dash-separated so it is safe in a
// Content-Disposition header and on every filesystem.
func csvFilename(templateName string, now time.Time) string {
	return fmt.Sprintf("%s-reports-%s.csv", slugify(templateName), now.Format("2006-01-02"))
}

// slugify reduces a name to lowercase ASCII words joined by dashes, falling
// back to "template" when nothing usable survives (a template named entirely in
// a non-Latin script, for instance).
func slugify(value string) string {
	var b strings.Builder
	lastDash := true // leading dashes are suppressed
	for _, r := range strings.ToLower(value) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		return "template"
	}
	return slug
}
