# Dependency API compatibility

`minimatch-compat` and `glob-compat` contain only CommonJS/callback adapters for older transitive consumers in Electron Builder and ExcelJS. Matching and filesystem traversal are performed by the unmodified official packages `minimatch@11.0.5` and `glob@14.0.4`, installed through explicit npm aliases with lockfile integrity checks.

The package names are deliberately distinct from the upstream projects. The actual upstream packages remain visible to `npm audit`. No advisory is ignored, no severity is filtered and no matching algorithm is copied or patched. Glob 7's internal RegExp representation is not emulated: filesystem traversal uses modern glob directly.

## Why the adapters carry an upstream version number

Each adapter declares the upstream version it stands in for — `glob-compat` is `7.2.3`, `minimatch-compat` is `10.2.6`, `rimraf-compat` is `2.6.3`. npm only reuses an installed package for a consumer when the installed version satisfies the consumer's declared range, so the adapters must present a version inside that range for every legacy consumer to resolve onto them instead of onto a second, older copy. The declared version is the *API contract* the adapter serves; the engine that actually runs is the patched upstream package listed in `dependencies`.

Because the adapters are local `file:` packages, the lockfile records them under their own names, so `npm audit` evaluates the patched engines (`glob-patched`, `minimatch-patched`) rather than the historical version string. `npm ls --all` therefore stays free of both invalid markers and advisories.

Two consumers declare ranges that no patched release satisfies: `app-builder-lib` requires `minimatch@^10.2.5` and `@electron/universal` requires `minimatch@^9.0.3`, while the advisory is only fixed from `11.0.1`. Those two edges are pinned by the `overrides` block in `package.json` to `npm:minimatch@11.0.5`; the subtrees that still need the callable legacy API (`@electron/asar`, `dir-compare`) are pinned back to `npm:minimatch@3.1.5`. `uuid` is raised to `11.1.1` for ExcelJS, which only calls `uuid.v4()`.

The supported legacy callers use callable/callback glob, `.glob`, `.sync`, `.hasMagic`, callable minimatch, `.match` and `.Minimatch`. Current named async, stream and iterator APIs are forwarded unchanged. Legacy event-emitting `Glob` internals are not used by this project. Tests exercise the actual ASAR, directory comparison, archiving and build allowlist consumers.

`rimraf-compat` implements only the literal temporary-file/directory cleanup contract used by `temp` in the unused Squirrel installer dependency. It uses maintained Node `fs.rm` / `fs.rmSync`, preserving callback completion and busy retries; it does not interpret deletion targets as glob patterns. No application or dependency caller uses glob deletion. Unzipper, Fast CSV and the download proxy agent are upgraded to official releases to remove their unsupported transitive dependencies.
