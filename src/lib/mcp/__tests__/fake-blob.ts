// In-memory stand-in for the Vercel Blob SDK, recording every call.

import type { BlobClient, BlobListEntry } from "../blob";

export interface FakeBlob extends BlobClient {
  objects: Map<string, FakeBlobObject>;
  calls: { method: string; args: unknown[] }[];
}

export interface FakeBlobObject {
  body: Uint8Array;
  uploadedAt: Date;
  /** The blob's ETag; `get` makes one up from the body when unset. */
  etag?: string;
}

export function fakeBlobEtag(object: FakeBlobObject): string {
  return object.etag ?? `"${object.body.byteLength}"`;
}

export function createFakeBlob(
  now: () => Date,
  options: { pageSize?: number; putError?: Error } = {},
): FakeBlob {
  const objects = new Map<string, FakeBlobObject>();
  const calls: { method: string; args: unknown[] }[] = [];
  let suffix = 0;
  const pageSize = options.pageSize ?? 1000;
  return {
    objects,
    calls,
    async put(pathname, body, opts) {
      calls.push({ method: "put", args: [pathname, body, opts] });
      if (options.putError) throw options.putError;
      const dot = pathname.lastIndexOf(".");
      const stored =
        dot > pathname.lastIndexOf("/")
          ? `${pathname.slice(0, dot)}-rnd${++suffix}${pathname.slice(dot)}`
          : `${pathname}-rnd${++suffix}`;
      objects.set(stored, { body, uploadedAt: now() });
      return { pathname: stored };
    },
    async issueSignedToken(opts) {
      calls.push({ method: "issueSignedToken", args: [opts] });
      return {
        delegationToken: `delegation:${opts.pathname}:${opts.validUntil}`,
        clientSigningToken: "signing",
      };
    },
    async presignUrl(token, opts) {
      calls.push({ method: "presignUrl", args: [token, opts] });
      return {
        presignedUrl: `https://store.private.blob.vercel-storage.com/${opts.pathname}?vercel-blob-expires=${opts.validUntil}`,
      };
    },
    async list(opts) {
      calls.push({ method: "list", args: [opts] });
      const all: BlobListEntry[] = [...objects]
        .filter(([pathname]) => pathname.startsWith(opts.prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pathname, o]) => ({ pathname, uploadedAt: o.uploadedAt }));
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const end = start + pageSize;
      const hasMore = end < all.length;
      return {
        blobs: all.slice(start, end),
        hasMore,
        cursor: hasMore ? String(end) : undefined,
      };
    },
    async del(pathnames) {
      calls.push({ method: "del", args: [pathnames] });
      for (const p of pathnames) objects.delete(p);
    },
    async get(pathname, opts) {
      calls.push({ method: "get", args: [pathname, opts] });
      const object = objects.get(pathname);
      if (!object) return null;
      return {
        stream: new Blob([new Uint8Array(object.body)]).stream(),
        size: object.body.byteLength,
        uploadedAt: object.uploadedAt,
        etag: fakeBlobEtag(object),
      };
    },
  };
}
