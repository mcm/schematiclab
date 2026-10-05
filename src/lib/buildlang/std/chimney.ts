// `std:chimney`: fills its box with the chimney material and caps the top
// row. Run it in a box from the ground (or a floor) up past the roof:
// roofs sit on a lower layer, so the chimney wins where they meet.

import type { StdTemplate } from "./types";

export const chimney: StdTemplate = {
  params: {
    material: "@chimney",
    cap: "@chimney:slab",
  },
  body: [
    {
      split: {
        axis: "y",
        parts: [
          { size: "~", do: [{ fill: "$material" }] },
          { size: 1, do: [{ fill: "$cap" }] },
        ],
      },
    },
  ],
};
