// タスクを順番に 1 つずつ実行するキュー

import { runWithRetry, type RetryOptions } from './retry';

export interface Task {
  id: string;
  run: () => Promise<void>;
}

export class TaskQueue {
  private readonly tasks: Task[] = [];
  private running = false;

  constructor(private readonly retry: RetryOptions) {}

  add(task: Task): void {
    this.tasks.push(task);
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      const result = await runWithRetry(task.run, this.retry);
      if (!result.ok) {
        console.error(`[${task.id}] failed:`, result.error.message);
      }
    }
    this.running = false;
  }
}
