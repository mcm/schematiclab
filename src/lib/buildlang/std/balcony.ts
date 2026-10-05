// `std:balcony`: a floor sticking out of a wall with a railing round its
// three open sides. The box sits in front of the wall (its back against
// it) with its bottom at the floor level of the storey it opens from.

import type { StdTemplate } from "./types";

export const balcony: StdTemplate = {
  params: {
    floor: "@floor",
    railing: "@floor:fence",
  },
  body: [
    { box: { size: ["100%", 1, "100%"], do: [{ fill: "$floor" }] } },
    {
      box: {
        at: [0, 1, 0],
        size: ["100%", 1, "100%"],
        do: [
          { box: { size: [1, 1, "100%"], do: [{ fill: "$railing" }] } },
          {
            box: {
              at: [-1, 0, 0],
              size: [1, 1, "100%"],
              do: [{ fill: "$railing" }],
            },
          },
          {
            box: {
              at: [0, 0, -1],
              size: ["100%", 1, 1],
              do: [{ fill: "$railing" }],
            },
          },
        ],
      },
    },
  ],
};
