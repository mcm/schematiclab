// `std:door_bay`: a door at the bottom centre of a face tile (or at `x`),
// with `lintel` operations on the row above it, across the whole tile.

import type { StdTemplate } from "./types";

export const doorBay: StdTemplate = {
  params: {
    door: "@door:door",
    hinge: "left",
    lintel: [],
  },
  body: [
    { door: { material: "$door", hinge: "$hinge" } },
    {
      box: {
        at: [0, 2, 0],
        size: ["100%", 1, "100%"],
        do: "$lintel",
      },
    },
  ],
};
