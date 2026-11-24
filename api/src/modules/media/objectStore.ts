import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

export interface MediaObjectStore {
  put(key: string, filePath: string, size: number, contentType: string, contentMd5: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  list(prefix: string, continuationToken?: string): Promise<{ keys: Array<{ key: string; lastModified?: Date }>; continuationToken?: string }>;
}

export type R2Config = { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export class R2ObjectStore implements MediaObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async put(key: string, filePath: string, size: number, contentType: string, contentMd5: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket, Key: key, Body: createReadStream(filePath),
      ContentLength: size, ContentType: contentType, ContentMD5: contentMd5,
      CacheControl: "private, no-store",
    }));
  }

  async get(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!response.Body) throw new Error("Object storage returned an empty object body.");
    if (response.Body instanceof Readable) return response.Body;
    if ("transformToWebStream" in response.Body) return Readable.fromWeb(response.Body.transformToWebStream() as never);
    throw new Error("Object storage returned an unsupported stream.");
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async list(prefix: string, continuationToken?: string) {
    const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    return { keys: (response.Contents ?? []).flatMap((entry) => entry.Key ? [{ key: entry.Key, lastModified: entry.LastModified }] : []), ...(response.NextContinuationToken ? { continuationToken: response.NextContinuationToken } : {}) };
  }
}
