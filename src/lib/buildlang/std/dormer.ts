// `std:dormer`: a gabled dormer for a box in the main roof's box, its
// bottom at the eave and its front flush with the wall below. Its roof runs
// front to back at the same eave height, so with the main roof's material,
// pitch and `gable` it merges into the main roof (valleys where they meet,
// sealed like any merged roof). The window sits in the front gable, which
// the gable infill closes round it.

import type { StdTemplate } from "./types";

export const dormer: StdTemplate = {
  params: {
    roof: "@roof",
    pitch: 1,
    gable: "auto",
    overhang: 1,
    glass: "@window",
    width: 1,
    height: 2,
  },
  body: [
    {
      roof: {
        type: "gable",
        ridge: "z",
        material: "$roof",
        pitch: "$pitch",
        gable: "$gable",
        overhang: "$overhang",
        merge: false,
      },
    },
    {
      box: {
        at: ["center", 0, -1],
        size: ["$width", "$height", 1],
        do: [{ fill: "$glass" }],
      },
    },
  ],
};
