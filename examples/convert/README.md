# Convert to OME-Zarr

Browser-based converter from various image formats to OME-Zarr 0.5 (OZX).

## Features

- **Drag-and-drop** or file picker for input images
- **Supports many formats**: NIFTI, NRRD, MetaImage, DICOM, MRC, TIFF, VTK, and
  more
- **Live preview** with NiiVue during conversion
- **Configurable settings**: chunk size, scale levels, colormap, opacity
- **Multiscales info table**: shows pyramid levels, shapes, and estimated sizes
- **Auto-download**: OZX file downloads automatically after conversion

## Usage

```bash
# From repository root
pnpm install
pnpm --filter @fideus-labs/fidnii-example-convert dev
```

Then open http://localhost:5173 in your browser.

## How It Works

1. **Input**: Accepts various image formats via `@itk-wasm/image-io`
2. **Convert**: Transforms to NGFF format with `@fideus-labs/ngff-zarr`
3. **Downsample**: Generates multiscale pyramid
4. **Preview**: Renders with NiiVue using `@fideus-labs/fidnii`
5. **Package**: Creates RFC-9 compliant OZX file
6. **Download**: Auto-downloads the result

## Supported Input Formats

Via [@itk-wasm/image-io](https://github.com/InsightSoftwareConsortium/ITK-Wasm):

- NIFTI (`.nii`, `.nii.gz`)
- NRRD (`.nrrd`, `.nhdr`)
- MetaImage (`.mha`, `.mhd`)
- DICOM (single files)
- MRC (`.mrc`)
- TIFF (`.tif`, `.tiff`)
- VTK (`.vtk`)
- And many more...

## Output Format

The converter produces OME-Zarr 0.5 files in OZX format (RFC-9):

- Single-file ZIP archive
- Contains Zarr v3 arrays
- Includes anatomical orientation metadata (RFC-4)

See the [fidnii README](../../fidnii/README.md) for more details on the library.
