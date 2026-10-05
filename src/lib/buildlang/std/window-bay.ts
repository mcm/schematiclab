// `std:window_bay`: a window centred in a face tile (a repeat tile of a
// `faces` scope), through the whole wall thickness. `sill` blocks of wall
// stay below it; `under` and `lintel` run on the rows just below and above
// the opening, across the whole tile.

import type { StdTemplate } from "./types";

export const windowBay: StdTemplate = {
  params: {
    glass: "@window",
    width: 1,
    height: 2,
    sill: 1,
    under: [],
    lintel: [],
  },
  body: [
    {
      split: {
        axis: "y",
        parts: [
          {
            size: "$sill",
            do: [
              {
                box: {
                  at: [0, -1, 0],
                  size: ["100%", 1, "100%"],
                  do: "$under",
                },
              },
            ],
          },
          {
            size: "$height",
            do: [
              {
                box: {
                  at: ["center", 0, 0],
                  size: ["$width", "100%", "100%"],
                  do: [{ fill: "$glass" }],
                },
              },
            ],
          },
          {
            size: "~",
            do: [{ box: { size: ["100%", 1, "100%"], do: "$lintel" } }],
          },
        ],
      },
    },
  ],
};
