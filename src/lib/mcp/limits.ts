// Every usage limit of the public MCP endpoint, in one place. The endpoint is
// anonymous, so these bound what one request can cost; the Vercel Firewall's
// per-IP rate limit (docs/mcp.md) bounds how many requests there are.

import type { ParsedSchematicProjection } from "../convert";

// Request bodies over this are answered 413 with a JSON-RPC error before the
// body is parsed. It leaves room for a 5 MB schematic sent as base64.
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

// A schematic input (base64, pastebin/gist or our own Blob URL), decoded.
export const MAX_INPUT_BYTES = 5 * 1024 * 1024;

// Blocks in one parsed schematic or generated shape. Matches the Shape
// Generator's own `MAX_SHAPE_BLOCKS`; about 20 s to write and render on the
// server, well inside the tool timeout.
export const MAX_PROJECTION_BLOCKS = 2_000_000;

// A tool call that hasn't finished after this is answered with a tool error.
// It stays under the route's `maxDuration` (60 s) so the client gets an
// answer instead of a dropped connection.
export const TOOL_TIMEOUT_MS = 45_000;

// The limits tests may lower through `McpDeps.limits`.
export interface McpLimits {
  maxProjectionBlocks: number;
  toolTimeoutMs: number;
}

export const DEFAULT_LIMITS: McpLimits = {
  maxProjectionBlocks: MAX_PROJECTION_BLOCKS,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
};

export function resolveLimits(overrides?: Partial<McpLimits>): McpLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

export function formatMegabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}

/** Throws when `projection` has more blocks than `max`. */
export function assertProjectionBlocks(
  projection: Pick<ParsedSchematicProjection, "totalBlocks">,
  max: number = MAX_PROJECTION_BLOCKS,
): void {
  if (projection.totalBlocks > max) {
    throw new Error(
      `This schematic has ${projection.totalBlocks.toLocaleString("en-US")} blocks, more than the ${max.toLocaleString("en-US")} this server handles.`,
    );
  }
}

export class ToolTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(
      `${toolName} took longer than ${timeoutMs / 1000} seconds and was stopped. Try a smaller schematic or shape.`,
    );
    this.name = "ToolTimeoutError";
  }
}

/**
 * Settles with `work`, or rejects with `ToolTimeoutError` once `timeoutMs`
 * has passed. The timer only fires while `work` is waiting (network, Blob
 * storage); synchronous parsing and rendering are bounded by
 * `MAX_PROJECTION_BLOCKS` and the route's `maxDuration` instead.
 */
export async function withToolTimeout<T>(
  toolName: string,
  timeoutMs: number,
  work: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ToolTimeoutError(toolName, timeoutMs)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
