import { t, setLocale } from './i18n';
// Only the app's loopback onboarding page loads this adapter. No page messages or scripts are executed.
(async () => {
  if (
    window.top !== window ||
    !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/extension-connect#[a-f0-9]{64}(?::(?:development|production))?$/.test(
      location.href,
    )
  )
    return;
  const modeReply = await chrome.runtime.sendMessage({ type: 'desktop-connect-mode' });
  if (modeReply?.error || typeof modeReply?.result?.developmentConnection !== 'boolean') return;
  const mode = modeReply.result.developmentConnection;
  setLocale(modeReply.result.language || 'system');
  if (location.href.endsWith(':development') !== mode) return;
  const status = document.getElementById('connection-status');
  if (!status) return;
  status.dataset.adapter = 'detected';
  status.textContent = t('connectingToApp');
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'desktop-connect' });
    if (reply?.error || !reply?.result?.connected)
      throw new Error(reply?.error || 'Connection failed.');
    status.textContent = t('connectionComplete');
  } catch (error) {
    const installation = document.getElementById('installation');
    if (installation) installation.hidden = false;
    status.textContent = t('connectionFailed') + (error instanceof Error ? error.message : '');
  } finally {
    // Remove the spent/failed one-use secret from the current browser history entry.
    history.replaceState(null, '', '/extension-connect');
  }
})();
