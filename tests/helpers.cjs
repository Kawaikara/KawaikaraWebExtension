const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function catalogContext(extra = {}) {
  const context = vm.createContext({ URL, ...extra });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../dist/chrome/provider-contract.js'), 'utf8'),
    context,
  );
  return context;
}
const provider = {
  version: 2,
  id: 'thirdparty.video',
  title: 'Third-party video',
  domains: ['video.example'],
  actions: ['watch', 'share', 'archive', 'bookmark'],
  actionDefinitions: {
    watch: { title: 'Watch', handler: 'open' },
    share: { title: 'Share', handler: 'provider', clipboard: true },
    archive: { title: 'Archive', handler: 'download' },
    bookmark: { title: 'Bookmark', handler: 'provider' },
  },
  settings: [{ id: 'menus', title: 'Show menus', defaultValue: true }],
  contextMenus: [
    {
      id: 'watch-page',
      action: 'watch',
      title: 'Watch custom video',
      contexts: ['page', 'video'],
      when: 'menus',
    },
    { id: 'save-link', action: 'bookmark', title: 'Bookmark this link', contexts: ['link'] },
  ],
  toolbarAction: 'share',
  domActions: [
    {
      id: 'player',
      event: 'contextmenu',
      trigger: '[data-player]',
      target: '[data-menu]',
      layout: 'button-list',
      itemClass: '',
      requireVideo: true,
      items: [{ id: 'bookmark', action: 'bookmark', title: 'Save for later' }],
    },
  ],
};
module.exports = { catalogContext, provider };
