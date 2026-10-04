// The narrow slice of the Vercel Blob SDK the MCP tools and the cleanup cron
// use, so tests inject a fake. Credentials are never passed in code: the SDK
// resolves them itself (OIDC `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID` on Vercel,
// or what `vercel env pull` wrote for local development).

import {
  del,
  get,
  issueSignedToken,
  list,
  presignUrl,
  put,
  type IssuedSignedToken,
} from "@vercel/blob";

export interface BlobListEntry {
  pathname: string;
  uploadedAt: Date;
}

export interface BlobClient {
  put(
    pathname: string,
    body: Uint8Array,
    options: {
      access: "private";
      addRandomSuffix: true;
      contentType: string;
    },
  ): Promise<{ pathname: string }>;
  issueSignedToken(options: {
    pathname: string;
    operations: "get"[];
    validUntil: number;
  }): Promise<
    Pick<IssuedSignedToken, "delegationToken" | "clientSigningToken">
  >;
  presignUrl(
    token: Pick<IssuedSignedToken, "delegationToken" | "clientSigningToken">,
    options: {
      operation: "get";
      pathname: string;
      validUntil: number;
      access: "private";
    },
  ): Promise<{ presignedUrl: string }>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{ blobs: BlobListEntry[]; cursor?: string; hasMore: boolean }>;
  del(pathnames: string[]): Promise<void>;
  // Reads a private blob by pathname; null when it does not exist.
  get(
    pathname: string,
    options: { access: "private" },
  ): Promise<{
    stream: ReadableStream<Uint8Array>;
    size: number;
    uploadedAt: Date;
  } | null>;
}

// Whether the environment names the Blob store (`BLOB_STORE_ID`, with OIDC
// on Vercel). A `BLOB_READ_WRITE_TOKEN` alone doesn't count: without the
// store id, the tools couldn't accept their own output URLs as inputs.
export function blobCredentialsConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return Boolean(env.BLOB_STORE_ID?.trim());
}

export const vercelBlobClient: BlobClient = {
  put: (pathname, body, options) =>
    // Buffer is a PutBody the SDK accepts on Node; a bare Uint8Array is not.
    put(
      pathname,
      Buffer.from(body.buffer, body.byteOffset, body.byteLength),
      options,
    ),
  issueSignedToken: (options) => issueSignedToken(options),
  presignUrl: (token, options) => presignUrl(token, options),
  list: (options) => list(options),
  del: (pathnames) => del(pathnames),
  get: async (pathname, options) => {
    const result = await get(pathname, options);
    if (result === null) return null;
    if (result.statusCode !== 200) {
      throw new Error(`Unexpected Blob response ${result.statusCode}`);
    }
    return {
      stream: result.stream,
      size: result.blob.size,
      uploadedAt: result.blob.uploadedAt,
    };
  },
};

// The SDK client when credentials are configured, else null (tools that
// write files then answer with a tool error).
export function blobClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): BlobClient | null {
  return blobCredentialsConfigured(env) ? vercelBlobClient : null;
}
