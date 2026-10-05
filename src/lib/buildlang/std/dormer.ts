// `std:dormer`: a small gabled window box for a roof.

import type { StdTemplate } from "./types";

export const dormer: StdTemplate = {
  doc: "A dormer filling a box, its window in the front (+z) face: walls up to one block below the top, a window centred in the front, and a stair gable along x on top. Best 3 or 5 wide and at least 4 high.",
  params: {
    wall: { default: "@wall", doc: "the dormer's walls" },
    glass: { default: "@window", doc: "the window" },
    roof: {
      default: "@wall",
      doc: "the gable (its `stairs` variant on the slopes)",
    },
  },
  body: [
    {
      split: {
        axis: "y",
        parts: [
          {
            size: "~",
            do: [
              { fill: "$wall" },
              {
                faces: {
                  front: [
                    {
                      box: {
                        at: ["center", 1, 0],
                        size: [1, "~", 1],
                        do: [{ fill: "$glass" }],
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            size: 1,
            do: [
              { fill: "$roof" },
              {
                box: {
                  at: [0, 0, 0],
                  size: [1, 1, "~"],
                  do: [{ fill: { material: "${roof}:stairs", facing: "+x" } }],
                },
              },
              {
                box: {
                  at: [-1, 0, 0],
                  size: [1, 1, "~"],
                  do: [{ fill: { material: "${roof}:stairs", facing: "-x" } }],
                },
              },
            ],
          },
        ],
      },
    },
  ],
};
