package reports

import (
	"context"
	"database/sql"
	"path"
	"time"
)

// SaveAndExportResponse is the body of a successful save-and-export. Its JSON
// shape mirrors the frontend api/reportTypes.ts SaveAndExportResponse exactly:
// the persisted report, and the URL its rendered document can be fetched from.
type SaveAndExportResponse struct {
	Report    ReportRecord `json:"report"`
	ExportURL string       `json:"exportUrl"`
}

// Service holds the one operation in this package that is more than a read or a
// write: save-and-export, which has to make several writes and a file appear
// together or not at all.
type Service struct {
	store     *Store
	exportDir string
}

// NewService returns a Service backed by store, writing exports under
// exportDir.
func NewService(store *Store, exportDir string) *Service {
	return &Service{store: store, exportDir: exportDir}
}

// SaveAndExport saves the submitted content and produces the report's export
// document, in ONE transaction, in this order:
//
//	BEGIN
//	  write content / title / customer onto the report
//	  DELETE the parts_used rows, INSERT the submitted ones with their position
//	  ValidateContent(requireComplete = true)   <- a failure here rolls back
//	  status = 'exported', exported_at = now()
//	  render the HTML snapshot and write it to the export directory
//	  INSERT the attachments row pointing at it
//	COMMIT
//
// THE ORDER IS THE POINT. Validation runs after the write so the transaction
// has the exact persisted content in hand, and before the status change so an
// incomplete report can never reach 'exported'. The file is written inside the
// transaction so that a failed write rolls the status back with it — a report
// marked exported with no artifact behind it is a lie the dashboard would go on
// telling. The transaction is held across a disk write, which is unusual and
// accepted: the write is one small local file, and the alternative is a
// reconciliation problem nobody would own.
//
// A report that fails validation is left exactly as it was, still a draft.
func (s *Service) SaveAndExport(ctx context.Context, id string, params UpdateParams) (SaveAndExportResponse, error) {
	var record ReportRecord

	err := s.store.withTx(ctx, func(tx *sql.Tx) error {
		// Save. The report must already exist — it is named by the path, and
		// the only way to create one is POST /api/reports — so this is an
		// update that returns ErrNotFound rather than inserting a row whose
		// template nothing could identify.
		saved, err := updateReport(ctx, tx, id, params)
		if err != nil {
			return err
		}

		// Completeness is enforced against the report's OWN schema snapshot,
		// never the template's current schema: the report is signed off
		// against what was on screen when it was filled.
		if err := ValidateContent(saved.SchemaSnapshot, saved.Content, true); err != nil {
			return err
		}

		exported, err := markExported(ctx, tx, id)
		if err != nil {
			return err
		}
		// markExported re-reads the row but not the parts table; carry the
		// parts that were just written rather than paying for another query.
		exported.Content.Parts = saved.Content.Parts

		templateName, err := templateNameFor(ctx, tx, exported.TemplateID)
		if err != nil {
			return err
		}
		technician, err := technicianName(ctx, tx, exported.TechnicianID)
		if err != nil {
			return err
		}

		document, err := renderExport(exported, templateName, technician)
		if err != nil {
			return err
		}

		storageKey := exportStorageKey(exported.ID, time.Now())
		if _, err := writeExport(s.exportDir, storageKey, document); err != nil {
			return err
		}

		if err := insertExportAttachment(ctx, tx, exported.ID, storageKey, exportContentType, len(document)); err != nil {
			return err
		}

		record = exported
		return nil
	})
	if err != nil {
		return SaveAndExportResponse{}, err
	}

	return SaveAndExportResponse{Report: record, ExportURL: exportURL(record.ID)}, nil
}

// Export reads back the most recent rendered document for a report, along with
// the content type to serve it as.
//
// It returns ErrNotFound for an unknown report and ErrNoExport for a report
// that exists but has never been exported, so the caller can tell a wrong URL
// from a report nobody has exported yet.
func (s *Service) Export(ctx context.Context, id string) ([]byte, string, error) {
	ref, err := s.store.LatestExport(ctx, id)
	if err != nil {
		return nil, "", err
	}

	document, err := readExport(s.exportDir, ref.StorageKey)
	if err != nil {
		return nil, "", err
	}

	contentType := ref.ContentType
	if contentType == "" {
		contentType = exportContentType
	}
	return document, contentType, nil
}

// exportURL is the canonical URL a report's export is served from. It is built
// in one place because it is returned to the client as data (exportUrl) as well
// as being a route this package registers — the two must not drift.
func exportURL(reportID string) string {
	return path.Join("/api/reports", reportID, "export")
}
