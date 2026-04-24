export class JobQueue {
  constructor({ concurrency = 1, worker }) {
    this.concurrency = concurrency;
    this.worker = worker;
    this.pending = [];
    this.activeCount = 0;
  }

  enqueue(job) {
    this.pending.push(job);
    this.drain();
  }

  drain() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.activeCount += 1;

      Promise.resolve(this.worker(job))
        .catch(() => {})
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }
}
