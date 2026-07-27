import { LatestRequestCoordinator } from "./requestCoordinator";

describe("LatestRequestCoordinator", () => {
  it("aborts the previous request when a newer search starts", () => {
    const coordinator = new LatestRequestCoordinator();
    const first = coordinator.start();
    const second = coordinator.start();

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(coordinator.pending).toBe(true);
  });

  it("only finishes the request that is still current", () => {
    const coordinator = new LatestRequestCoordinator();
    const first = coordinator.start();
    const second = coordinator.start();

    coordinator.finish(first);
    expect(coordinator.pending).toBe(true);
    coordinator.finish(second);
    expect(coordinator.pending).toBe(false);
  });

  it("supports explicit cancellation", () => {
    const coordinator = new LatestRequestCoordinator();
    const signal = coordinator.start();

    coordinator.cancel();
    expect(signal.aborted).toBe(true);
    expect(coordinator.pending).toBe(false);
  });
});
