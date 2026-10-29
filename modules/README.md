# Modules layout

Logic is split out of the monolithic `server.js` into focused modules.

| Module | Files | Responsibility |
|--------|-------|----------------|
| `auth/` | `middleware.js`, `service.js`, `routes.js` | Login, logout, CSRF, users |
| `roles/` | `service.js`, `routes.js` | Role catalogue + permission matrix |
| `complaints/` | `service.js`, `routes.js` | State, create complaint, status machine |
| `dashboard/` | `service.js`, `routes.js` | Aggregated dashboard summary |
| `attachments/` | `service.js`, `routes.js` | Upload, list, download, delete |
| `reports/` | `service.js`, `routes.js` | CSV + Excel exports |
| `settings/` | `service.js`, `routes.js` | Provinces, entities, categories, SLA |
| `audit/` | *(planned)* | Audit events + hash chain |
| `backup/` | *(planned)* | Backup & restore |

## Pattern

- `service.js` — business logic, no Express
- `routes.js` — Express `Router`, thin handlers

`server.js` owns: DB bootstrap, session, helmet, mounting routers, and remaining endpoints (backup, offline-sync).
