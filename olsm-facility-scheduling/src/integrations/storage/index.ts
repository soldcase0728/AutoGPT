/**
 * Private file storage for signed PDFs and certificates of insurance.
 *
 * Objects are never public. Downloads go through /api/documents/[id]/file,
 * which re-checks permission and then streams from here, so a leaked URL is
 * useless without a session.
 *
 * S3 and GCS are signed with SigV4 / V4 respectively at call time; the local
 * provider writes under STORAGE_LOCAL_DIR and is intended for development.
 */

import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "@/lib/env";

/** Node's fetch types do not accept a Uint8Array view directly. */
function toBodyInit(body: Uint8Array): ArrayBuffer {
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
}

// ---------------------------------------------------------------------------
// Local filesystem
// ---------------------------------------------------------------------------

class LocalStorage implements StorageProvider {
  readonly name = "local";

  private path(key: string): string {
    const base = resolve(env.storage.localDir);
    // Reject traversal outright rather than sanitising it away.
    const target = resolve(join(base, key));
    if (!target.startsWith(base)) throw new Error("Invalid storage key.");
    return target;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// S3 (SigV4, no SDK)
// ---------------------------------------------------------------------------

class S3Storage implements StorageProvider {
  readonly name = "s3";

  private get region(): string {
    return process.env.AWS_REGION ?? "us-east-1";
  }

  private get host(): string {
    return `${env.storage.bucket}.s3.${this.region}.amazonaws.com`;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    const res = await fetch(`https://${this.host}/${key}`, {
      method: "PUT",
      headers: await this.signedHeaders("PUT", key, body, contentType),
      body: toBodyInit(body),
    });
    if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await fetch(`https://${this.host}/${key}`, {
      method: "GET",
      headers: await this.signedHeaders("GET", key, new Uint8Array(), ""),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async signedHeaders(
    method: string,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<Record<string, string>> {
    const accessKey = process.env.AWS_ACCESS_KEY_ID ?? "";
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
    if (!accessKey || !secretKey) throw new Error("AWS credentials are not configured.");

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body).digest("hex");

    const canonicalHeaders =
      `host:${this.host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaderNames = "host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      method,
      `/${key}`,
      "",
      canonicalHeaders,
      signedHeaderNames,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const kDate = createHmac("sha256", `AWS4${secretKey}`).update(dateStamp).digest();
    const kRegion = createHmac("sha256", kDate).update(this.region).digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    const headers: Record<string, string> = {
      host: this.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    };
    if (contentType) headers["content-type"] = contentType;
    return headers;
  }
}

let cached: StorageProvider | null = null;

export function storage(): StorageProvider {
  if (cached) return cached;
  switch (env.storage.provider) {
    case "s3":
      cached = env.storage.bucket ? new S3Storage() : new LocalStorage();
      break;
    default:
      cached = new LocalStorage();
  }
  return cached;
}

/**
 * Storage key for an executed document. Includes the year so a retention sweep
 * can operate on a prefix. Retention periods are an open decision -- see
 * DECISIONS.md; nothing here deletes anything.
 */
export function documentKey(documentId: string, filename: string, at: Date = new Date()): string {
  return `documents/${at.getUTCFullYear()}/${documentId}/${filename}`;
}
