# Dependency API compatibility

`minimatch-compat` and `glob-compat` contain only CommonJS/callback adapters for older transitive consumers in Electron Builder and ExcelJS. Matching and filesystem traversal are performed by the unmodified official packages `minimatch@11.0.2` and `glob@14.0.3`, installed through explicit npm aliases with lockfile integrity checks.

The package names are deliberately distinct from the upstream projects. npm overrides point legacy imports to these adapters; the actual upstream packages remain visible to `npm audit`. No advisory is ignored, no severity is filtered and no matching algorithm is copied or patched. Glob 7's internal RegExp representation is not emulated: filesystem traversal uses modern glob directly.

The supported legacy callers use callable/callback glob, `.glob`, `.sync`, `.hasMagic`, callable minimatch, `.match` and `.Minimatch`. Current named async, stream and iterator APIs are forwarded unchanged. Legacy event-emitting `Glob` internals are not used by this project. Tests exercise the actual ASAR, directory comparison, archiving and build allowlist consumers.

`rimraf-compat` implements only the literal temporary-file/directory cleanup contract used by `temp` in the unused Squirrel installer dependency. It uses maintained Node `fs.rm` / `fs.rmSync`, preserving callback completion and busy retries; it does not interpret deletion targets as glob patterns. No application or dependency caller uses glob deletion. Unzipper, Fast CSV and the download proxy agent are upgraded to official releases to remove their unsupported transitive dependencies.
