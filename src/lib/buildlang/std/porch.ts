// `std:porch`: a covered porch in front of a wall.

import type { StdTemplate } from "./types";

export const porch: StdTemplate = {
  doc: "A covered porch filling a box in front of a wall: the box's back (z = 0) touches the wall and its front (+z) faces out. A floor at the bottom, a post at each front corner and a slab roof on top. At least 3 high.",
  params: {
    floor: { default: "@wall", doc: "the floor" },
    post: { default: "@wall:fence", doc: "the front corner posts" },
    roof: { default: "@wall:slab", doc: "the roof (one layer)" },
  },
  body: [
    {
      split: {
        axis: "y",
        parts: [
          { size: 1, do: [{ fill: "$floor" }] },
          {
            size: "~",
            do: [
              {
                box: {
                  at: [0, 0, -1],
                  size: [1, "~", 1],
                  do: [{ fill: "$post" }],
                },
              },
              {
                box: {
                  at: [-1, 0, -1],
                  size: [1, "~", 1],
                  do: [{ fill: "$post" }],
                },
              },
            ],
          },
          { size: 1, do: [{ fill: "$roof" }] },
        ],
      },
    },
  ],
};
