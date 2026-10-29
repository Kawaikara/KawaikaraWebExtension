# Release versioning

[Documentation](Index.md) · [Build](Build.md)

## Before the first release

The planned initial distribution version is **0.1.0**. Keep `package.json` and the root
package entries in `package-lock.json` at that version during local development.
The build reads `package.json` to generate both browser manifests. Routine code edits,
documentation changes, and unpacked-extension reloads do not require version bumps.
Use Git commits to identify development changes.

## Published updates

After distributing 0.1.0, increment the extension version for subsequent distributed
updates, for example 0.1.1. Browser update selection relies on increasing versions.
Do not reuse 0.1.0 for every published update.

Resetting a local development version does not create an automatic downgrade path for
an already distributed higher version. If higher versions have been published or
submitted under the same extension identity, review that distribution history before
attempting a 0.1.0 release.

References: [Chrome manifest version](https://developer.chrome.com/docs/extensions/reference/manifest/version),
[Firefox update handling](https://extensionworkshop.com/documentation/manage/updating-your-extension/),
and [Firefox version rollback requirements](https://extensionworkshop.com/documentation/publish/version-rollback/).

## Independent protocol versions

The extension distribution version is separate from the Provider catalog contract
(currently `version: 2`), connection data schemas, and options/worker UI schema
(currently `uiVersion: 1`). Do not change those protocol values when resetting the
extension version or editing documentation.

Catalog contract changes can invalidate earlier Provider grants and require enabling
Providers again. Handle compatibility and migrations explicitly when a schema changes;
a package version bump alone does not refresh loaded workers or fix protocol mismatches.

## Create upload archives

```sh
npm ci
npm run check
npm run package
```

`dist/releases/` contains production Chrome and Firefox ZIPs with `manifest.json` at
the archive root, a source ZIP for reviewer rebuilds, and `SHA256SUMS`. The source ZIP
includes the lockfile; run `npm ci && npm run build` to reproduce the unpacked output.
No local credentials, browser profiles, `node_modules`, or development output are included.
The ZIPs are unsigned submission artifacts. Packaging does not publish or sign an extension.

Chrome: upload the Chrome ZIP to the developer dashboard. Firefox: upload the Firefox ZIP
and supply the source ZIP when requested. The Firefox build requires 140 or later and declares
`browsingActivity`, because explicit Provider actions transmit the chosen page/link URL to
the locally connected Kawaikara app. Do not declare `none` for this bridge. Provider data is
declarative and validated; the adapter does not evaluate downloaded JavaScript.

[Chrome ZIP preparation](https://developer.chrome.com/docs/webstore/prepare) and
[Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
describe the submission formats. Store listing, privacy disclosures and reviewer approval
remain separate from creating these files; no store acceptance has been asserted.

A development connection checkbox changes discovery mode, not the installed extension name.
For a visibly marked development installation, load `dist/development/chrome` or
`dist/development/firefox` after `npm run build:development`. Those builds display
**Kawaikara WebExtension Dev** and a **D** toolbar badge. Upload only production ZIPs.

## Local validation notes (0.1.0)

`web-ext lint --source-dir dist/firefox` reports zero errors. Its three warnings are:
Android compatibility of the data-consent declaration (this release targets desktop),
and two `innerHTML` assignments inside the bundled React DOM implementation.
The extension source does not use `dangerouslySetInnerHTML` or assign `innerHTML`;
Provider strings render as text. Supply the source archive to let reviewers inspect these
bundled-library paths. These checks do not replace store review or Firefox runtime testing.
