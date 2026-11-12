/**
 * ノートブック（複数スクリプトファイルの束とページ移動管理）
 *
 * 役割：
 * 1. `sumire` コマンドで起動したときは、ローカルサーバー（lib/server.js）から
 *    起動したフォルダのファイル一覧を受け取り、ノートの各ページにする。
 *    中身はページを開いたときに初めて読み込む（大きなフォルダでも起動が速い）。
 * 2. 「フォルダを開く」「ファイルを開く」・ドラッグ＆ドロップで読み込んだファイル群も
 *    パス順に並べてノート化する（こちらは最初から中身を持つ）。
 * 3. 各ページ（ファイル）ごとの TypingSession を保持するため、前のページに戻っても打鍵途中の状態が維持される。
 */

import { TypingSession } from './session';

export interface NotePage {
  /** 表示用の相対パス（例: "src/core/parser.ts"） */
  path: string;
  /** ファイルの中身（サーバーから読むページは、開くまで null） */
  content: string | null;
  /** このページの打鍵セッション状態（中身を読むまで null） */
  session: TypingSession | null;
}

/** 写経対象として扱うスクリプト拡張子リスト（lib/server.js と揃える） */
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rs', '.go', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php',
  '.rb', '.swift', '.dart', '.lua', '.sh', '.ps1', '.sql',
  '.json', '.yaml', '.yml', '.toml', '.css', '.scss', '.html',
]);

/** フォルダ読み込み時に除外するディレクトリ名 */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.sumire', '.haname', 'dist', 'build', 'out', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', 'coverage', 'vendor', '__pycache__', '.venv', 'venv', 'target', '.vscode',
]);

const GENERATED_FILE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Cargo\.lock|poetry\.lock)$|\.min\.(js|css)$|\.map$/i;

export function isSupportedScriptPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.split('/').some((part) => IGNORED_DIRS.has(part))) return false;
  if (GENERATED_FILE.test(normalized)) return false;
  const dotIdx = normalized.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return SUPPORTED_EXTENSIONS.has(normalized.slice(dotIdx).toLowerCase());
}

/** 中身を持ったページを作る */
export function createLoadedPage(path: string, content: string, skipComments: boolean): NotePage {
  return { path, content, session: new TypingSession(path, content, { skipComments }) };
}

export interface ServerNotebook {
  /** 起動したフォルダの名前 */
  name: string;
  pages: NotePage[];
}

/**
 * ローカルサーバーからファイル一覧を受け取る。
 * サーバーがない（vite の開発サーバーで開いている等）ときは null
 */
export async function fetchServerNotebook(): Promise<ServerNotebook | null> {
  try {
    const res = await fetch('/api/files', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { name: string; files: { path: string }[] };
    return {
      name: data.name,
      pages: data.files.map((f) => ({ path: f.path, content: null, session: null })),
    };
  } catch {
    return null;
  }
}

/** まだ中身を読んでいないページを、サーバーから読み込んでセッションを作る */
export async function ensurePageLoaded(page: NotePage, skipComments: boolean): Promise<TypingSession> {
  if (page.session) return page.session;
  const res = await fetch(`/api/file?path=${encodeURIComponent(page.path)}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`${page.path} を読み込めませんでした（${res.status}）`);
  }
  const data = (await res.json()) as { content: string };
  page.content = data.content;
  page.session = new TypingSession(page.path, data.content, { skipComments });
  return page.session;
}

/**
 * 開発用（npm run dev）：サーバーがないときに、SumiRE 自身の src/ をノートとして読み込む。
 * 本番のビルドでは呼ばれない（import.meta.env.DEV の分岐ごと取り除かれる）
 */
export async function loadDevSelfPages(skipComments: boolean): Promise<NotePage[]> {
  const loaders = import.meta.glob('/src/**/*.{ts,css}', {
    query: '?raw',
    import: 'default',
  }) as Record<string, () => Promise<string>>;

  const entries = await Promise.all(
    Object.entries(loaders).map(async ([rawPath, load]) => ({
      path: rawPath.replace(/^\//, ''),
      content: await load(),
    }))
  );
  entries.sort((a, b) => a.path.localeCompare(b.path, 'ja'));
  return entries.map((e) => createLoadedPage(e.path, e.content, skipComments));
}
