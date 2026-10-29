# Modules layout

Logic is split out of the monolithic `server.js` into focused modules.

| Module | Files | Responsibility |
|--------|-------|----------------|
| `auth/` | `middleware.js`, `service.js`, `routes.js` | Login, logout, CSRF, roles, users |
| `complaints/` | `service.js`, `routes.js` | State, create complaint, status machine |
| `attachments/` | *(planned)* | Upload, validate, download, delete |
| `audit/` | *(planned)* | Audit events + hash chain |
| `reports/` | *(planned)* | Excel, CSV, stats |
| `backup/` | *(planned)* | Backup & restore |
| `settings/` | *(planned)* | Provinces, entities, categories, SLA |

## Pattern

- `service.js` — business logic, no Express
- `routes.js` — Express `Router`, thin handlers
- `middleware.js` / `validators.js` — shared guards

`server.js` owns: DB bootstrap, session, helmet, mounting routers, and remaining endpoints not yet extracted (attachments, sync, backup).
