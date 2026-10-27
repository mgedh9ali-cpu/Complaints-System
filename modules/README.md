# Modules layout (Phase 1 foundation)

This directory is the target structure for splitting the monolithic `server.js` / `app.js`.

| Module | Responsibility |
|--------|----------------|
| `auth/` | Login, logout, sessions, roles, user management |
| `complaints/` | Create / update / status transitions / search |
| `attachments/` | Upload, validate, download, delete |
| `audit/` | Audit events + hash-chain integrity |
| `reports/` | Excel, CSV, administrative stats |
| `backup/` | Database backup & restore |
| `settings/` | Provinces, entities, categories, SLA |

Each module will eventually export:

- `service.js` — business logic (no Express)
- `routes.js` — Express routers
- `validators.js` — input validation (optional)

**Phase 1 goal:** only scaffolding + documentation.  
Logic still lives in `server.js` until Phase 2 migrates it safely behind tests.
