import './style.css';
import { createStore } from './io/storage';
import { Session } from './store/session';
import { mountApp } from './ui/app';
import { createLeafletMap } from './ui/trackMap';
import { ThemeController } from './ui/theme';
import { createUpdateWatcher, registerServiceWorker } from './io/pwa';
import { openInstanceLock } from './io/instance';
import { isSharedLaunch } from './io/share';
import { startSingle } from './ui/instanceGate';

const store = createStore();
const theme = new ThemeController(store); // 描画前に適用して、ちらつきを防ぐ
const updates = createUpdateWatcher();
const root = document.getElementById('app')!;
// Web 版・PWA 版は、同時に 1 つの窓だけで起動する(案件 60)。共有の画面から開いたときは、先の窓から奪う
void startSingle(root, window.rllNative ? null : openInstanceLock(),
  () => mountApp(root, new Session(store), theme, createLeafletMap, { startupAbout: true, updates }),
  { steal: isSharedLaunch() });
registerServiceWorker(updates);          // Web 版の PWA(ネットが無くても起動できるように。案件 31)
