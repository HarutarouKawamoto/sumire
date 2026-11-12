// 失敗した処理を、間隔を空けながらやり直すための小さなヘルパー

export interface RetryOptions {
  /** やり直す最大の回数 */
  maxRetries: number;
  /** 1 回目の待ち時間（ミリ秒）。2 回目以降は倍になる */
  baseDelayMs: number;
}

export type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runWithRetry<T>(
  step: () => Promise<T>,
  options: RetryOptions,
): Promise<StepResult<T>> {
  let lastError = new Error('not started');

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const value = await step();
      return { ok: true, value };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 最後の 1 回で失敗したら、待たずに諦める
      if (attempt === options.maxRetries) break;
      await sleep(options.baseDelayMs * 2 ** attempt);
    }
  }

  return { ok: false, error: lastError };
}
