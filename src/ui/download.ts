import { alertDialog } from './dialog';

/**
 * 文字列をファイルとして保存する。
 * Electron では保存ダイアログを出して書き込み、ブラウザではダウンロードにする。
 */
export function downloadText(fileName: string, text: string, mime = 'text/plain'): void {
  const native = typeof window !== 'undefined' ? window.rllNative : undefined;
  if (native) {
    void native.saveText(fileName, text).then((r) => {
      if (!r.ok && !r.canceled) void alertDialog({ title: '保存できませんでした', detail: r.error });
    });
    return;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
