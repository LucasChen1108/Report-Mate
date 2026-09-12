# pages/ReportEditor/

The technician's core screen: pick a template, fill it in, review, submit. Handles
**both** the manual-fill path and the agent-assisted path through the same UI.

## What it does

- Render a chosen template's schema into an editable form (one field per blank,
  typed per the schema).
- **Manual fill:** technician types/selects values directly.
- **Agent-assisted fill:** technician gives a rough free-text/voice account; the
  request goes to the backend agent (never the gateway directly), which fills
  blanks and flags fields it couldn't confidently fill.
- **Human-in-the-loop review:** the technician always reviews and can edit the
  draft — agent-filled, hand-filled, or mixed — before submitting. Nothing is
  submitted without this step.
- Clearly mark agent-filled vs. flagged-missing fields so the reviewer knows what
  to check.
- Trigger PDF export of the finished report.

## Notes

- Graceful degradation: if the agent/gateway is down, the same template is still
  fully fillable by hand. No hard dependency on the AI being up.
- Mobile-first: big tap targets, one-handed use, high contrast.

Owner: Letao & Aaron (rendering/export). Wires to the agent (Week 2).
