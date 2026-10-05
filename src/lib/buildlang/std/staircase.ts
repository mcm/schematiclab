// `std:staircase`: a straight, solid flight of stairs filling its box. The
// bottom step is at the front (+z) and the flight climbs one block per
// block toward the back, across the box's whole width. Each step clears
// the box above it, so a staircase written after a floor cuts its own
// stairwell. It is built one step per nested `use` of itself: the rest of
// the flight is the box less its front slice and bottom row.

import type { StdTemplate } from "./types";

export const staircase: StdTemplate = {
  params: {
    material: "@floor",
  },
  body: [
    { clear: true },
    {
      split: {
        axis: "z",
        parts: [
          {
            size: "~",
            do: [
              {
                split: {
                  axis: "y",
                  parts: [
                    { size: 1, do: [{ fill: "${material}:block" }] },
                    {
                      size: "~",
                      do: [
                        {
                          use: {
                            name: "std:staircase",
                            with: { material: "$material" },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
          {
            size: 1,
            do: [
              {
                box: {
                  size: ["100%", 1, "100%"],
                  do: [
                    {
                      fill: {
                        material: "${material}:stairs",
                        facing: "-z",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ],
};
