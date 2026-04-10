import { CHAIN_PRESETS, findDuplicatePresetGroups } from "../src/components/ChainList/presets";

interface PairReport {
  a: string;
  b: string;
  categoryA: string;
  categoryB: string;
  score: number;
  setSimilarity: number;
  orderedSimilarity: number;
  sameLead: boolean;
  sharedFilters: string[];
}

const args = process.argv.slice(2);
const thresholdArg = args.find((arg) => arg.startsWith("--threshold="));
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.45;
const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;

const filterNames = (preset: typeof CHAIN_PRESETS[number]) => preset.filters.map((entry) => entry.name);

const unique = (values: string[]) => [...new Set(values)];

const intersect = (a: string[], b: string[]) => {
  const bSet = new Set(b);
  return unique(a).filter((value) => bSet.has(value));
};

const jaccard = (a: string[], b: string[]) => {
  const aSet = new Set(a);
  const bSet = new Set(b);
  const union = new Set([...aSet, ...bSet]);
  if (union.size === 0) return 0;

  let shared = 0;
  for (const value of aSet) {
    if (bSet.has(value)) shared += 1;
  }
  return shared / union.size;
};

const orderedSimilarity = (a: string[], b: string[]) => {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;

  let matches = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] === b[i]) matches += 1;
  }
  return matches / maxLen;
};

const similarity = (a: typeof CHAIN_PRESETS[number], b: typeof CHAIN_PRESETS[number]): PairReport => {
  const namesA = filterNames(a);
  const namesB = filterNames(b);
  const setSimilarity = jaccard(namesA, namesB);
  const orderSimilarity = orderedSimilarity(namesA, namesB);
  const sameLead = namesA[0] === namesB[0];
  const sameCategory = a.category === b.category;
  const score = (
    setSimilarity * 0.5 +
    orderSimilarity * 0.25 +
    (sameLead ? 0.15 : 0) +
    (sameCategory ? 0.1 : 0)
  );

  return {
    a: a.name,
    b: b.name,
    categoryA: a.category,
    categoryB: b.category,
    score,
    setSimilarity,
    orderedSimilarity: orderSimilarity,
    sameLead,
    sharedFilters: intersect(namesA, namesB),
  };
};

const duplicateGroups = findDuplicatePresetGroups(CHAIN_PRESETS);
const pairReports: PairReport[] = [];

for (let i = 0; i < CHAIN_PRESETS.length; i += 1) {
  for (let j = i + 1; j < CHAIN_PRESETS.length; j += 1) {
    const report = similarity(CHAIN_PRESETS[i], CHAIN_PRESETS[j]);
    if (report.score >= threshold) {
      pairReports.push(report);
    }
  }
}

pairReports.sort((left, right) => right.score - left.score || left.a.localeCompare(right.a) || left.b.localeCompare(right.b));

console.log(`Preset similarity report`);
console.log(`Threshold: ${threshold.toFixed(2)}  Limit: ${limit}`);
console.log(`Presets: ${CHAIN_PRESETS.length}`);
console.log("");

if (duplicateGroups.length > 0) {
  console.log("Exact duplicate signatures:");
  for (const group of duplicateGroups) {
    console.log(`- ${group.join(" | ")}`);
  }
  console.log("");
} else {
  console.log("Exact duplicate signatures: none");
  console.log("");
}

console.log("Most similar preset pairs:");

const shown = pairReports.slice(0, limit);
if (shown.length === 0) {
  console.log("- none above threshold");
} else {
  for (const report of shown) {
    const shared = report.sharedFilters.length > 0 ? report.sharedFilters.join(", ") : "none";
    console.log(
      `- ${report.a} [${report.categoryA}] <> ${report.b} [${report.categoryB}] ` +
      `score=${report.score.toFixed(2)} shared=${shared} ` +
      `set=${report.setSimilarity.toFixed(2)} order=${report.orderedSimilarity.toFixed(2)} lead=${report.sameLead ? "yes" : "no"}`
    );
  }
}
