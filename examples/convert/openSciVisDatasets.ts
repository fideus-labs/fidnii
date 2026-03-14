// SPDX-FileCopyrightText: Copyright (c) Fideus Labs LLC
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// OME-Zarr Open SciVis Datasets
// @see https://github.com/InsightSoftwareConsortium/OMEZarrOpenSciVisDatasets
// ---------------------------------------------------------------------------

export interface OpenScivisDataset {
  name: string
  url: string
}

export type OpenScivisCategory =
  | OpenScivisDataset[]
  | Record<string, OpenScivisDataset[]>

const OPEN_SCIVIS_BASE_URL =
  "https://ome-zarr-scivis.s3.us-east-1.amazonaws.com/v0.5/96x2"

export const OPEN_SCIVIS_CATEGORIES: Record<string, OpenScivisCategory> = {
  "CT Scans": {
    Human: [
      { name: "Aneurism", url: `${OPEN_SCIVIS_BASE_URL}/aneurism.ome.zarr` },
      { name: "Foot", url: `${OPEN_SCIVIS_BASE_URL}/foot.ome.zarr` },
      { name: "Pancreas", url: `${OPEN_SCIVIS_BASE_URL}/pancreas.ome.zarr` },
      { name: "Prone", url: `${OPEN_SCIVIS_BASE_URL}/prone.ome.zarr` },
      { name: "Skull", url: `${OPEN_SCIVIS_BASE_URL}/skull.ome.zarr` },
      { name: "Stent", url: `${OPEN_SCIVIS_BASE_URL}/stent.ome.zarr` },
      { name: "Tooth", url: `${OPEN_SCIVIS_BASE_URL}/tooth.ome.zarr` },
      { name: "Vertebra", url: `${OPEN_SCIVIS_BASE_URL}/vertebra.ome.zarr` },
      {
        name: "Visible Human",
        url: `${OPEN_SCIVIS_BASE_URL}/visible_human.ome.zarr`,
      },
    ],
    Animals: [
      { name: "Bunny", url: `${OPEN_SCIVIS_BASE_URL}/bunny.ome.zarr` },
      { name: "Carp", url: `${OPEN_SCIVIS_BASE_URL}/carp.ome.zarr` },
      {
        name: "Chameleon",
        url: `${OPEN_SCIVIS_BASE_URL}/chameleon.ome.zarr`,
      },
      {
        name: "Kingsnake",
        url: `${OPEN_SCIVIS_BASE_URL}/kingsnake.ome.zarr`,
      },
      { name: "Lobster", url: `${OPEN_SCIVIS_BASE_URL}/lobster.ome.zarr` },
      {
        name: "Pawpawsaurus",
        url: `${OPEN_SCIVIS_BASE_URL}/pawpawsaurus.ome.zarr`,
      },
      {
        name: "Pig Heart",
        url: `${OPEN_SCIVIS_BASE_URL}/pig_heart.ome.zarr`,
      },
      {
        name: "Stag Beetle",
        url: `${OPEN_SCIVIS_BASE_URL}/stag_beetle.ome.zarr`,
      },
      {
        name: "Zebrafish",
        url: `${OPEN_SCIVIS_BASE_URL}/zebrafish.ome.zarr`,
      },
    ],
    Objects: [
      { name: "Backpack", url: `${OPEN_SCIVIS_BASE_URL}/backpack.ome.zarr` },
      { name: "Beechnut", url: `${OPEN_SCIVIS_BASE_URL}/beechnut.ome.zarr` },
      { name: "Bonsai", url: `${OPEN_SCIVIS_BASE_URL}/bonsai.ome.zarr` },
      {
        name: "Boston Teapot",
        url: `${OPEN_SCIVIS_BASE_URL}/boston_teapot.ome.zarr`,
      },
      {
        name: "Christmas Tree",
        url: `${OPEN_SCIVIS_BASE_URL}/christmas_tree.ome.zarr`,
      },
      { name: "Engine", url: `${OPEN_SCIVIS_BASE_URL}/engine.ome.zarr` },
      { name: "Present", url: `${OPEN_SCIVIS_BASE_URL}/present.ome.zarr` },
      {
        name: "Synthetic Truss",
        url: `${OPEN_SCIVIS_BASE_URL}/synthetic_truss.ome.zarr`,
      },
      {
        name: "Woodbranch",
        url: `${OPEN_SCIVIS_BASE_URL}/woodbranch.ome.zarr`,
      },
      { name: "Zeiss", url: `${OPEN_SCIVIS_BASE_URL}/zeiss.ome.zarr` },
    ],
  },
  "MRI Scans": [
    { name: "Frog", url: `${OPEN_SCIVIS_BASE_URL}/frog.ome.zarr` },
    {
      name: "MRI Ventricles",
      url: `${OPEN_SCIVIS_BASE_URL}/mri_ventricles.ome.zarr`,
    },
    {
      name: "MRI Woman",
      url: `${OPEN_SCIVIS_BASE_URL}/mri_woman.ome.zarr`,
    },
    {
      name: "MRT Angio",
      url: `${OPEN_SCIVIS_BASE_URL}/mrt_angio.ome.zarr`,
    },
  ],
  Microscopy: [
    {
      name: "Marmoset Neurons",
      url: `${OPEN_SCIVIS_BASE_URL}/marmoset_neurons.ome.zarr`,
    },
    {
      name: "Neocortical Layer 1 Axons",
      url: `${OPEN_SCIVIS_BASE_URL}/neocortical_layer_1_axons.ome.zarr`,
    },
  ],
  Simulations: [
    {
      name: "Blunt Fin",
      url: `${OPEN_SCIVIS_BASE_URL}/blunt_fin.ome.zarr`,
    },
    {
      name: "CSAFE Heptane",
      url: `${OPEN_SCIVIS_BASE_URL}/csafe_heptane.ome.zarr`,
    },
    { name: "Duct", url: `${OPEN_SCIVIS_BASE_URL}/duct.ome.zarr` },
    { name: "Fuel", url: `${OPEN_SCIVIS_BASE_URL}/fuel.ome.zarr` },
    { name: "HCCI OH", url: `${OPEN_SCIVIS_BASE_URL}/hcci_oh.ome.zarr` },
    {
      name: "Hydrogen Atom",
      url: `${OPEN_SCIVIS_BASE_URL}/hydrogen_atom.ome.zarr`,
    },
    { name: "JICF Q", url: `${OPEN_SCIVIS_BASE_URL}/jicf_q.ome.zarr` },
    {
      name: "Magnetic Reconnection",
      url: `${OPEN_SCIVIS_BASE_URL}/magnetic_reconnection.ome.zarr`,
    },
    {
      name: "Marschner-Lobb",
      url: `${OPEN_SCIVIS_BASE_URL}/marschner_lobb.ome.zarr`,
    },
    { name: "Miranda", url: `${OPEN_SCIVIS_BASE_URL}/miranda.ome.zarr` },
    { name: "Neghip", url: `${OPEN_SCIVIS_BASE_URL}/neghip.ome.zarr` },
    { name: "Nucleon", url: `${OPEN_SCIVIS_BASE_URL}/nucleon.ome.zarr` },
    {
      name: "Richtmyer-Meshkov",
      url: `${OPEN_SCIVIS_BASE_URL}/richtmyer_meshkov.ome.zarr`,
    },
    { name: "Rotstrat", url: `${OPEN_SCIVIS_BASE_URL}/rotstrat.ome.zarr` },
    {
      name: "Shockwave",
      url: `${OPEN_SCIVIS_BASE_URL}/shockwave.ome.zarr`,
    },
    { name: "Silicium", url: `${OPEN_SCIVIS_BASE_URL}/silicium.ome.zarr` },
    {
      name: "Supernova",
      url: `${OPEN_SCIVIS_BASE_URL}/supernova.ome.zarr`,
    },
    {
      name: "TACC Turbulence",
      url: `${OPEN_SCIVIS_BASE_URL}/tacc_turbulence.ome.zarr`,
    },
  ],
}
