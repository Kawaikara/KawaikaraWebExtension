# Localization

[Documentation](Index.md)

Extension-owned UI copy lives in `_locales/en/messages.json`, `_locales/ko/messages.json`,
and `_locales/ja/messages.json`. Add the same message key to all three catalogs.

```ts
import { t } from './i18n';

const label = t('connectionStatus');
```

`src/i18n.ts` derives valid keys from the English catalog. The settings language selector
supports System, English, Korean, and Japanese. System uses `chrome.i18n.getMessage`;
explicit choices use the same bundled catalogs and persist in extension-local storage.
The manifest default is English. Keep translations in catalogs, not parallel strings in UI code.
Browser-owned installation text and manifest names still follow the browser locale.

Technical diagnostic errors, including `throw new Error(...)`, are written in English.
Use localized messages for user guidance and append technical details when useful.
Provider names and action titles follow the shared Provider contract's locale resolution.

The root README is English. Translated user introductions belong in `Docs/README/`
and are linked from the root README. Implementation and build topics belong in `Docs/`.
