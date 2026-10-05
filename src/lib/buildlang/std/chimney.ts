// `std:chimney`: a solid stack with an open flue.

import type { StdTemplate } from "./types";

export const chimney: StdTemplate = {
  doc: "A chimney stack filling a box, standing on whatever is below it. When at least 3 wide and 3 deep, its top two layers are open in the middle (the flue).",
  params: {
    material: { default: "bricks", doc: "the stack" },
  },
  body: [
    { fill: "$material" },
    {
      when: {
        min: [3, 3, 3],
        do: [
          {
            inset: {
              by: 1,
              do: [
                {
                  box: {
                    at: [0, -2, 0],
                    size: ["~", 2, "~"],
                    do: [{ clear: true }],
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
