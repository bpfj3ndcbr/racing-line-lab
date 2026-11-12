import './style.css';
import { createStore } from './io/storage';
import { Session } from './store/session';
import { mountApp } from './ui/app';
import { createLeafletMap } from './ui/trackMap';
import { ThemeController } from './ui/theme';
import { registerServiceWorker } from './io/pwa';

const store = createStore();
const theme = new ThemeController(store); // 描画前に適用して、ちらつきを防ぐ
mountApp(document.getElementById('app')!, new Session(store), theme, createLeafletMap, { startupAbout: true });
registerServiceWorker();          // Web 版の PWA(ネットが無くても起動できるように。案件 31)
