# frontend/ — React + TypeScript

Mobile-first, responsive UI for technicians (in the field, one-handed, outdoors)
and dispatchers/admins (template building, review, history). Worth building as an
installable PWA if the offline stretch goal is attempted.

## Layout

```
frontend/
├── src/
│   ├── pages/
│   │   ├── Login/            # login + role-select (technician / dispatcher-admin)
│   │   ├── TemplateBuilder/  # drag-and-drop block editor (dispatcher-facing)
│   │   ├── ReportEditor/     # manual + agent-assisted fill, shared UI
│   │   └── Dashboard/        # dispatcher job/report history + template management
│   ├── components/           # shared, reusable UI pieces
│   ├── api/                  # typed client for the Go backend (single source of the contract)
│   └── styles/               # mobile-first, high-contrast theme
└── package.json
```

## Conventions

- **All backend calls go through `src/api/`** — no `fetch()` scattered through components. This keeps the Go↔TS contract in one place and is a natural target for a Kiro hook that regenerates types when the API changes.
- **Never call the LLM gateway from here.** The gateway API key is backend-only. The frontend talks to our Go backend, which proxies to the gateway.
- **Mobile-first, field conditions:** big tap targets, usable one-handed, high contrast for outdoor sun, no tiny dropdowns. Bake this into `src/styles/` rather than per-component.
- Build the drag-and-drop template builder on an existing library (e.g. dnd-kit), not a custom canvas from scratch.

## Running (intended)

```bash
npm install
npm run dev
```

> Scaffold stage: directories currently hold `README.md` placeholders describing intended responsibilities. Implementation lands on top.
