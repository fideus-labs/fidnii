import { Niivue } from "@niivue/niivue";
import { fromNgffZarr } from "@fideus-labs/ngff-zarr";
import { OMEZarrNVImage } from "@fideus-labs/fidnii";

const DATA_URL =
  "https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2/mri_woman.ome.zarr";

async function main() {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;

  // Initialize NiiVue
  const nv = new Niivue({ backColor: [0, 0, 0, 1] });
  await nv.attachToCanvas(canvas);
  nv.setSliceType(nv.sliceTypeRender);

  // Load OME-Zarr data
  const multiscales = await fromNgffZarr(DATA_URL);

  // Create and display image
  const image = await OMEZarrNVImage.create({ multiscales, niivue: nv });
  await image.populateVolume();
  nv.addVolume(image);
}

main();
