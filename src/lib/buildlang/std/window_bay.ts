// `std:window_bay`: a face tile of wall with a centred window.

import type { StdTemplate } from "./types";

export const windowBay: StdTemplate = {
  doc: "A face tile (from `faces` or a `repeat` over a face) of wall with a window centred across it.",
  params: {
    wall: { default: "@wall", doc: "the wall around the window" },
    glass: { default: "@window", doc: "the window" },
    width: { default: 1, doc: "window width" },
    height: { default: 2, doc: "window height" },
    sill: {
      default: 1,
      doc: "height of the window's bottom above the tile's bottom",
    },
  },
  body: [
    { fill: "$wall" },
    {
      box: {
        at: ["center", "$sill", 0],
        size: ["$width", "$height", 1],
        do: [{ fill: "$glass" }],
      },
    },
  ],
};
