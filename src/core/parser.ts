/**
 * スクリプト解析・行構造パーサー（純粋関数群）
 *
 * 役割：
 * 読み込んだスクリプト文字列を行単位に分解し、
 * 「先頭インデントの文字数」や「空行・コメント行かどうか」を判定する。
 */

export interface ParsedLine {
  /** 0始まりの行インデックス */
  lineNumber: number;
  /** タブをスペース（2空白）に正規化した1行の文字列 */
  rawText: string;
  /** 先頭インデント（空白）の長さ（ここにカーソルが自動着地する） */
  indentLength: number;
  /** 空行かどうか */
  isEmpty: boolean;
  /** コメント行（// または /* ... * /）かどうか */
  isComment: boolean;
}

export interface ParseOptions {
  /** タブ文字を何スペースに展開するか（デフォルト: 2） */
  tabSize?: number;
}

/**
 * スクリプト全文を解析して ParsedLine の配列に変換する
 */
export function parseScript(content: string, options: ParseOptions = {}): ParsedLine[] {
  const tabSpaces = ' '.repeat(options.tabSize ?? 2);
  // 改行コードを LF (\n) に統一し、行末の不要な空白は除去（行末の無駄打ち防止）
  const rawLines = content.replace(/\r\n?/g, '\n').split('\n');

  let inBlockComment = false;

  return rawLines.map((line, index) => {
    const normalized = line.replace(/\t/g, tabSpaces).replace(/\s+$/, '');
    const trimmed = normalized.trim();
    const isEmpty = trimmed.length === 0;

    // 先頭インデント（非空白文字が現れるまでの文字数）を算出
    const firstNonSpaceIdx = normalized.search(/\S/);
    const indentLength = firstNonSpaceIdx === -1 ? normalized.length : firstNonSpaceIdx;

    // コメント行判定（単一行コメント // または ブロックコメント /* ... */）
    let isComment = false;
    if (!isEmpty) {
      if (inBlockComment) {
        isComment = true;
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
      } else if (trimmed.startsWith('//')) {
        isComment = true;
      } else if (trimmed.startsWith('/*')) {
        isComment = true;
        if (!trimmed.includes('*/')) {
          inBlockComment = true;
        }
      }
    }

    return {
      lineNumber: index,
      rawText: normalized,
      indentLength,
      isEmpty,
      isComment,
    };
  });
}

/**
 * 指定した行がスキップ対象（打鍵不要）かどうかを判定する
 */
export function shouldSkipLine(
  line: ParsedLine,
  skipComments: boolean
): boolean {
  if (line.isEmpty) return true;
  if (skipComments && line.isComment) return true;
  return false;
}
