// `std:balcony`: a railed platform out from a wall.

import type { StdTemplate } from "./types";

export const balcony: StdTemplate = {
  doc: "A balcony filling a box out from a wall: the back (z = 0) touches the wall, the front (+z) faces out. A floor on the bottom layer and a railing around the front and sides on the layer above. At least 2 high.",
  params: {
    floor: { default: "@wall", doc: "the floor" },
    rail: { default: "@wall:fence", doc: "the railing" },
  },
  body: [
    {
      split: {
        axis: "y",
        parts: [
          { size: 1, do: [{ fill: "$floor" }] },
          {
            size: 1,
            do: [
              {
                faces: {
                  front: [{ fill: "$rail" }],
                  left: [{ fill: "$rail" }],
                  right: [{ fill: "$rail" }],
                },
              },
            ],
          },
          { size: "~" },
        ],
      },
    },
  ],
};
