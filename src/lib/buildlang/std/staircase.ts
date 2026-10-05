// `std:staircase`: a straight flight of stairs on a solid wedge.

import type { StdTemplate } from "./types";

export const staircase: StdTemplate = {
  doc: "A straight flight filling a box: it starts at the front (+z) on the bottom layer and climbs one block per block towards the back, as wide as the box, with `support` filling under each step. It stops at the box's top or back; at most 32 steps.",
  params: {
    stairs: {
      default: "@wall",
      doc: "the steps (its `stairs` variant is used)",
    },
    support: {
      default: "@wall",
      doc: 'what fills under the steps ("air" for none)',
    },
  },
  body: [
    {
      box: {
        at: [0, 0, -1],
        size: ["~", 1, 1],
        do: [{ fill: { material: "${stairs}:stairs", facing: "-z" } }],
      },
    },
    {
      when: {
        min: [null, 2, 2],
        do: [
          {
            inset: {
              by: { front: 1 },
              do: [
                {
                  box: {
                    at: [0, 0, 0],
                    size: ["~", 1, "~"],
                    do: [{ fill: "$support" }],
                  },
                },
                {
                  inset: {
                    by: { bottom: 1 },
                    do: [
                      {
                        use: {
                          name: "std:staircase",
                          with: { stairs: "$stairs", support: "$support" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
};
