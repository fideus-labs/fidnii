import { Niivue } from "@niivue/niivue";
import { fromNgffZarr } from "@fideus-labs/ngff-zarr";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";

declare global {
  interface Window {
    nv: Niivue;
    image: OMEZarrNVImage;
    loadingComplete: boolean;
  }
}

const DATA_URL =
  "https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/mri_woman.ome.zarr";

async function main() {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;

  // Initialize NiiVue
  const nv = new Niivue({ backColor: [0, 0, 0, 1] });
  await nv.attachToCanvas(canvas);
  nv.setSliceType(nv.sliceTypeRender);

  // Expose NiiVue instance for testing
  window.nv = nv;

  // Load OME-Zarr data
  const multiscales = await fromNgffZarr(DATA_URL);

  // Create image - automatically added to NiiVue and loads progressively
  const image = await OMEZarrNVImage.create({ multiscales, niivue: nv });

  // Expose image for testing
  window.image = image;

  // Signal when progressive loading completes
  image.addEventListener("populateComplete", () => {
    window.loadingComplete = true;
  });
}

main();
