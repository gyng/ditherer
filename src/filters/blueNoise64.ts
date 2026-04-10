// 64×64 blue noise threshold map generated via void-and-cluster algorithm.
// Runs once at module load (~10ms). Produces organic, film-grain-like dithering
// with no repeating grid artifacts — superior to Bayer for photographic content.

const SIZE = 64;
const N = SIZE * SIZE; // 4096

// Gaussian energy contribution from a point at (dx, dy), wrapped toroidally
const gaussian = (dx: number, dy: number, sigma: number) => {
  // Toroidal wrap
  if (dx > SIZE / 2) dx -= SIZE;
  if (dy > SIZE / 2) dy -= SIZE;
  if (dx < -SIZE / 2) dx += SIZE;
  if (dy < -SIZE / 2) dy += SIZE;
  return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
};

const generate = (): number[][] => {
  const sigma = 1.5;
  const grid = new Uint8Array(N); // 1 = filled, 0 = empty
  const energy = new Float64Array(N);
  const rank = new Uint16Array(N); // output: threshold rank per pixel

  // Seed: place ~10% of points randomly (deterministic PRNG)
  let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const initialCount = Math.floor(N * 0.1);
  const positions: number[] = [];
  for (let i = 0; i < N; i++) positions.push(i);
  // Fisher-Yates shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = positions[i]; positions[i] = positions[j]; positions[j] = tmp;
  }
  for (let i = 0; i < initialCount; i++) grid[positions[i]] = 1;

  // Compute initial energy field
  const recomputeEnergy = () => {
    energy.fill(0);
    for (let i = 0; i < N; i++) {
      if (!grid[i]) continue;
      const px = i % SIZE, py = (i / SIZE) | 0;
      // Only compute within ~4σ radius for performance
      const r = Math.ceil(sigma * 4);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = ((px + dx) % SIZE + SIZE) % SIZE;
          const ny = ((py + dy) % SIZE + SIZE) % SIZE;
          energy[ny * SIZE + nx] += gaussian(dx, dy, sigma);
        }
      }
    }
  };

  const addEnergy = (idx: number, sign: number) => {
    const px = idx % SIZE, py = (idx / SIZE) | 0;
    const r = Math.ceil(sigma * 4);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = ((px + dx) % SIZE + SIZE) % SIZE;
        const ny = ((py + dy) % SIZE + SIZE) % SIZE;
        energy[ny * SIZE + nx] += sign * gaussian(dx, dy, sigma);
      }
    }
  };

  recomputeEnergy();

  // Phase 1: Remove points from tightest clusters, assign low ranks
  let filledCount = initialCount;
  const phase1Removed: number[] = [];

  while (filledCount > 0) {
    // Find tightest cluster (highest energy among filled points)
    let maxE = -Infinity, maxIdx = 0;
    for (let i = 0; i < N; i++) {
      if (grid[i] && energy[i] > maxE) { maxE = energy[i]; maxIdx = i; }
    }
    grid[maxIdx] = 0;
    addEnergy(maxIdx, -1);
    phase1Removed.push(maxIdx);
    filledCount--;
  }

  // Assign ranks: first removed gets lowest rank
  for (let i = phase1Removed.length - 1; i >= 0; i--) {
    rank[phase1Removed[i]] = phase1Removed.length - 1 - i;
  }

  // Phase 2: Re-place initial points, then fill remaining by largest void
  for (const idx of phase1Removed) {
    grid[idx] = 1;
  }
  recomputeEnergy();

  let currentRank = initialCount;

  // Phase 2: Fill voids
  while (currentRank < N) {
    // Find largest void (lowest energy among empty points)
    let minE = Infinity, minIdx = 0;
    for (let i = 0; i < N; i++) {
      if (!grid[i] && energy[i] < minE) { minE = energy[i]; minIdx = i; }
    }
    grid[minIdx] = 1;
    addEnergy(minIdx, 1);
    rank[minIdx] = currentRank++;
  }

  // Convert rank array to 2D threshold map normalized to [0, 1)
  const map: number[][] = [];
  for (let y = 0; y < SIZE; y++) {
    const row: number[] = [];
    for (let x = 0; x < SIZE; x++) {
      row.push(rank[y * SIZE + x] / N);
    }
    map.push(row);
  }
  return map;
};

export const BLUE_NOISE_MAP = generate();
export const BLUE_NOISE_SIZE = SIZE;
export const BLUE_NOISE_LEVELS = N;
