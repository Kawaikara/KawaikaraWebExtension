# Testing

[Documentation](Index.md) · [Build](Build.md)

## Routine checks

```sh
npm run check
npm run format:check
```

`check` runs TypeScript checking, rebuilds both browser targets, and runs the Node.js
test suite. Tests cover connection authentication, Provider settings and permissions,
cache and wake behavior, SPA document validation, React options, and connection/launch pages.

Use `npm run typecheck` for types only, `npm test` to build and run tests, and
`npm run format` to apply the repository's Prettier configuration.

## Browser smoke test

```sh
node scripts/browser-smoke.mjs /path/to/kawaikara/dev3
```

Build the extension first. The desktop checkout must have its dependencies installed,
including the Patchright browser runtime and esbuild required by the script.
The script uses an isolated Chromium profile, real Provider manifests from the desktop
checkout, and its HTTP bridge implementation. It exercises automatic connection,
Provider settings, YouTube/CHZZK DOM menus, and action dispatch.

HTTP and HTTPS permissions are pre-granted separately in the temporary profile.
The smoke test checks Chrome manifest acceptance and explicit permission schemes;
it does not replace testing real user permission prompts or the Firefox runtime.

## Manual verification

For both supported browsers, check first connection, enabling/disabling a Provider,
permission prompts, site navigation without a full reload, offline action launch,
reconnection, and disconnect cleanup. Verify app focus in development and app launch
with a packaged installation separately. See [Connection](Connection.md) for expected limitations.

## Connection and batch regression

```sh
npm run build
npm run build:development
node scripts/connection-smoke.mjs
```

This isolated Chromium test loads both builds, verifies automatic routing for both
connection modes and explicit development opt-in on a regular build, and checks that
drafts send one batch on Apply and no request on Cancel. It uses a test bridge with
automated consent and fixture-only host permissions; it does not manipulate the user's
app or browser profile. App popup approval lifecycle is also covered by the desktop
`web-extension-download.test.cjs` suite.

`node scripts/connection-smoke.mjs` uses a temporary Chromium profile and the real desktop
bridge to check standard/development selection, independent clients, desktop revocation,
language persistence and one-request draft/apply. Build both channels first. It does not
modify the user's browser or claim Firefox runtime coverage.
