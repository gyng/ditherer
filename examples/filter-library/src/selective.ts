import grayscale from "@gyng/ditherer-filters/filters/grayscale";

if (grayscale.name !== "Grayscale") {
  throw new Error(`Unexpected selective filter: ${grayscale.name}`);
}

document.body.dataset.filter = grayscale.name;
