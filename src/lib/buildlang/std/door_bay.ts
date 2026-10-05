// `std:door_bay`: a face tile of wall with a framed door at the bottom centre.

import type { StdTemplate } from "./types";

export const doorBay: StdTemplate = {
  doc: "A face tile of wall with a door at its bottom centre, facing in, inside a 3×3 frame when the tile is at least 3 wide and 3 high.",
  params: {
    wall: { default: "@wall", doc: "the wall around the door" },
    door: { default: "@door", doc: "the door (its `door` variant is used)" },
    frame: { default: "@wall", doc: "the frame around the opening" },
  },
  body: [
    { fill: "$wall" },
    {
      when: {
        min: [3, 3, null],
        do: [
          {
            box: {
              at: ["center", 0, 0],
              size: [3, 3, 1],
              do: [{ fill: "$frame" }],
            },
          },
        ],
      },
    },
    { door: "$door" },
  ],
};
