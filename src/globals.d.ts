import type * as Contract from './provider-contract';
declare global {
  var KawaikaraContract: typeof Contract;
  var __kawaikaraProviderRenderer: (() => Promise<void>) | undefined;
}
