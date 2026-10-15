# Connection and app launch

[Documentation](Index.md) · [Architecture](Architecture.md)

## Initial pairing

The recommended flow starts in Kawaikara: **Preferences → Advanced → Use extension**.
The app creates a one-time approval valid for two minutes and opens a loopback connection
page in the default browser. The extension must be installed and enabled in that browser.
On success, the extension replaces the same tab with its settings page.

The page is served at `http://127.0.0.1:<port>/extension-connect`. Its approval ticket
is placed in the URL fragment, avoiding HTTP request logs, and is removed from the
current history entry after extension handling. Credentials are never returned to the
page. Pairing checks the browser-supplied top-frame URL and actual tab, rather than
trusting addresses or credentials in page messages. No fixed extension ID is needed.
Opening the page alone does not disconnect an existing connection.

Alternatively, Connect in extension settings discovers running apps and asks the app
to approve the connection. Discovery uses loopback ports 43821–43830. If multiple
profiles are running or discovery is unavailable, use the advanced connection-code
flow. A failed or expired onboarding ticket requires a new request from the app.

## Cached actions and wake

Approved pairing responses can provide `launchUrl`, stored with the connection.
Only `kawaikara://bridge/wake` is accepted as an app launcher; executable paths,
arbitrary URLs, and commands are not accepted. Older connections may need to pair
again to receive launcher information.

An explicit user action can open the extension's `launch.html` page and request app
launch. The browser may ask for confirmation or block the request; the user can retry
through the launch button or start Kawaikara manually. The app needs an OS protocol
registration, including portable installations. Moving a portable installation or losing
that registration may require starting the app and reconnecting.

Pending actions live in extension storage for at most two minutes. The launch page
receives only an opaque ID. Waiting fails or is canceled after 90 seconds; closing the
page stops polling, and remaining records expire. Worker restarts preserve pending
records without launching the app automatically.

After discovery, a nonce/HMAC proof is verified before sending saved credentials to a
new port. The app reached through an OS handler is not trusted automatically. The
latest catalog revision, Provider grant, browser permission, and original tab URL are
rechecked before consuming and dispatching the pending action once. Ambiguous execution
responses are not automatically retried. A changed page or authorization requires a new click.

Periodic synchronization and DOM updates never launch the app.

## Offline settings

Provider toggles and setting changes remain drafts until Apply. When Apply is requested
offline, the extension requests app launch if a launcher is available, waits for authenticated
reconnection, rechecks permissions, and sends the change once. If the app does not
respond, the UI returns to an unsaved state. Old changes are not silently replayed later.
Local disconnect remains available offline.

## Development and troubleshooting

- Rebuilding does not refresh a browser's loaded manifest or worker. Reload the
  extension, close old settings tabs, reopen settings, and reload site tabs.
- The options page validates its worker response schema. A stale response missing
  fields such as `configured` produces reload guidance instead of `undefined.find`.
- If onboarding does not detect the adapter within ten seconds, check extension
  installation and reload it. Request a fresh connection page from the app.
- To use another supported browser, choose Add connection in the app, or connect
  directly from its extension settings.
- A running app is focused through authenticated `POST /v1/wake`.
- Unpackaged macOS/Linux `electron .` development runs do not offer OS deep-link
  launch. They advertise `launchUrl: null`; start them manually with `pnpm dev`.
  Test launch from a stopped state with a packaged app, for example `package:dev`.
- The extension does not invoke an arbitrary OS handler before initial pairing.
- Both sides need compatible wake and discovery-proof support. After desktop changes,
  restart Kawaikara as well as rebuilding/reloading the extension.

## Development selection and connection details

The app and extension now share an explicit **Use development connection** preference.
The app defaults it on for non-distribution builds (`pnpm start`) and saves overrides.
The extension defaults it on for Development builds; a normal build can opt in through
an approval popup in advanced settings. The worker persists that choice across restarts.
Changing connection mode does not change the installed build's name, D badge, or identity.

For app-initiated pairing, the page's selected mode and the extension's saved mode must
match. Content scripts ask their worker for this non-secret setting; they never read
credentials from storage. A mismatched extension leaves the page and ticket untouched.
The bridge rechecks the mode before consuming the ticket. Keep one extension enabled
per connection mode when using multiple installations.

For extension-initiated pairing, the saved mode selects a development or distribution
app during discovery. Start the development app with `pnpm start` before connecting.
Manual connection codes bypass mode selection. Authenticated reconnection remains bound
to the paired app, independently of discovery preferences.

The app shows Use extension/Disconnect alongside an always-visible Details button,
disabled when disconnected. Details identify the paired browser and actual extension
build/version. After ten seconds without a matching extension, the image-based connection
page displays installation and mode-selection guidance.

## Draft settings and batch approval

Provider switches, individual settings, and Enable all/Disable all edit a local draft.
They do not send grants or settings mutations. A fixed footer offers Apply and Cancel;
closing with a draft triggers the browser's unsaved-changes guard.

Apply requests the union of required browser host permissions in the user gesture,
then sends one authenticated `POST /v1/configure` with the base catalog revision and
changed Provider IDs, enabled states, and settings. Kawaikara validates every change and
shows one summary in its own preferences popup. It revalidates the revision and connection
after approval before committing all grants together. Denial, stale catalogs, revocation,
or invalid settings leave the batch unapplied. The extension retains its draft on failure;
Cancel discards the draft without a mutation request.

Browser host permissions can already have been approved when an app-level request is
denied, but no Provider capabilities are enabled by that browser permission alone.
The app popup is controlled through trusted settings IPC with a per-request ID; stale
responses are rejected. Closing it, leaving preferences, timing out, or shutting down
does not approve pending requests. Native OS confirmation dialogs are no longer used.

## Multiple browser profiles

Kawaikara stores N independent connections. Each extension profile has a locally generated
instance ID, its own credential, Provider grants, and settings. Chrome and Firefox can
stay connected concurrently; browser profiles with the same extension ID remain separate.
Creating a connection code or adding a browser does not revoke existing connections.

Use **Add connection** in the app to select an installed Chrome or Firefox. The primary
connect action still uses the OS default browser. The picker opens the browser's normal
profile; for another browser profile, open its extension settings and use a connection
code. Connection details list every authorized client, actual build/version and a short
connection ID, with individual disconnect controls. The main Disconnect button revokes all.

After an app revocation, the bridge returns a nonce-bound HMAC proof using that client's
existing secret. The extension clears cached Providers, scripts, menus, launch authority
and pending actions only after validating the proof. An unreachable app or an unrelated
service returning 401 is not a revocation: cached launch entries remain available offline.
The settings page checks every three seconds; background alarms check every thirty seconds.
The informational notice clears after seven seconds. Revocation tombstones persist across
app restarts so an offline extension can learn that its authority was removed.

An old singleton desktop connection migrates into one client record. Existing credentials
continue to work; the instance header binds subsequent profile-specific discovery. Provider
consent is never shared between clients. Connection mode and installed build identity remain
separate, including for additional connections.

### Browser selection and portable installations

The desktop picker hides Chrome/Firefox families that already have an authorized connection.
Choose browser application opens a native file picker for a macOS `.app`, Windows `.exe`,
or Linux executable. It supports portable installs and alternate versions without scanning
the filesystem for every browser. Only the chosen app is launched, with a validated loopback
pairing URL; executable paths are not accepted from the settings renderer. Selection is
one-time and does not register a new browser or install an extension.

A compatible adapter must already be installed in that browser. Chromium extension origins
and Firefox extension origins are supported by the protocol; selecting an app alone does not
make an incompatible browser supported. Other profiles can also use a manual connection code.
Language changes are saved locally without waiting for desktop synchronization. If an older
worker rejects the language command, reload the extension and reopen its settings tab.

### Disconnect while the desktop is offline

The adapter saves a durable disconnect intent before removing its active credential,
Provider cache, content scripts, menus, and queued launch actions. The UI immediately
becomes disconnected and shows when desktop notification remains pending.

Worker startup, settings refresh, and the existing 30-second synchronization alarm
retry pending intents. The browser must still be running with the extension enabled;
the adapter never launches Kawaikara just to deliver a disconnect. The desktop may
therefore continue listing the old connection until it receives the request.

Each intent retains its old credential in trusted extension-local storage solely for
revocation. Discovery must prove possession of that credential before the adapter
sends it, including after a port change. An acknowledgement or a verified signed
already-revoked response removes the intent. Network errors and unverified responses
keep it for retry. Pending credentials never restore Provider access or become the
active connection. A crash during local cleanup cannot resurrect a pending connection.
Uninstalling the extension or clearing its storage also removes undelivered intents;
in that case, remove the stale connection from Kawaikara itself.
