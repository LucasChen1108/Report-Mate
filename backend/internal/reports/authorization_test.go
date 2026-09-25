package reports

import "testing"

func TestReportPolicyIsSelfOnlyForEveryAuthenticatedRole(t *testing.T) {
	caller := identity{userID: "11111111-1111-4111-8111-111111111111"}
	otherID := "22222222-2222-4222-8222-222222222222"
	filter := scopeReportFilter(ListFilter{TechnicianID: otherID}, caller)
	if filter.TechnicianID != caller.userID {
		t.Fatalf("scoped technician = %q", filter.TechnicianID)
	}

	if ownsReport(caller, ReportRecord{}) {
		t.Fatal("report without an owner was accessible")
	}
	if ownsReport(caller, ReportRecord{TechnicianID: &otherID}) {
		t.Fatal("another user's report was accessible")
	}
	if !ownsReport(caller, ReportRecord{TechnicianID: &caller.userID}) {
		t.Fatal("caller's own report was not accessible")
	}
}
