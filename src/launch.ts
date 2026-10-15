import { t } from './i18n';
import type { Reply } from './types';
import { errorMessage } from './types';
// This packaged page keeps the pending operation alive across worker suspension.
// Its URL contains only an opaque request ID, never a credential or target URL.
(async () => {
  const status = document.getElementById('status')!;
  const launch = document.getElementById('launch') as HTMLAnchorElement;
  const cancel = document.getElementById('cancel') as HTMLButtonElement;
  let stopped = false;
  async function send(type: string) {
    const reply: Reply<{ launchUrl?: string; completed?: boolean; waiting?: boolean }> =
      await chrome.runtime.sendMessage({ type });
    if (reply.error) throw new Error(reply.error);
    if (!reply.result) throw new Error('Missing launch response.');
    return reply.result;
  }
  cancel.textContent = t('cancel');
  launch.textContent = t('openApp');
  cancel.onclick = () => {
    stopped = true;
    launch.hidden = true;
    cancel.disabled = true;
    void send('launch-cancel').catch(() => {});
    status.textContent = t('actionCancelled');
  };
  try {
    const info = await send('launch-info');
    if (info.launchUrl !== 'kawaikara://bridge/wake')
      throw new Error('Reconnect in settings to save the app launcher.');
    launch.href = info.launchUrl;
    launch.hidden = false;
    status.textContent = t('waitingForLaunch');
    launch.click();
    const deadline = Date.now() + 90000;
    while (!stopped && Date.now() < deadline) {
      const result = await send('launch-resume');
      if (stopped) return;
      if (result.completed) {
        stopped = true;
        launch.hidden = true;
        cancel.hidden = true;
        status.textContent = t('actionDelivered');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!stopped)
      throw new Error('Could not connect. Start the paired app and retry from the original page.');
  } catch (error) {
    if (stopped) return;
    stopped = true;
    await send('launch-cancel').catch(() => {});
    status.textContent = errorMessage(error);
    cancel.hidden = true;
  }
})();
