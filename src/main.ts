/**
 * SumiRE（墨入れ / 菫）— メインエントリーポイント
 *
 * 機能：
 * 1. 文字を極力排した SumiRE ブランドロゴ ＆ Lucide アイコンのみのミニマルツールバー
 * 2. 立ち上げたプロジェクト内（または選択したフォルダ内）のスクリプト群をノートとして束ね、
 *    左右ボタン（◀ / ▶ または Alt+← / Alt+→）でノートのようにページ移動できる仕組み
 * 3. 画面右下（VS Code風ステータスバー内）に 0〜100% の進行度を表示
 * 4. 視線移動ゼロの「ゴーストなぞり書き（墨入れ）レイヤー」＋ VS Code 風シンタックスハイライト描画
 * 5. タイプライター式キー入力（誤字も赤文字としてその場に入力され、Backspaceで消して打ち直す）
 * 6. 先頭インデント自動スキップ＆コメント行スキップ
 * 7. 現在入力中の行を常に画面の一番上に固定するモード（ON/OFF切替対応）
 */

import {
  createIcons,
  ChevronLeft,
  ChevronRight,
  Pin,
  MessageSquareOff,
  Volume2,
  VolumeX,
  SunMoon,
  Moon,
  Sun,
  RotateCcw,
  FolderOpen,
  FileCode2,
  FolderDown,
  CheckCheck,
} from 'lucide';

import { shouldSkipLine } from './core/parser';
import { tokenizeLineChars } from './core/highlighter';
import { TypingSession } from './core/session';
import {
  NotePage,
  createLoadedPage,
  ensurePageLoaded,
  fetchServerNotebook,
  isSupportedScriptPath,
  loadDevSelfPages,
} from './core/notebook';
import { SoundEngine } from './audio/sound';

// Lucide アイコンをDOMへ描画
createIcons({
  icons: {
    ChevronLeft,
    ChevronRight,
    Pin,
    MessageSquareOff,
    Volume2,
    VolumeX,
    SunMoon,
    Moon,
    Sun,
    RotateCcw,
    FolderOpen,
    FileCode2,
    FolderDown,
    CheckCheck,
  },
});

// DOM要素の取得
const codeSheetEl = document.getElementById('code-sheet') as HTMLDivElement;
const editorContainerEl = document.getElementById('editor-container') as HTMLElement;

// ノートページャー関連DOM
const btnPrevPageEl = document.getElementById('btn-prev-page') as HTMLButtonElement;
const btnNextPageEl = document.getElementById('btn-next-page') as HTMLButtonElement;
const pageCounterEl = document.getElementById('page-counter') as HTMLSpanElement;
const fileSelectEl = document.getElementById('file-select') as HTMLSelectElement;

// アイコンボタン・コントロール関連DOM
const folderInputEl = document.getElementById('folder-input') as HTMLInputElement;
const fileInputEl = document.getElementById('file-input') as HTMLInputElement;
const btnPinTopEl = document.getElementById('btn-pin-top') as HTMLButtonElement;
const btnSkipCommentsEl = document.getElementById('btn-skip-comments') as HTMLButtonElement;
const btnSoundEl = document.getElementById('btn-sound') as HTMLButtonElement;
const soundIconOnEl = document.getElementById('sound-icon-on') as HTMLSpanElement;
const soundIconOffEl = document.getElementById('sound-icon-off') as HTMLSpanElement;

const btnThemeEl = document.getElementById('btn-theme') as HTMLButtonElement;
const themeIconSystemEl = document.getElementById('theme-icon-system') as HTMLSpanElement;
const themeIconDarkEl = document.getElementById('theme-icon-dark') as HTMLSpanElement;
const themeIconLightEl = document.getElementById('theme-icon-light') as HTMLSpanElement;

const btnResetEl = document.getElementById('btn-reset') as HTMLButtonElement;

// ステータスバー＆右下進行度関連DOM
const statusLineInfoEl = document.getElementById('status-line-info') as HTMLSpanElement;
const statusProgressEl = document.getElementById('status-progress') as HTMLSpanElement;
const statusHintEl = document.getElementById('status-hint') as HTMLSpanElement;
const dropOverlayEl = document.getElementById('drop-overlay') as HTMLDivElement;

const hudPercentNumEl = document.getElementById('hud-percent-num') as HTMLSpanElement;
const hudProgressFillEl = document.getElementById('hud-progress-fill') as HTMLDivElement;
const hudCharDetailEl = document.getElementById('hud-char-detail') as HTMLSpanElement;

const sound = new SoundEngine();

// トグル状態（初期値すべてON）
let isPinTopEnabled = true;
let isSkipCommentsEnabled = true;

// テーマ管理（'system' [デフォルト] -> 'dark' -> 'light'）
type ThemeMode = 'system' | 'dark' | 'light';
const THEME_STORAGE_KEY = 'sumire:theme-mode';
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

let currentThemeMode: ThemeMode =
  (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null) || 'system';

function applyTheme(mode: ThemeMode): void {
  currentThemeMode = mode;
  localStorage.setItem(THEME_STORAGE_KEY, mode);

  const resolvedTheme: 'dark' | 'light' =
    mode === 'system' ? (systemDarkQuery.matches ? 'dark' : 'light') : mode;

  document.documentElement.setAttribute('data-theme', resolvedTheme);

  themeIconSystemEl.classList.toggle('hidden', mode !== 'system');
  themeIconDarkEl.classList.toggle('hidden', mode !== 'dark');
  themeIconLightEl.classList.toggle('hidden', mode !== 'light');

  const modeLabel =
    mode === 'system'
      ? `システム同期 (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})`
      : mode === 'dark'
        ? 'ダークモード'
        : 'ライトモード';
  btnThemeEl.title = `テーマ切り替え [現在: ${modeLabel}]`;
}

// OS側の配色設定が変わった際、「システム同期（system）」ならリアルタイム反映
systemDarkQuery.addEventListener('change', () => {
  if (currentThemeMode === 'system') {
    applyTheme('system');
  }
});

applyTheme(currentThemeMode);

// ノートのページ（起動時に sumire コマンドのサーバーから受け取る。init() を参照）
let pages: NotePage[] = [];
let currentPageIndex = 0;

/** 開いているページのセッション。ページがない・まだ読み込み中のときは null */
function getCurrentSession(): TypingSession | null {
  return pages[currentPageIndex]?.session ?? null;
}

/** コードシートに 1 行のメッセージを出す（ページがない・読み込み中・読み込み失敗） */
function renderMessage(text: string): void {
  codeSheetEl.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'sheet-message';
  msg.textContent = text;
  codeSheetEl.appendChild(msg);
}

/** 直前にスクロール追従した行インデックス */
let lastScrolledLineIndex = -1;

/**
 * ノートページャーの表示を更新する
 */
function updatePagerUI(): void {
  const total = pages.length;
  pageCounterEl.textContent = total === 0 ? '0/0' : `${currentPageIndex + 1}/${total}`;
  btnPrevPageEl.disabled = currentPageIndex <= 0;
  btnNextPageEl.disabled = currentPageIndex >= total - 1;

  fileSelectEl.innerHTML = '';
  pages.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    // まだ開いていないページは進行度 0%
    const percentage = p.session ? p.session.getProgress().percentage : 0;
    const checkMark = percentage === 100 ? '✓ ' : '';
    opt.textContent = `${checkMark}${p.path} (${percentage}%)`;
    if (idx === currentPageIndex) {
      opt.selected = true;
    }
    fileSelectEl.appendChild(opt);
  });
}

/**
 * 指定したページインデックスへ移動する（ノートをめくる）
 */
async function goToPage(index: number): Promise<void> {
  if (index < 0 || index >= pages.length) return;
  currentPageIndex = index;
  lastScrolledLineIndex = -1;
  const page = pages[index];

  if (!page.session) {
    renderMessage('…');
    updatePagerUI();
    try {
      await ensurePageLoaded(page, isSkipCommentsEnabled);
    } catch (err) {
      if (currentPageIndex === index) {
        renderMessage(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    // 読み込みの間に別のページへ移っていたら、そちらの表示を邪魔しない
    if (currentPageIndex !== index) return;
  }

  page.session!.config.skipComments = isSkipCommentsEnabled;
  render(true);
  editorContainerEl.focus();
}

/**
 * 現在のセッション状態をコードシート（DOM）へ描画する
 */
function render(forceScroll: boolean = false): void {
  const session = getCurrentSession();
  if (!session) {
    renderMessage(pages.length === 0 ? 'なぞり書きできるスクリプトが見つかりませんでした' : '…');
    updatePagerUI();
    updateStatusAndProgressHUD();
    return;
  }
  codeSheetEl.innerHTML = '';

  const fragment = document.createDocumentFragment();

  session.lines.forEach((line, idx) => {
    const isSkipped = shouldSkipLine(line, session.config.skipComments);
    const isActive = !session.isCompleted && idx === session.currentLineIndex;
    const hasTypo = session.hasTypoInLine(idx);

    const lineRow = document.createElement('div');
    lineRow.className = 'code-line';
    lineRow.dataset.lineIndex = String(idx);

    if (isSkipped) lineRow.classList.add('is-skipped');
    if (isActive) lineRow.classList.add('is-active');
    if (isActive && hasTypo) lineRow.classList.add('has-typo');

    // 行クリックでその行からいつでも再開できる
    if (!isSkipped) {
      lineRow.addEventListener('click', () => {
        if (session.jumpToLine(idx)) {
          render(true);
          editorContainerEl.focus();
        }
      });
    }

    // 1. 行番号
    const numSpan = document.createElement('span');
    numSpan.className = 'line-num';
    numSpan.textContent = String(idx + 1);
    lineRow.appendChild(numSpan);

    // 2. コード本文（先頭インデント ＋ 本体文字レイヤー）
    const contentSpan = document.createElement('span');
    contentSpan.className = 'line-content';

    if (line.isEmpty) {
      contentSpan.textContent = ' ';
      lineRow.appendChild(contentSpan);
      fragment.appendChild(lineRow);
      return;
    }

    // 先頭インデント部分（常に自動スキップ対象）
    if (line.indentLength > 0) {
      const indentSpan = document.createElement('span');
      indentSpan.className = 'char-indent';
      indentSpan.textContent = line.rawText.slice(0, line.indentLength);
      contentSpan.appendChild(indentSpan);
    }

    const bodyText = session.getTargetBody(idx);

    // コメント等でスキップ設定されている行はそのまま表示のみ
    if (isSkipped) {
      const commentSpan = document.createElement('span');
      commentSpan.className = 'char-skipped-comment';
      commentSpan.textContent = bodyText;
      contentSpan.appendChild(commentSpan);
      lineRow.appendChild(contentSpan);
      fragment.appendChild(lineRow);
      return;
    }

    // VS Code 風シンタックスハイライトのトークン分類を取得
    const tokenTypes = tokenizeLineChars(bodyText);
    const typedChars = session.getTypedChars(idx);

    for (let c = 0; c < bodyText.length; c++) {
      const targetChar = bodyText[c];
      const tokClass = `tok-${tokenTypes[c]}`;
      const charSpan = document.createElement('span');

      if (c < typedChars.length) {
        const userChar = typedChars[c];
        if (userChar === targetChar) {
          charSpan.className = `char-correct ${tokClass}`;
          charSpan.textContent = targetChar;
        } else {
          charSpan.className = 'char-typo';
          charSpan.textContent = userChar === ' ' ? '␣' : userChar;
          charSpan.title = `正解: "${targetChar}"`;
        }
      } else if (isActive && c === typedChars.length) {
        charSpan.className = `char-ghost char-cursor ${tokClass}`;
        charSpan.textContent = targetChar;
      } else {
        charSpan.className = `char-ghost ${tokClass}`;
        charSpan.textContent = targetChar;
      }

      contentSpan.appendChild(charSpan);
    }

    // 行末の Enter マーカー表示（文字を廃し記号のみに統一）
    if (isActive) {
      const enterMarker = document.createElement('span');
      enterMarker.className = 'enter-marker';
      if (typedChars.length === bodyText.length) {
        if (hasTypo) {
          enterMarker.classList.add('is-blocked');
          enterMarker.textContent = '⌫';
          enterMarker.title = '誤字を Backspace で修正してください';
        } else {
          enterMarker.classList.add('is-ready');
          enterMarker.textContent = '↵';
          enterMarker.title = 'Enter で次の行へ';
        }
      } else {
        enterMarker.textContent = '↵';
      }
      contentSpan.appendChild(enterMarker);
    }

    lineRow.appendChild(contentSpan);
    fragment.appendChild(lineRow);
  });

  codeSheetEl.appendChild(fragment);
  updatePagerUI();
  updateStatusAndProgressHUD();

  if (forceScroll || lastScrolledLineIndex !== session.currentLineIndex) {
    lastScrolledLineIndex = session.currentLineIndex;
    scrollActiveLineIntoView();
  } else {
    scrollActiveCharHorizontally();
  }
}

/**
 * ウィンドウ幅が狭く長い行を打鍵している際、カーソル文字が横方向に見切れないよう追従する
 */
function scrollActiveCharHorizontally(): void {
  const cursorEl = codeSheetEl.querySelector('.char-cursor') as HTMLElement | null;
  if (!cursorEl) return;

  const containerRect = editorContainerEl.getBoundingClientRect();
  const cursorRect = cursorEl.getBoundingClientRect();

  const rightMargin = 80;
  const leftMargin = 80;

  if (cursorRect.right > containerRect.right - rightMargin) {
    editorContainerEl.scrollLeft += cursorRect.right - (containerRect.right - rightMargin);
  } else if (cursorRect.left < containerRect.left + leftMargin && editorContainerEl.scrollLeft > 0) {
    editorContainerEl.scrollLeft = Math.max(
      0,
      editorContainerEl.scrollLeft - (containerRect.left + leftMargin - cursorRect.left)
    );
  }
}

/**
 * ステータスバーおよび画面右下の「進行度 0〜100%」を更新する
 */
function updateStatusAndProgressHUD(): void {
  const session = getCurrentSession();
  if (!session) {
    statusLineInfoEl.textContent = 'Ln 0/0';
    statusProgressEl.textContent = '0/0';
    hudPercentNumEl.textContent = '0';
    hudProgressFillEl.style.width = '0%';
    hudCharDetailEl.textContent = '0/0';
    statusHintEl.textContent = '';
    return;
  }
  const { completedLines, totalActiveLines, completedChars, totalActiveChars, percentage } =
    session.getProgress();

  statusLineInfoEl.textContent = `Ln ${session.currentLineIndex + 1}/${session.lines.length}`;
  statusProgressEl.textContent = `${completedLines}/${totalActiveLines}`;

  // 右下 VS Code風ステータスバー内の極小進行度表示
  hudPercentNumEl.textContent = String(percentage);
  hudPercentNumEl.classList.toggle('is-complete', percentage === 100);
  hudProgressFillEl.style.width = `${percentage}%`;
  hudCharDetailEl.textContent = `${completedChars}/${totalActiveChars}`;

  statusHintEl.className = 'vs-status-item vs-status-hint';
  if (session.isCompleted) {
    statusHintEl.classList.add('done');
    statusHintEl.textContent = '✓ 100%';
    return;
  }

  const hasTypo = session.hasTypoInLine(session.currentLineIndex);
  if (hasTypo) {
    statusHintEl.classList.add('warn');
    statusHintEl.textContent = '⌫';
  } else if (session.isCurrentLineReadyForEnter()) {
    statusHintEl.classList.add('done');
    statusHintEl.textContent = '↵';
  } else {
    statusHintEl.textContent = '';
  }
}

/**
 * アクティブ行のスクロール制御
 */
function scrollActiveLineIntoView(): void {
  const activeEl = codeSheetEl.querySelector('.code-line.is-active') as HTMLElement | null;
  if (!activeEl) return;

  if (isPinTopEnabled) {
    const targetTop = activeEl.offsetTop;
    editorContainerEl.scrollTo({
      top: Math.max(0, targetTop - 6),
      left: 0,
      behavior: 'smooth',
    });
    return;
  }

  const containerRect = editorContainerEl.getBoundingClientRect();
  const activeRect = activeEl.getBoundingClientRect();

  const topMargin = 80;
  const bottomMargin = 120;

  if (activeRect.top < containerRect.top + topMargin || activeRect.bottom > containerRect.bottom - bottomMargin) {
    activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/**
 * FileList（フォルダ選択または複数ファイル選択）からノートページ束を構築して読み込む
 */
async function loadFilesIntoNotebook(fileList: FileList): Promise<void> {
  const items: { path: string; file: File }[] = [];

  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (fileList.length === 1 || isSupportedScriptPath(relPath)) {
      items.push({ path: relPath, file: f });
    }
  }

  if (items.length === 0) return;

  items.sort((a, b) => a.path.localeCompare(b.path, 'ja'));

  const newPages: NotePage[] = [];
  for (const item of items) {
    const content = await item.file.text();
    newPages.push(createLoadedPage(item.path, content, isSkipCommentsEnabled));
  }

  pages = newPages;
  await goToPage(0);
}

// キーボード入力のグローバルハンドリング
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (currentPageIndex > 0) {
        sound.playForAction('line_advance');
        goToPage(currentPageIndex - 1);
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (currentPageIndex < pages.length - 1) {
        sound.playForAction('line_advance');
        goToPage(currentPageIndex + 1);
      }
      return;
    }
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    return;
  }

  const session = getCurrentSession();
  if (!session) return;

  if (session.isCompleted && e.key === 'Enter') {
    e.preventDefault();
    if (currentPageIndex < pages.length - 1) {
      sound.playForAction('line_advance');
      goToPage(currentPageIndex + 1);
    }
    return;
  }

  if (e.key === ' ' || e.key === 'Enter' || e.key === 'Backspace' || e.key.length === 1) {
    e.preventDefault();
    const prevLine = session.currentLineIndex;
    const action = session.handleKey(e.key);
    if (action !== 'ignored') {
      sound.playForAction(action);
      const lineChanged = prevLine !== session.currentLineIndex;
      render(lineChanged);
    }
  }
});

// ノートページャーのイベント登録
btnPrevPageEl.addEventListener('click', () => {
  if (currentPageIndex > 0) {
    sound.playForAction('line_advance');
    goToPage(currentPageIndex - 1);
  }
});

btnNextPageEl.addEventListener('click', () => {
  if (currentPageIndex < pages.length - 1) {
    sound.playForAction('line_advance');
    goToPage(currentPageIndex + 1);
  }
});

fileSelectEl.addEventListener('change', () => {
  const idx = Number(fileSelectEl.value);
  if (!Number.isNaN(idx)) {
    goToPage(idx);
  }
});

// アイコンボタン群のイベント登録
btnPinTopEl.addEventListener('click', () => {
  isPinTopEnabled = !isPinTopEnabled;
  btnPinTopEl.classList.toggle('is-active', isPinTopEnabled);
  btnPinTopEl.setAttribute('aria-pressed', String(isPinTopEnabled));
  scrollActiveLineIntoView();
  editorContainerEl.focus();
});

btnSkipCommentsEl.addEventListener('click', () => {
  isSkipCommentsEnabled = !isSkipCommentsEnabled;
  btnSkipCommentsEl.classList.toggle('is-active', isSkipCommentsEnabled);
  btnSkipCommentsEl.setAttribute('aria-pressed', String(isSkipCommentsEnabled));

  const session = getCurrentSession();
  if (!session) return;
  session.config.skipComments = isSkipCommentsEnabled;
  if (shouldSkipLine(session.lines[session.currentLineIndex], session.config.skipComments)) {
    const nextIdx = session.findNextActiveLine(session.currentLineIndex);
    if (nextIdx !== -1) {
      session.currentLineIndex = nextIdx;
    }
  }
  render(true);
  editorContainerEl.focus();
});

btnSoundEl.addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  btnSoundEl.classList.toggle('is-active', sound.enabled);
  btnSoundEl.setAttribute('aria-pressed', String(sound.enabled));
  soundIconOnEl.classList.toggle('hidden', !sound.enabled);
  soundIconOffEl.classList.toggle('hidden', sound.enabled);
  editorContainerEl.focus();
});

btnThemeEl.addEventListener('click', () => {
  const nextOrder: Record<ThemeMode, ThemeMode> = {
    system: 'dark',
    dark: 'light',
    light: 'system',
  };
  applyTheme(nextOrder[currentThemeMode]);
  editorContainerEl.focus();
});

btnResetEl.addEventListener('click', () => {
  const session = getCurrentSession();
  if (!session) return;
  session.reset();
  lastScrolledLineIndex = -1;
  render(true);
  editorContainerEl.focus();
});

// フォルダ選択ダイアログからの一括読み込み
folderInputEl.addEventListener('change', async () => {
  if (folderInputEl.files && folderInputEl.files.length > 0) {
    await loadFilesIntoNotebook(folderInputEl.files);
    folderInputEl.value = '';
  }
});

// ファイル選択ダイアログからの読み込み
fileInputEl.addEventListener('change', async () => {
  if (fileInputEl.files && fileInputEl.files.length > 0) {
    await loadFilesIntoNotebook(fileInputEl.files);
    fileInputEl.value = '';
  }
});

// ドラッグ＆ドロップでのファイル読み込み対応
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropOverlayEl.classList.remove('hidden');
});

window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    dropOverlayEl.classList.add('hidden');
  }
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropOverlayEl.classList.add('hidden');
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    await loadFilesIntoNotebook(e.dataTransfer.files);
  }
});

window.addEventListener('resize', () => {
  scrollActiveLineIntoView();
});

/** URL の #file=<パス> で指定されたページの番号（sumire <ファイル> で起動したとき） */
function initialPageIndex(): number {
  const wanted = new URLSearchParams(location.hash.slice(1)).get('file');
  if (!wanted) return 0;
  const idx = pages.findIndex((p) => p.path === wanted);
  return idx === -1 ? 0 : idx;
}

/**
 * 起動：sumire コマンドのサーバーから、起動したフォルダのファイル一覧を受け取る。
 * サーバーがなければ（npm run dev のとき）SumiRE 自身の src/ を読み込む。
 * どちらもなければ、ファイルを開く・ドラッグ＆ドロップを待つ
 */
async function init(): Promise<void> {
  renderMessage('…');
  const notebook = await fetchServerNotebook();
  if (notebook) {
    pages = notebook.pages;
    document.title = `${notebook.name} — SumiRE`;
  } else if (import.meta.env.DEV) {
    pages = await loadDevSelfPages(isSkipCommentsEnabled);
  }

  if (pages.length === 0) {
    render(true);
    return;
  }
  await goToPage(initialPageIndex());
}

init();
