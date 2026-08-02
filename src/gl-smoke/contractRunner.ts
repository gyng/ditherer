import type { CheckResult, Contract } from "./types";

export type ContractSuite = {
  name: string;
  contracts: Contract[];
};

export type ContractRecorder = (name: string, mode: string, result: CheckResult) => void;

/** Run suites sequentially because filters intentionally share one GL context. */
export const runContractSuites = async (
  suites: ContractSuite[],
  record: ContractRecorder,
): Promise<Record<string, number>> => {
  const timings: Record<string, number> = {};
  for (const suite of suites) {
    const startedAt = performance.now();
    for (const contract of suite.contracts) {
      let result: CheckResult;
      try {
        result = await contract.run();
      } catch (error) {
        result = {
          ok: false,
          reason: `contract threw: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      record(contract.name, contract.mode, result);
    }
    timings[suite.name] = performance.now() - startedAt;
  }
  return timings;
};
