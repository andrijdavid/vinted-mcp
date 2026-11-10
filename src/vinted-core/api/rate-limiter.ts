export class RateLimiter {
  private readonly queue: Array<() => void> = [];
  private activeCount = 0;
  private lastRequestTime = 0;
  private pauseUntil = 0;

  constructor(
    private readonly maxConcurrency = 5,
    private readonly delayMs = 500,
    private readonly jitterMs = 300
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  pause(durationMs: number): void {
    const newPauseUntil = Date.now() + durationMs;
    if (newPauseUntil > this.pauseUntil) {
      this.pauseUntil = newPauseUntil;
    }
  }

  private async acquire(): Promise<void> {
    while (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    // Reserve before sleeping: otherwise simultaneous callers all see a free slot.
    this.activeCount += 1;
    const now = Date.now();
    const startAt = Math.max(now, this.pauseUntil, this.lastRequestTime + this.delayMs + Math.floor(Math.random() * this.jitterMs));
    this.lastRequestTime = startAt;
    if (startAt > now) await new Promise(resolve => setTimeout(resolve, startAt - now));
    while (Date.now() < this.pauseUntil) await new Promise(resolve => setTimeout(resolve, this.pauseUntil - Date.now()));
  }

  private release(): void {
    this.activeCount -= 1;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}
