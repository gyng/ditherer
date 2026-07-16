import {
  createFilterSession,
  filterList,
  type FilterChainEntry,
  type FilterDefinition,
} from "@gyng/ditherer-filters";
import type { WorkerFilterRequest } from "@gyng/ditherer-filters/worker";
import { USE_WORKER, type WorkerFilterResult } from "@gyng/ditherer-filters/client";

const custom: FilterDefinition<{ amount: number }> = {
  name: "Custom",
  defaults: { amount: 1 },
  options: { amount: 1 },
  func: (canvas) => canvas,
};
const chain: FilterChainEntry[] = [
  { id: "gray", filter: "Grayscale" },
  { id: "custom", filter: custom, options: { amount: 2 } },
];
const session = createFilterSession(chain, { webglAcceleration: false });
const request = {} as WorkerFilterRequest;
const workerResult = {} as WorkerFilterResult;

void filterList;
void session;
void request;
void workerResult;
void USE_WORKER;
