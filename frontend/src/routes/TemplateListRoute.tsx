// TemplateListRoute — adapts TemplateListPage's callback props to the router.
//
// TemplateListPage was written before the router existed, so it reports its two
// navigations as callbacks (onOpen / onNew) instead of navigating itself. That
// is the right shape — the page stays router-agnostic and testable — so this
// wrapper supplies the navigation rather than the page being rewritten.
//
// NOTE on onOpen: the page hands over a FULLY LOADED TemplateRecord (it already
// called getTemplate to surface a failed open without navigating). We use only
// `record.id` and let TemplateBuilderRoute refetch on the way in. That is one
// redundant GET, traded for a builder route that works when opened cold from a
// pasted /templates/:id/edit URL — the same code path either way, instead of
// two.

import { useNavigate } from "react-router-dom";
import { TemplateListPage } from "../pages/TemplateList/TemplateListPage";

export function TemplateListRoute() {
  const navigate = useNavigate();

  return (
    <TemplateListPage
      onOpen={(record) => navigate(`/templates/${encodeURIComponent(record.id)}/edit`)}
      onNew={() => navigate("/templates/new")}
    />
  );
}

export default TemplateListRoute;
