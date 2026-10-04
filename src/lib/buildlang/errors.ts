// Compile-time errors of the build language. Worker-safe.

import type { ProgramError } from "./program";

/** An error at a program path; the compiler reports it and moves on. */
export class BuildError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "BuildError";
  }

  toProgramError(): ProgramError {
    return { path: this.path, message: this.message };
  }
}
