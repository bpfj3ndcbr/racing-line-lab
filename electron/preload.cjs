'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 画面側(renderer)に渡す窓口。Node の機能そのものは渡さず、必要な操作だけを公開する。
contextBridge.exposeInMainWorld('rllNative', {
  /** 保存先(同期。小さな設定データだけ) */
  storageGet: (key) => ipcRenderer.sendSync('storage:get', key),
  storageSet: (key, value) => { ipcRenderer.send('storage:set', key, value); },
  /** 保存したものを、すべて消す(同期。消し終わってから画面を読み直すため) */
  storageClear: () => { ipcRenderer.sendSync('storage:clear'); },
  /** 選んだファイルの場所 */
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  /** 場所を指定して、走行ログを読む(自動読み込み用) */
  readTextFile: (p) => ipcRenderer.invoke('file:read-text', p),
  /** 保存ダイアログを出して、文字列をファイルに書く。{ ok, canceled?, path? } */
  saveText: (fileName, text) => ipcRenderer.invoke('file:save-text', fileName, text),
  /** 地図の保存(案件 2): 地図の画像の URL(保存範囲の中は、メイン側が保存して返す)と、保存した地図の操作 */
  tileUrl: 'rll-tile://tile/{z}/{x}/{y}.jpg',
  tilesSetAreas: (areas) => ipcRenderer.invoke('tiles:set-areas', areas),
  tilesList: () => ipcRenderer.invoke('tiles:list'),
  tilesRemove: (list) => ipcRenderer.invoke('tiles:remove', list),
  tilesClear: () => ipcRenderer.invoke('tiles:clear'),
  tilesPrefetch: (list) => ipcRenderer.invoke('tiles:prefetch', list),
  /** 新しい版の確認(案件 52): 押したときだけ、GitHub のタグの名前の一覧を取る。{ ok, tags? } */
  checkUpdate: () => ipcRenderer.invoke('update:check'),
});
