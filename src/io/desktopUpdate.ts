import { isNewerVersion, latestVersion } from '../core/version';

/**
 * デスクトップ版の「更新を確認する」(案件 52)。押したときだけ、GitHub のタグの一覧を取ってきて(メイン側。窓口は
 * rllNative.checkUpdate)、今の版と比べる。自動では確認しない。.app は配布しないので、更新そのものはしない(案内だけ)。
 */
export type DesktopUpdate =
  | { status: 'latest' }
  | { status: 'newer'; latest: string }
  | { status: 'failed' };

/** 更新の手順(README のインストール方法)。ブラウザで開く */
export const UPDATE_GUIDE_URL = 'https://github.com/bpfj3ndcbr/racing-line-lab#インストール方法';

export async function checkDesktopUpdate(
  native: { checkUpdate?: () => Promise<{ ok: boolean; tags?: string[] }> } | undefined,
  current: string,
): Promise<DesktopUpdate> {
  if (!native?.checkUpdate) return { status: 'failed' };
  try {
    const r = await native.checkUpdate();
    const latest = r.ok && Array.isArray(r.tags) ? latestVersion(r.tags.filter((t) => typeof t === 'string')) : null;
    if (!latest) return { status: 'failed' };
    return isNewerVersion(latest, current) ? { status: 'newer', latest } : { status: 'latest' };
  } catch {
    return { status: 'failed' };
  }
}
