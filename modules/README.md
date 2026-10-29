# Modules layout

Logic is split out of the monolithic `server.js` into focused modules.

| Module | Files | Responsibility |
|--------|-------|----------------|
| `auth/` | middleware, service, routes | Login, logout, CSRF, users |
| `roles/` | service, routes | Role catalogue + permissions |
| `complaints/` | service, routes | State, create, status machine |
| `dashboard/` | service, routes | Dashboard aggregates |
| `attachments/` | service, routes | Upload / list / download / delete |
| `reports/` | service, routes | CSV + Excel exports |
| `settings/` | service, routes | Provinces, entities, categories, SLA |
| `backup/` | service, routes | Verified SQLite backup download |
| `audit/` | service, routes | Audit trail + chain verification |
| `sync/` | service, routes | Offline sync export / import |
| `health/` | service, routes | Liveness + admin metrics |

## Pattern

- `service.js` — business logic, no Express
- `routes.js` — Express `Router`, thin handlers

`server.js` owns: DB bootstrap, session, helmet, mounting routers, static files.
