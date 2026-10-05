// `std:porch`: a covered porch filling a box in front of a wall (the box's
// back against the wall, its bottom at ground level): a deck, a post at
// each front corner and a slab roof on top.

import type { StdTemplate } from "./types";

export const porch: StdTemplate = {
  params: {
    deck: "@floor",
    post: "@post",
    roof: "@roof:slab",
  },
  body: [
    {
      split: {
        axis: "y",
        parts: [
          { size: 1, do: [{ fill: "$deck" }] },
          {
            size: "~",
            do: [
              {
                box: {
                  at: [0, 0, -1],
                  size: [1, "100%", 1],
                  do: [{ fill: "$post" }],
                },
              },
              {
                box: {
                  at: [-1, 0, -1],
                  size: [1, "100%", 1],
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
