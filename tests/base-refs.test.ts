// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/io/storage';
import { REF_NAME_MAX, Session } from '../src/store/session';
import { mountApp } from '../src/ui/app';
import { ThemeController } from '../src/ui/theme';
import { FakeMap } from './helpers';

// 基準設定(案件 85): サーキットごとの基準の保存・選択と、「基準設定」の節
const vbo = readFileSync('fixtures/20260913140139_UTC.vbo', 'utf8');
const cln = readFileSync('fixtures/cl_autopolis.cln', 'utf8');
const sci = readFileSync('fixtures/autopolis.sci', 'utf8');
const bigPath = 'fixtures/session_20260506_094550_autopolis.vbo';
const big = existsSync(bigPath);
const file = (name: string) => ({ name, size: vbo.length, text: async () => vbo }) as unknown as File;

async function loaded(store = new MemoryStore()) {
  const s = new Session(store);
  s.registerCircuit('オートポリス', cln, sci);
  await s.addVboFile(file('a.vbo'), undefined, 0);
  return s;
}
const circuitOf = (s: Session) => s.sets[0].logs[0].circuit!.id;

describe('基準の保存(Session)', () => {
  it('ラップを基準にでき、表示名を変えられ、外せる。名前は上限で切る。同じラップは 2 度登録しない', async () => {
    const s = await loaded();
    const log = s.sets[0].logs[0];
    s.addRef(log.id, 1);
    s.addRef(log.id, 1);
    s.addRef(log.id, 999);                                    // 無いラップ
    const [r] = s.refsOf(circuitOf(s));
    expect(s.refsOf(circuitOf(s))).toHaveLength(1);
    expect(s.refAt(log.id, 1)?.id).toBe(r.id);
    expect(s.refLabel(r)).toBe(`Run ${log.no} LAP 1`);        // 名前が無いときは「Run X LAP n」
    s.renameRef(r.id, 'あ'.repeat(REF_NAME_MAX + 3));
    expect(s.refLabel(s.refsOf(circuitOf(s))[0])).toBe('あ'.repeat(REF_NAME_MAX));
    s.renameRef(r.id, ' CR ');
    expect(s.refLabel(s.refsOf(circuitOf(s))[0])).toBe('CR');
    s.removeRef(r.id);
    expect(s.refsOf(circuitOf(s))).toHaveLength(0);
  });

  it('保存される(新しい Session でも残る)。別のサーキットの基準は出ない', async () => {
    const store = new MemoryStore();
    const s = await loaded(store);
    s.addRef(s.sets[0].logs[0].id, 1);
    expect(new Session(store).getSetting<unknown[]>('refs', [])).toHaveLength(1);
    expect(s.refsOf('別のサーキット')).toHaveLength(0);
  });

  it('基準にした走行ログをどの比較セットからも外すと、基準も外れて知らせる(ほかのセットに残っていれば残す)', async () => {
    const s = await loaded();
    const id = s.sets[0].logs[0].id, cid = circuitOf(s);
    await s.addVboFile(file('a.vbo'), undefined, 1);          // 同じログを比較セット 2 にも入れる
    s.addRef(id, 1);
    s.removeLog(id, 0);
    expect(s.refsOf(cid)).toHaveLength(1);
    s.removeLog(id, 1);
    expect(s.getSetting<unknown[]>('refs', [])).toHaveLength(0);
    expect(s.message).toContain('基準からも外しました');
  });

  it('比較基準の選択: 初めは割当最速。使えない値(割り当ての無いカード・無い基準)は、割当最速に戻して知らせる', async () => {
    const s = await loaded();
    expect(s.sets[0].miniBase).toBe('fastest');
    s.setMiniBase('card:A');                                  // A に割り当てが無い
    expect(s.sets[0].miniBase).toBe('fastest');
    expect(s.message).toContain('割当最速に戻しました');
    s.setMiniBase('ref:無い');
    expect(s.sets[0].miniBase).toBe('fastest');
    s.toggleAssignment('A', { logId: s.sets[0].logs[0].id, lap: 1 });
    s.setMiniBase('card:A');
    expect(s.sets[0].miniBase).toBe('card:A');
  });
});

describe('「基準設定」の節', () => {
  let root: HTMLElement;
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });
  async function boot() {
    (window as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    const store = new MemoryStore();
    const s = await loaded(store);
    mountApp(root, s, new ThemeController(store), () => new FakeMap());
    return s;
  }
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

  it('基準にしたラップに「基準 N」、カードを割り当てたラップに「(A)」〜の札(同じ大きさ)。ミニセクター表の基準にしている走行には「(基準表示中)」(案件 86)', async () => {
    const s = await boot();
    const log = s.sets[0].logs[0];
    const lap = log.laps.find((x) => x.complete)!.number;
    expect(root.querySelector('.refs-using')).toBeNull();
    expect(root.querySelector('.refs-cd')).toBeNull();
    s.toggleAssignment('A', { logId: log.id, lap });
    const row = () => q(`.refs-lap:nth-of-type(${lap})`);
    const chips = () => Array.from(root.querySelectorAll('.refs-lap .refs-pc .refs-chip, .refs-lap .refs-pc .refs-cd')).map((c) => c.textContent);       // 基準 N の札と、カードの丸(A〜D)
    expect(chips()).toEqual(['A']);
    expect(root.querySelector('.refs-cd')!.classList.contains('sa')).toBe(true);      // カードの丸と同じ色の class
    s.addRef(log.id, lap);
    expect(chips()).toEqual(['基準1', 'A']);
    expect(root.querySelector('.refs-using')).toBeNull();                      // 基準にしただけでは出ない(割当最速のまま)
    s.setMiniBase(`ref:${s.refsOf(circuitOf(s))[0].id}`);
    expect(q('.refs-lap .refs-using').textContent).toBe('基準表示中');
    expect(q('.refs-file > summary .refs-using')).not.toBeNull();             // 走行ログのタイトル部の上にも出る
    expect(Array.from(root.querySelectorAll('.refs-file > summary .refs-tags .refs-chip')).map((c) => c.textContent)).toEqual(['基準表示中', '基準1']);
    expect(row()).not.toBeNull();
    s.setMiniBase('fastest');
    expect(root.querySelector('.refs-using')).toBeNull();
  });

  it('スマホの縦画面の行(案件 86): 先頭に「編集」。札は LAP 名の上。「編集」で、基準にする・解除・表示名の段が開閉する(描き直しても開いたまま)', async () => {
    const s = await boot();
    const log = s.sets[0].logs[0];
    const lap = log.laps.find((x) => x.complete)!.number;
    s.toggleAssignment('A', { logId: log.id, lap });
    s.addRef(log.id, lap);
    s.setMiniBase(`ref:${s.refsOfByTime(circuitOf(s))[0].id}`);
    const row = () => root.querySelector<HTMLElement>(`.refs-lap[data-ekey="${log.id}#${lap}"]`)!;
    const name = () => row().querySelector('.rc-name')!;
    expect(name().querySelector<HTMLElement>('.refs-edit')!.textContent).toBe('編集');
    expect(name().firstElementChild!.classList.contains('refs-pc')).toBe(true);        // PC 幅の並びは、そのまま残している
    expect(Array.from(name().querySelectorAll('.refs-ltags > *')).map((c) => c.textContent)).toEqual(['基準表示中', '基準1', 'A']);
    expect(name().querySelector('.refs-ln')!.textContent).toBe(`LAP ${lap}`);
    expect(row().classList.contains('editing')).toBe(false);
    row().querySelector<HTMLButtonElement>('.refs-edit')!.click();
    expect(row().classList.contains('editing')).toBe(true);
    expect(row().querySelector('.rc-act .refs-del')).not.toBeNull();                    // 下の段: 解除・表示名・確定(「閉じる」は無く、「編集」をもう一度押すと閉じる)
    expect(row().querySelector('.refs-close')).toBeNull();
    expect(row().querySelector('.rc-act .refs-name')).not.toBeNull();
    s.renameRef(s.refsOfByTime(circuitOf(s))[0].id, 'CR');                              // 描き直されても、開いたまま
    expect(row().classList.contains('editing')).toBe(true);
    row().querySelector<HTMLButtonElement>('.refs-edit')!.click();
    expect(row().classList.contains('editing')).toBe(false);
  });

  it('走行ログごとに閉じた 1 行(最速ラップ)で出る。開くとラップごとに「基準にする」。押すと基準になり、表示名を入れられる', async () => {
    const s = await boot();
    expect(q('#refs-badge').textContent).toBe('基準なし');
    expect(root.querySelectorAll('.refs-file')).toHaveLength(1);
    expect(q('.refs-file summary').textContent).toContain('a.vbo');
    expect(root.querySelectorAll('.refs-lap').length).toBeGreaterThan(0);
    expect(q('.refs-file summary .rc-rank').textContent).toBe('1');            // 全ログの中での順位
    q<HTMLButtonElement>('.refs-set').click();
    expect(q('#refs-badge').textContent).toBe('基準 1 件');
    expect(q('.refs-file summary .refs-chip').textContent).toBe('基準1');       // 閉じていても、基準があると分かる
    const inp = q<HTMLInputElement>('.refs-name');
    inp.value = 'CR';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(s.refLabel(s.refsOf(circuitOf(s))[0])).toBe('CR');
    expect(q<HTMLInputElement>('.refs-name').value).toBe('CR');
    q<HTMLInputElement>('.refs-name').value = 'PB';                              // 入力して「確定」を押しても、表示名になる
    q<HTMLButtonElement>('[data-act="ref-name-ok"]').click();
    expect(s.refLabel(s.refsOf(circuitOf(s))[0])).toBe('PB');
    q<HTMLButtonElement>('[data-act="ref-del"]').click();
    expect(q('#refs-badge').textContent).toBe('基準なし');
  });

  it('サーキットごとに畳める(描き直しても畳んだまま)。各走行ログのベストのラップの行は、色が付く(is-best)', async () => {
    const s = await boot();
    const c = q<HTMLDetailsElement>('.refs-circuit');
    expect(c.open).toBe(true);
    c.open = false;
    c.dispatchEvent(new Event('toggle'));
    s.addRef(s.sets[0].logs[0].id, 1);                                       // 描き直しが走る
    expect(q<HTMLDetailsElement>('.refs-circuit').open).toBe(false);
    q<HTMLDetailsElement>('.refs-circuit').open = true;
    q<HTMLDetailsElement>('.refs-circuit').dispatchEvent(new Event('toggle'));
    s.removeRef(s.refsOf(circuitOf(s))[0].id);
    expect(q<HTMLDetailsElement>('.refs-circuit').open).toBe(true);
    const best = Array.from(root.querySelectorAll('.refs-file .refs-lap.is-best'));
    expect(best).toHaveLength(1);                                            // 走行ログ 1 本につき 1 行
    const times = Array.from(root.querySelectorAll('.refs-file .refs-lap')).map((r) => r.querySelector('.rc-time')!.textContent);
    expect(best[0].querySelector('.rc-time')!.textContent).toBe(q('.refs-file summary .rc-time').textContent);   // 閉じた行のタイムと同じ
    expect(times.length).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!big)('基準の番号は、ラップタイムの速い順(基準1 = いちばん速い基準)。閉じた行にも、その走行ログの基準の番号が並ぶ。解除ボタンは基準の印の右', async () => {
    const s = await boot();
    const big = readFileSync(bigPath, 'utf8');
    await s.addVboFile({ name: 'big.vbo', size: big.length, text: async () => big } as unknown as File, undefined, 0);
    const log = s.sets[0].logs.find((l) => l.id.startsWith('big.vbo'))!;
    const laps = log.laps.filter((l) => l.complete).sort((a, b) => a.duration - b.duration);
    expect(laps.length).toBeGreaterThanOrEqual(2);
    s.addRef(log.id, laps[laps.length - 1].number);                          // 先に遅い方を基準にする
    s.addRef(log.id, laps[0].number);
    const rows = Array.from(root.querySelectorAll(`.refs-file[data-fid="${log.id}"] .refs-lap`));
    const byNo = rows.map((r) => r.querySelector('.refs-chip')?.textContent ?? '');
    expect(byNo.filter(Boolean).sort()).toEqual(['基準1', '基準2']);
    const fast = rows.find((r) => r.classList.contains('is-best'))!;
    expect(fast.querySelector('.refs-chip')!.textContent).toBe('基準1');       // 速い方が 1
    expect(fast.querySelector('.refs-chip + button[data-act="ref-del"]')).not.toBeNull();
    expect(root.querySelector(`.refs-file[data-fid="${log.id}"] summary`)!.textContent).toContain('基準1基準2');
  });

  it('同じ走行ログが複数の比較セットにあっても 1 回だけ出る。サーキットが決まっていない走行ログは出ない', async () => {
    const s = await boot();
    await s.addVboFile(file('a.vbo'), undefined, 1);
    expect(root.querySelectorAll('.refs-file')).toHaveLength(1);
    s.removeLog(s.sets[0].logs[0].id, 0);
    s.removeLog(s.sets[1].logs[0].id, 1);
    expect(q('#refs-list').textContent).toContain('サーキットが決まった走行ログを読み込むと');
  });
});
