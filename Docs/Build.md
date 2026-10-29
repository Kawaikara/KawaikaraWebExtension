# Build

[Documentation](Index.md) · [Testing](Testing.md) · [Releases](Releases.md)

## Dependencies

Use Node.js 20 or newer and npm. Dependencies must also support your selected Node.js
release; check any engine requirements reported by npm.

```sh
npm ci
```

The options page uses React and `@kawaikara/kawai-ui`. Runtime source is strict
TypeScript; esbuild produces browser JavaScript bundles.

## Shared Provider contract

The checked-in `src/provider-contract.ts` is generated from the Kawaikara app's
`packages/site-api/src/WebExtension.ts`. Synchronize it when the shared contract changes:

```sh
npm run sync:providers
# Or specify the desktop checkout:
node scripts/sync-providers.mjs /path/to/kawaikara/dev3
```

The default checkout is `../kawaikara/dev3`. This copies only contract types and
validation code. Provider catalogs and site implementations come from the connected app.
Review the generated diff before committing it.

## Build outputs

```sh
npm run build
```

The production build type-checks source and recreates its browser output directories:

| Browser      | Output         | Background runtime         |
| ------------ | -------------- | -------------------------- |
| Chrome 121+  | `dist/chrome`  | Manifest V3 service worker |
| Firefox 140+ | `dist/firefox` | Background scripts         |

Both manifests take their extension version from `package.json`. Locale catalogs,
icons, HTML, styles, and bundled scripts are included in each output. Edit source files,
then rebuild; generated output is replaced on the next build.

Load the output using the [installation instructions](../README.md#installation).
After changing source, rebuild and reload the extension from the browser's extension
management page. Close old settings tabs and reopen settings. Reload affected site tabs
so their content scripts are also replaced. A version increment is not required for
this local development cycle.

## Development extension

```sh
npm run build:dev
```

Load `dist/development/chrome` or `dist/development/firefox/manifest.json` for the
`Kawaikara WebExtension Dev` extension. Its toolbar badge displays `D`,
and its settings header identifies the channel. Production outputs remain at
`dist/chrome` and `dist/firefox`. The two build commands preserve each other's output.
Firefox uses separate extension IDs; Chrome unpacked builds use their separate directories.
Both channels keep the planned release version 0.1.0. Names are also distinguished in
the toolbar tooltip, settings header/footer, and settings tab title. The production
name remains `Kawaikara WebExtension`.

Build both channels together with `npm run build:all`. `build:development` remains
available as an alias for the development build. `npm run package` builds and packages
only the production extension.
