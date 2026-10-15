const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
async function run({ fail = false } = {}) {
  const calls = [];
  const nodes = Object.fromEntries(
    ['status', 'launch', 'cancel'].map((id) => [
      id,
      {
        hidden: false,
        click() {
          this.clicks = (this.clicks || 0) + 1;
        },
      },
    ]),
  );
  let polls = 0;
  const context = vm.createContext({
    document: { getElementById: (id) => nodes[id] },
    setTimeout: (fn) => setImmediate(fn),
    Date,
    chrome: {
      i18n: {
        getMessage: (key) => require('../_locales/ko/messages.json')[key]?.message || '',
        getUILanguage: () => 'ko',
      },
      runtime: {
        sendMessage: async ({ type }) => {
          calls.push(type);
          if (type === 'launch-info') return { result: { launchUrl: 'kawaikara://bridge/wake' } };
          if (type === 'launch-resume') {
            polls++;
            return fail
              ? { error: 'Provider changed' }
              : { result: polls === 1 ? { waiting: true } : { completed: true } };
          }
          return { result: {} };
        },
      },
    },
  });
  await vm.runInContext(
    fs.readFileSync(require.resolve('../dist/chrome/launch.js'), 'utf8'),
    context,
  );
  for (let i = 0; i < 10 && !nodes.cancel.hidden; i++) await new Promise(setImmediate);
  return { nodes, calls };
}
test('launch page requests OS launch once and polls until action is delivered', async () => {
  const f = await run();
  assert.equal(f.nodes.launch.clicks, 1);
  assert.deepEqual(f.calls, ['launch-info', 'launch-resume', 'launch-resume']);
  assert.match(f.nodes.status.textContent, /전달했습니다/);
  assert.equal(f.nodes.cancel.hidden, true);
});
test('failed resume cancels pending intent without retrying it', async () => {
  const f = await run({ fail: true });
  assert.deepEqual(f.calls, ['launch-info', 'launch-resume', 'launch-cancel']);
  assert.equal(f.nodes.status.textContent, 'Provider changed');
});
