// サンプルの入り口：3 つのタスクをキューに入れて実行する

import { TaskQueue } from './harness/queue';

const queue = new TaskQueue({ maxRetries: 3, baseDelayMs: 200 });

for (const id of ['fetch', 'parse', 'save']) {
  queue.add({
    id,
    run: async () => {
      console.log(`run ${id}`);
    },
  });
}
