# Kawaikara WebExtension

[한국어](Docs/README/ko.md) · [日本語](Docs/README/ja.md)

Use browser features provided by your Kawaikara Providers, including context menus
and page actions such as opening or downloading a video in Kawaikara.
The extension connects your browser to Kawaikara and adapts the features declared
by enabled Providers. Available features depend on your installed Providers.

## Installation

Supported browsers: **Google Chrome 121+** and **Mozilla Firefox 140+**.
A compatible Kawaikara app is required.

For a local build, follow the [build guide](Docs/Build.md), then load it:

- **Chrome:** open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
  and select `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**,
  and select `dist/firefox/manifest.json`. This temporary installation lasts until Firefox closes.

## Quick start

1. Run Kawaikara. In **Preferences → Advanced**, choose **Use extension**.
2. The connection page opens in your default browser. On success, that same tab becomes
   the extension settings page. Use a browser where the extension is installed and enabled.
3. Find the Provider you want, draft its WebExtension features, then choose **Apply** and approve the requested permissions.
4. Visit a supported site and use the Provider's menus or page actions.

You can also connect from extension settings and approve the request in Kawaikara.
Provider features can be enabled or disabled individually. Disconnecting removes the
connection and cached features.

Approved features remain visible while Kawaikara is offline. Using one requests that
Kawaikara open and reconnect before executing it. Automatic launch requires a registered
app launcher; development builds may require starting Kawaikara manually.

## Documentation

See [Docs](Docs/Index.md) for building, testing, connection troubleshooting,
implementation, localization, and release versioning.
