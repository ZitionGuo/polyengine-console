export class LatestRequestCoordinator {
  private controller?: AbortController;

  start() {
    this.cancel();
    this.controller = new AbortController();
    return this.controller.signal;
  }

  finish(signal: AbortSignal) {
    if (this.controller?.signal === signal) this.controller = undefined;
  }

  cancel() {
    this.controller?.abort();
    this.controller = undefined;
  }

  get pending() {
    return Boolean(this.controller);
  }
}
