// The upload's Blob API over the in-memory fake Blob store: overwrites,
// create-only writes and `ifMatch` writes as the SDK does them, with a new
// ETag per write.

import { BlobError, BlobPreconditionFailedError } from "@vercel/blob";

import { fakeBlobEtag, type FakeBlob } from "../../mcp/__tests__/fake-blob";
import type { ModpackBlobApi } from "../publish";

export function fakeModpackBlobApi(
  blob: FakeBlob,
  now: () => Date,
): ModpackBlobApi {
  let version = 0;
  return {
    get: (pathname, options) => blob.get(pathname, options),
    exists: async (pathname) => blob.objects.has(pathname),
    async put(pathname, body, options) {
      blob.calls.push({ method: "put", args: [pathname, body, options] });
      const stored = blob.objects.get(pathname);
      if (options.ifMatch !== undefined) {
        if (!stored || fakeBlobEtag(stored) !== options.ifMatch) {
          throw new BlobPreconditionFailedError();
        }
      } else if (stored && !options.allowOverwrite) {
        throw new BlobError("This blob already exists.");
      }
      blob.objects.set(pathname, {
        body,
        uploadedAt: now(),
        etag: `"v${++version}"`,
      });
    },
  };
}
