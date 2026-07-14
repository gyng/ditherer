import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkerFilterRequest,
  WorkerFilterResult,
  WorkerResponseMessage,
} from "workers/types";

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<WorkerResponseMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }

  respond(data: WorkerResponseMessage) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponseMessage>);
  }

  crash(message = "boom") {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const request = {
  imageData: new ArrayBuffer(4),
  width: 1,
  height: 1,
  chain: [],
  frameIndex: 0,
  isAnimating: false,
  linearize: false,
  wasmAcceleration: false,
  webglAcceleration: false,
  convertGrayscale: false,
  prevOutputs: {},
  prevInputs: {},
  emaMaps: {},
  degaussFrame: -2147483648,
} satisfies WorkerFilterRequest;

const result = {
  imageData: new ArrayBuffer(4),
  prevOutputs: {},
  prevInputs: {},
  emaMaps: {},
  stepTimes: [],
} satisfies WorkerFilterResult;

const loadRPC = async () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", undefined);
  vi.resetModules();
  return import("workers/workerRPC");
};

beforeEach(() => {
  FakeWorker.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workerRPC lifecycle", () => {
  it("correlates successful replies and transfers ownership exactly once", async () => {
    const { workerRPC, USE_WORKER } = await loadRPC();
    const transferable = new ArrayBuffer(8);

    const response = workerRPC(request, [transferable]);
    const worker = FakeWorker.instances[0];

    expect(USE_WORKER).toBe(false);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 0, width: 1, height: 1 }),
      [transferable],
    );

    worker.respond({ id: 999, result });
    worker.respond({ id: 0, result });
    await expect(response).resolves.toBe(result);

    // A duplicate response is ignored after the pending entry is removed.
    worker.respond({ id: 0, result });
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("turns worker error replies into rejected Errors without killing the worker", async () => {
    const { workerRPC } = await loadRPC();
    const response = workerRPC(request);
    const worker = FakeWorker.instances[0];

    worker.respond({ id: 0, error: "filter exploded" });

    await expect(response).rejects.toThrow("filter exploded");
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("rejects every pending call on a crash and creates a fresh worker next time", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { workerRPC } = await loadRPC();
    const first = workerRPC(request);
    const second = workerRPC(request);
    const firstWorker = FakeWorker.instances[0];
    const firstRejected = expect(first).rejects.toThrow("Worker crashed");
    const secondRejected = expect(second).rejects.toThrow("Worker crashed");

    firstWorker.crash();

    await firstRejected;
    await secondRejected;
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();

    const recovered = workerRPC(request);
    const replacement = FakeWorker.instances[1];
    replacement.respond({ id: 2, result });
    await expect(recovered).resolves.toBe(result);
  });

  it("times out a hung worker, rejects all in-flight calls, and recovers", async () => {
    vi.useFakeTimers();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { workerRPC } = await loadRPC();
    const first = workerRPC(request);
    const second = workerRPC(request);
    const firstRejected = expect(first).rejects.toThrow("Worker timeout after 5000ms");
    const secondRejected = expect(second).rejects.toThrow("Worker timeout after 5000ms");

    await vi.advanceTimersByTimeAsync(5000);

    await firstRejected;
    await secondRejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("rpc id=0 timed out"));

    const recovered = workerRPC(request);
    FakeWorker.instances[1].respond({ id: 2, result });
    await expect(recovered).resolves.toBe(result);
  });

  it("rejects synchronous postMessage failures without poisoning later calls", async () => {
    const { workerRPC } = await loadRPC();
    const firstWorker = (() => {
      const pending = workerRPC(request);
      const instance = FakeWorker.instances[0];
      instance.respond({ id: 0, result });
      return { pending, instance };
    })();
    await firstWorker.pending;

    firstWorker.instance.postMessage.mockImplementationOnce(() => {
      throw "clone failed";
    });
    await expect(workerRPC(request)).rejects.toThrow("clone failed");

    const recovered = workerRPC(request);
    firstWorker.instance.respond({ id: 2, result });
    await expect(recovered).resolves.toBe(result);
  });
});
