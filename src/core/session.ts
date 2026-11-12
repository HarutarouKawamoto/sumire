/**
 * タイプライター式・なぞり書きセッション状態管理
 *
 * 仕様：
 * - 各行の先頭インデント（indentLength）までは最初からスキップ済みとし、
 *   最初の非空白文字にカーソルを着地させる。
 * - タイプライター式：間違ったキーを押してもその文字が「誤字」として記録され、
 *   カーソルが1文字進む。Backspaceで1文字戻って消せる（インデント位置より前には戻らない）。
 * - 行末に到達して Enter（または最後の文字）を打った際、その行に未修正の誤字がなければ
 *   次の打鍵対象行の「インデント直後」へ自動ジャンプする。
 */

import { ParsedLine, parseScript, shouldSkipLine } from './parser';

export type KeyActionResult =
  | 'correct'        // 正しい文字を打鍵した
  | 'typo'           // 誤字を打鍵した（タイプライター式で進行）
  | 'backspace'      // 1文字消去した
  | 'line_advance'   // 改行して次の打鍵対象行へ進んだ
  | 'blocked_enter'  // 行内に未解決の誤字がある、または未入力文字があるため改行できない
  | 'completed'      // ファイル全体のなぞり書きが完了した
  | 'ignored';       // 無視されたキー（完了後や範囲外など）

export interface SessionConfig {
  /** コメント行（// や /* ... * /）も自動スキップするか */
  skipComments: boolean;
}

export class TypingSession {
  public readonly fileName: string;
  public readonly lines: ParsedLine[];
  public config: SessionConfig;

  /** 現在フォーカスしている行インデックス */
  public currentLineIndex: number = 0;

  /**
   * 各行でユーザーが実際に入力した文字列（インデント部分は含まず、indentLength以降の入力分）
   * 例: rawText が "  const x = 1;" (indentLength = 2) の場合、
   * typedCharsPerLine[i] には "const x = 1;" に対応するユーザー入力文字が入る。
   */
  public typedByLine: Map<number, string[]> = new Map();

  /** ファイル全体のなぞり書きが完了したか */
  public isCompleted: boolean = false;

  constructor(fileName: string, content: string, config?: Partial<SessionConfig>) {
    this.fileName = fileName;
    this.lines = parseScript(content);
    this.config = {
      skipComments: config?.skipComments ?? true,
    };
    this.reset();
  }

  /**
   * セッションを最初からやり直す
   */
  public reset(): void {
    this.typedByLine.clear();
    this.isCompleted = false;
    this.currentLineIndex = 0;

    // 最初の打鍵対象行を探す（空行・コメント行を自動スキップ）
    const firstValid = this.findNextActiveLine(0);
    if (firstValid === -1) {
      this.isCompleted = true;
    } else {
      this.currentLineIndex = firstValid;
      this.typedByLine.set(firstValid, []);
    }
  }

  /**
   * 指定インデックス以降で最初の「打鍵対象行」を返す。なければ -1
   */
  public findNextActiveLine(fromIndex: number): number {
    for (let i = fromIndex; i < this.lines.length; i++) {
      if (!shouldSkipLine(this.lines[i], this.config.skipComments)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 指定インデックス以前で直前の「打鍵対象行」を返す。なければ -1
   */
  public findPrevActiveLine(fromIndex: number): number {
    for (let i = fromIndex; i >= 0; i--) {
      if (!shouldSkipLine(this.lines[i], this.config.skipComments)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 現在行のお手本文字列（先頭インデントを除いた本体部分）を取得する
   */
  public getTargetBody(lineIndex: number): string {
    const line = this.lines[lineIndex];
    if (!line) return '';
    return line.rawText.slice(line.indentLength);
  }

  /**
   * 指定行の現在の入力文字配列を取得する
   */
  public getTypedChars(lineIndex: number): string[] {
    let arr = this.typedByLine.get(lineIndex);
    if (!arr) {
      arr = [];
      this.typedByLine.set(lineIndex, arr);
    }
    return arr;
  }

  /**
   * 指定行に未修正の誤字（typo）が含まれているか判定する
   */
  public hasTypoInLine(lineIndex: number): boolean {
    const target = this.getTargetBody(lineIndex);
    const typed = this.getTypedChars(lineIndex);
    for (let i = 0; i < typed.length; i++) {
      if (typed[i] !== target[i]) {
        return true;
      }
    }
    return false;
  }

  /**
   * 現在行がすべて正しく打ち終わっているか（Enter待ち状態か）
   */
  public isCurrentLineReadyForEnter(): boolean {
    const target = this.getTargetBody(this.currentLineIndex);
    const typed = this.getTypedChars(this.currentLineIndex);
    return typed.length === target.length && !this.hasTypoInLine(this.currentLineIndex);
  }

  /**
   * キー入力を処理し、結果（効果音・再描画トリガー用）を返す
   */
  public handleKey(key: string): KeyActionResult {
    if (this.isCompleted) return 'ignored';

    const currentLine = this.lines[this.currentLineIndex];
    if (!currentLine) return 'ignored';

    const targetBody = this.getTargetBody(this.currentLineIndex);
    const typed = this.getTypedChars(this.currentLineIndex);

    // 1. Backspace の処理（タイプライター式：1文字消して戻る）
    if (key === 'Backspace') {
      if (typed.length > 0) {
        typed.pop();
        return 'backspace';
      }
      // 行頭（インデント直後）でさらに Backspace を押した場合、前の打鍵行の末尾に戻れるようにする
      const prevLineIdx = this.findPrevActiveLine(this.currentLineIndex - 1);
      if (prevLineIdx !== -1) {
        this.currentLineIndex = prevLineIdx;
        return 'backspace';
      }
      return 'ignored';
    }

    // 2. Enter（改行）の処理
    if (key === 'Enter') {
      // 行の最後まで打てており、かつ誤字が残っていなければ次の打鍵行へジャンプ
      if (typed.length === targetBody.length && !this.hasTypoInLine(this.currentLineIndex)) {
        const nextIdx = this.findNextActiveLine(this.currentLineIndex + 1);
        if (nextIdx === -1) {
          this.isCompleted = true;
          return 'completed';
        }
        this.currentLineIndex = nextIdx;
        if (!this.typedByLine.has(nextIdx)) {
          this.typedByLine.set(nextIdx, []);
        }
        return 'line_advance';
      }
      // まだ行の途中、または誤字が残っているのに Enter を押した場合はブロック警告
      return 'blocked_enter';
    }

    // 3. 通常の印字可能文字（1文字）の処理
    if (key.length === 1) {
      // 既に行の末尾まで打ち切っている場合はこれ以上進めない（Enter または Backspace 待ち）
      if (typed.length >= targetBody.length) {
        return 'blocked_enter';
      }

      const expectedChar = targetBody[typed.length];
      typed.push(key);

      if (key === expectedChar) {
        return 'correct';
      } else {
        // タイプライター式：間違った文字もそのまま配列に入り、カーソルが1つ進む
        return 'typo';
      }
    }

    return 'ignored';
  }

  /**
   * 任意の行をクリックしてその行からなぞり書きを再開できるようにする（ノートらしい自由移動）
   */
  public jumpToLine(lineIndex: number): boolean {
    if (lineIndex < 0 || lineIndex >= this.lines.length) return false;
    if (shouldSkipLine(this.lines[lineIndex], this.config.skipComments)) return false;

    this.isCompleted = false;
    this.currentLineIndex = lineIndex;
    if (!this.typedByLine.has(lineIndex)) {
      this.typedByLine.set(lineIndex, []);
    }
    return true;
  }

  /**
   * 進捗状況（打鍵対象行のうち何行完了したか、および文字単位の0〜100%進行度）を取得する
   */
  public getProgress(): {
    completedLines: number;
    totalActiveLines: number;
    completedChars: number;
    totalActiveChars: number;
    percentage: number;
  } {
    let totalActiveLines = 0;
    let completedLines = 0;
    let totalActiveChars = 0;
    let completedChars = 0;

    for (let i = 0; i < this.lines.length; i++) {
      if (!shouldSkipLine(this.lines[i], this.config.skipComments)) {
        totalActiveLines++;
        const target = this.getTargetBody(i);
        const typed = this.typedByLine.get(i) ?? [];

        totalActiveChars += target.length;

        // 先頭から正しく一致している文字数（またはタイプ済み正解文字数）をカウント
        for (let c = 0; c < Math.min(target.length, typed.length); c++) {
          if (typed[c] === target[c]) {
            completedChars++;
          }
        }

        if (typed.length === target.length && !this.hasTypoInLine(i)) {
          completedLines++;
        }
      }
    }

    const percentage =
      this.isCompleted
        ? 100
        : totalActiveChars === 0
          ? 100
          : Math.min(100, Math.floor((completedChars / totalActiveChars) * 100));

    return {
      completedLines,
      totalActiveLines,
      completedChars,
      totalActiveChars,
      percentage,
    };
  }
}
