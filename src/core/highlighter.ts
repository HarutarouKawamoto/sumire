/**
 * VS Code (Dark+ Modern) 風の1文字単位シンタックスハイライト分類器
 *
 * 役割：
 * 1行のコード（インデント除去後の本体文字列）を受け取り、
 * 各文字インデックスがどのシンタックス種別（keyword, string, type, function, number, operator, punctuation, variable）
 * に属するかを配列で返す純粋関数。
 * これにより、1文字ずつゴースト表示・打鍵済み表示を切り替える際にもVS Codeと同じ文字色を維持できる。
 */

export type SyntaxTokenType =
  | 'keyword'      // import, export, from, return, if, for, await, yield 等 (VS Code Control Purple: #C586C0)
  | 'storage'      // const, let, var, function, class, interface, type, async, readonly 等 (VS Code Blue: #569CD6)
  | 'string'       // '...', "...", `...` (VS Code Orange: #CE9178)
  | 'number'       // 123, 0.5, true, false, null, undefined (VS Code Light Green/Blue: #B5CEA8)
  | 'type'         // PascalCase の型名・クラス名・インターフェース名 (VS Code Teal: #4EC9B0)
  | 'function'     // 直後に ( が続く識別子・メソッド名 (VS Code Yellow: #DCDCAA)
  | 'property'     // . の直後のプロパティやオブジェクトキー (VS Code Light Blue: #9CDCFE)
  | 'operator'     // =, +, -, *, /, =>, ===, <=, !, &, | 等 (VS Code Light Gray/Cyan: #D4D4D4)
  | 'punctuation'  // (, ), {, }, [, ], ;, :, , . (VS Code Bracket Gold/Gray: #FFD700 / #CCCCCC)
  | 'comment'      // 行末コメント // ... (VS Code Green: #6A9955)
  | 'variable';    // 通常の変数・引数 (VS Code Light Blue: #9CDCFE)

const CONTROL_KEYWORDS = new Set([
  'import', 'export', 'from', 'default', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
  'await', 'yield', 'as', 'in', 'of',
]);

const STORAGE_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
  'async', 'readonly', 'public', 'private', 'protected', 'static', 'implements',
  'extends', 'new', 'typeof', 'keyof', 'void', 'never', 'any', 'unknown',
  'boolean', 'string', 'number', 'bigint', 'symbol', 'object', 'def', 'fn', 'struct', 'impl',
]);

const LITERAL_KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'None', 'True', 'False',
]);

/**
 * 1行のコード文字列を解析し、文字ごとの SyntaxTokenType 配列を返す
 */
export function tokenizeLineChars(text: string): SyntaxTokenType[] {
  const result: SyntaxTokenType[] = new Array(text.length).fill('variable');
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // 1. 行途中からの単一行コメント //
    if (ch === '/' && text[i + 1] === '/') {
      for (let k = i; k < text.length; k++) {
        result[k] = 'comment';
      }
      break;
    }

    // 2. 文字列リテラル ('...', "...", `...`)
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      result[i] = 'string';
      i++;
      while (i < text.length) {
        result[i] = 'string';
        if (text[i] === '\\' && i + 1 < text.length) {
          i++;
          result[i] = 'string';
          i++;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // 3. 数値リテラル
    if (/[0-9]/.test(ch)) {
      while (i < text.length && /[0-9a-fA-FxXbBoO._]/.test(text[i])) {
        result[i] = 'number';
        i++;
      }
      continue;
    }

    // 4. 識別子・キーワード・型名・関数名
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      while (i < text.length && /[a-zA-Z0-9_$]/.test(text[i])) {
        i++;
      }
      const word = text.slice(start, i);

      // 直後の非空白文字を確認（関数呼び出し `(` や型アノテーションかどうか）
      let lookahead = i;
      while (lookahead < text.length && text[lookahead] === ' ') {
        lookahead++;
      }
      const nextChar = text[lookahead];
      const prevChar = start > 0 ? text[start - 1] : '';

      let tokenType: SyntaxTokenType = 'variable';

      if (CONTROL_KEYWORDS.has(word)) {
        tokenType = 'keyword';
      } else if (STORAGE_KEYWORDS.has(word)) {
        tokenType = 'storage';
      } else if (LITERAL_KEYWORDS.has(word)) {
        tokenType = 'number';
      } else if (/^[A-Z]/.test(word)) {
        // 先頭大文字（PascalCase）はクラス・型・インターフェース色
        tokenType = 'type';
      } else if (nextChar === '(' || nextChar === '<') {
        // 直後に ( が来る識別子は関数・メソッド色
        tokenType = 'function';
      } else if (prevChar === '.') {
        tokenType = 'property';
      }

      for (let k = start; k < i; k++) {
        result[k] = tokenType;
      }
      continue;
    }

    // 5. 括弧・区切り記号
    if (/[(){}[\];:,_.]/.test(ch)) {
      result[i] = 'punctuation';
      i++;
      continue;
    }

    // 6. 演算子・その他
    if (/[=+\-*/%&|^!<>?~]/.test(ch)) {
      result[i] = 'operator';
      i++;
      continue;
    }

    i++;
  }

  return result;
}
