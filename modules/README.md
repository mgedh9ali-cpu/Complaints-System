# Modules (planned structure)

The live application still boots from `server.js` (modular monolith path).
This folder documents the intended boundaries for later extraction:

| Module | Responsibility |
|--------|----------------|
| `auth` | login, session, roles, CSRF helpers |
| `complaints` | CRUD, status machine, state sync |
| `attachments` | upload validation and storage |
| `audit` | hash chain, integrity checks |
| `reports` | CSV / Excel / stats |
| `backup` | backup, restore drill, verify endpoint |
| `settings` | provinces, entities, categories, SLA |

Do not move routes here until service layers exist and tests stay green.
