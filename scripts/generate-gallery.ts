/**
 * Generate a static filter gallery: applies every filter to pepper.png
 * and outputs PNG thumbnails + a markdown gallery doc.
 *
 * Usage: npm run gallery   (runs via vite-node)
 */

// -- Polyfill browser globals BEFORE any filter/util imports --
import { createCanvas, loadImage, ImageData as NodeImageData } from "canvas";

(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return createCanvas(1, 1);
    throw new Error(`Unsupported element: ${tag}`);
  },
};
(globalThis as any).ImageData = NodeImageData;

// Now safe to import filters (they use document.createElement via cloneCanvas)
import { filterList, filterCategories } from "filters";
import { cloneCanvas } from "utils";
import path from "path";
import fs from "fs";

const SKIP = new Set(["Glitch", "Program"]);
const THUMB_WIDTH = 256;

async function main() {
  // Load source image
  const img = await loadImage(path.resolve("public/pepper.png"));
  const scale = THUMB_WIDTH / img.width;
  const thumbH = Math.round(img.height * scale);
  const sourceCanvas = createCanvas(THUMB_WIDTH, thumbH);
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(img, 0, 0, THUMB_WIDTH, thumbH);

  const outputDir = path.resolve("docs/gallery");
  fs.mkdirSync(outputDir, { recursive: true });

  const results: Array<{
    displayName: string;
    category: string;
    filename: string;
    description: string;
  }> = [];

  for (const entry of filterList) {
    const name = entry.displayName;

    if (SKIP.has(name)) {
      console.log(`SKIP: ${name}`);
      continue;
    }

    const input = cloneCanvas(sourceCanvas, true);

    try {
      const result = entry.filter.func(input, entry.filter.options);

      // Async filters return the string "ASYNC_FILTER"
      if (typeof result === "string") {
        console.log(`SKIP (async): ${name}`);
        continue;
      }

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+$/, "");
      const filename = `${slug}.png`;
      const buf = (result as any).toBuffer("image/png");
      fs.writeFileSync(path.join(outputDir, filename), buf);
      results.push({
        displayName: name,
        category: entry.category,
        filename,
        description: entry.description,
      });
      console.log(`  OK: ${name} -> ${filename}`);
    } catch (err: any) {
      console.error(`FAIL: ${name}: ${err.message}`);
    }
  }

  // Generate markdown
  let md = "# Filter Gallery\n\n";
  md += "> All filters applied to `pepper.png` with default settings.\n\n";

  for (const category of filterCategories) {
    const catFilters = results.filter((r) => r.category === category);
    if (catFilters.length === 0) continue;

    md += `## ${category}\n\n`;
    md += "| | | |\n|---|---|---|\n";

    for (let i = 0; i < catFilters.length; i += 3) {
      const row = catFilters.slice(i, i + 3);
      const cells = row.map(
        (f) =>
          `**${f.displayName}**<br>${f.description}<br>![${f.displayName}](gallery/${f.filename})`
      );
      while (cells.length < 3) cells.push("");
      md += `| ${cells.join(" | ")} |\n`;
    }
    md += "\n";
  }

  fs.writeFileSync(path.resolve("docs/GALLERY.md"), md);
  console.log(
    `\nDone: ${results.length} filters -> docs/gallery/ + docs/GALLERY.md`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
