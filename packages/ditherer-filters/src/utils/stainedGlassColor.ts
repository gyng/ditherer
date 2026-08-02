export type StainedGlassColorMode = "AVERAGE" | "MEDIAN" | "DOMINANT";

const validMode = (mode: string): mode is StainedGlassColorMode =>
  mode === "AVERAGE" || mode === "MEDIAN" || mode === "DOMINANT";

const buildCellLinks = (
  cellIds: ArrayLike<number>,
  pixels: Uint8ClampedArray | Uint8Array,
  cellCount: number,
) => {
  const pixelCount = Math.min(cellIds.length, Math.floor(pixels.length / 4));
  const heads = new Int32Array(cellCount);
  heads.fill(-1);
  const next = new Int32Array(pixelCount);
  next.fill(-1);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const cell = Math.floor(cellIds[pixel] ?? -1);
    if (cell < 0 || cell >= cellCount || (pixels[pixel * 4 + 3] ?? 0) <= 0) continue;
    next[pixel] = heads[cell];
    heads[cell] = pixel;
  }
  return { heads, next };
};

/** Resolve one representative RGBA color per Voronoi cell.
 *
 * Fully transparent RGB is excluded from every statistic. Partial alpha is a
 * statistical weight; the caller still preserves the source pixel's alpha
 * when compositing the representative back into the image.
 */
export const resolveStainedGlassCellColors = (
  cellIds: ArrayLike<number>,
  pixels: Uint8ClampedArray | Uint8Array,
  cellCount: number,
  requestedMode: string,
): Uint8Array => {
  const mode: StainedGlassColorMode = validMode(requestedMode) ? requestedMode : "AVERAGE";
  const count = Math.max(0, Math.floor(cellCount));
  const colors = new Uint8Array(count * 4);
  if (count === 0) return colors;

  if (mode === "AVERAGE") {
    const sums = new Float64Array(count * 3);
    const weights = new Float64Array(count);
    const pixelCount = Math.min(cellIds.length, Math.floor(pixels.length / 4));
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const cell = Math.floor(cellIds[pixel] ?? -1);
      const offset = pixel * 4;
      const weight = (pixels[offset + 3] ?? 0) / 255;
      if (cell < 0 || cell >= count || weight <= 0) continue;
      sums[cell * 3] += (pixels[offset] ?? 0) * weight;
      sums[cell * 3 + 1] += (pixels[offset + 1] ?? 0) * weight;
      sums[cell * 3 + 2] += (pixels[offset + 2] ?? 0) * weight;
      weights[cell] += weight;
    }
    for (let cell = 0; cell < count; cell++) {
      const weight = weights[cell];
      if (weight <= 0) continue;
      colors[cell * 4] = Math.round(sums[cell * 3] / weight);
      colors[cell * 4 + 1] = Math.round(sums[cell * 3 + 1] / weight);
      colors[cell * 4 + 2] = Math.round(sums[cell * 3 + 2] / weight);
      colors[cell * 4 + 3] = 255;
    }
    return colors;
  }

  if (mode === "MEDIAN") {
    const { heads, next } = buildCellLinks(cellIds, pixels, count);
    const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const touched = [[], [], []] as [number[], number[], number[]];
    for (let cell = 0; cell < count; cell++) {
      let totalAlpha = 0;
      for (let pixel = heads[cell]; pixel >= 0; pixel = next[pixel]) {
        const offset = pixel * 4;
        const alpha = pixels[offset + 3] ?? 0;
        totalAlpha += alpha;
        for (let channel = 0; channel < 3; channel++) {
          const value = pixels[offset + channel] ?? 0;
          if (histograms[channel][value] === 0) touched[channel].push(value);
          histograms[channel][value] += alpha;
        }
      }
      if (totalAlpha <= 0) continue;
      const midpoint = totalAlpha * 0.5;
      for (let channel = 0; channel < 3; channel++) {
        touched[channel].sort((a, b) => a - b);
        let accumulated = 0;
        let median = 0;
        for (const value of touched[channel]) {
          accumulated += histograms[channel][value];
          median = value;
          if (accumulated >= midpoint) break;
        }
        colors[cell * 4 + channel] = median;
        for (const value of touched[channel]) histograms[channel][value] = 0;
        touched[channel].length = 0;
      }
      colors[cell * 4 + 3] = 255;
    }
    return colors;
  }

  // Dominant color uses 4-bit RGB clusters, then returns the alpha-weighted
  // mean of the original (unquantized) samples in the winning cluster. This
  // is stable, bounded, and avoids returning a visibly posterized bin center.
  type Cluster = { weight: number; r: number; g: number; b: number };
  const { heads, next } = buildCellLinks(cellIds, pixels, count);
  const clusters = new Map<number, Cluster>();
  for (let cell = 0; cell < count; cell++) {
    clusters.clear();
    for (let pixel = heads[cell]; pixel >= 0; pixel = next[pixel]) {
      const offset = pixel * 4;
      const weight = (pixels[offset + 3] ?? 0) / 255;
      const r = pixels[offset] ?? 0;
      const g = pixels[offset + 1] ?? 0;
      const b = pixels[offset + 2] ?? 0;
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      const cluster = clusters.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
      cluster.weight += weight;
      cluster.r += r * weight;
      cluster.g += g * weight;
      cluster.b += b * weight;
      clusters.set(key, cluster);
    }
    let winner: Cluster | null = null;
    let winnerKey = Infinity;
    for (const [key, cluster] of clusters) {
      if (
        !winner ||
        cluster.weight > winner.weight ||
        (cluster.weight === winner.weight && key < winnerKey)
      ) {
        winner = cluster;
        winnerKey = key;
      }
    }
    if (!winner || winner.weight <= 0) continue;
    colors[cell * 4] = Math.round(winner.r / winner.weight);
    colors[cell * 4 + 1] = Math.round(winner.g / winner.weight);
    colors[cell * 4 + 2] = Math.round(winner.b / winner.weight);
    colors[cell * 4 + 3] = 255;
  }
  return colors;
};
