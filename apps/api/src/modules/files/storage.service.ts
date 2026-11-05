import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';

export interface SignedUpload {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Private S3-compatible object storage (SeaweedFS locally, Cloudflare R2 / AWS S3 in cloud).
 * The bucket is never public. Signed URLs are bearer secrets: never log them.
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
      maxAttempts: 2,
      // The SDK's default flexible checksums would bake a checksum of an *empty* body into
      // presigned PUT URLs (browser uploads then fail with BadDigest), and R2/SeaweedFS don't
      // support every algorithm. Only compute/validate checksums when an operation requires it.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Throws if the bucket is unreachable or credentials are wrong. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(3000),
    });
  }

  /**
   * Presigned PUT for a direct browser upload. Content-Type and Content-Length are signed,
   * so the client must upload exactly the declared size (storage-side size limit).
   */
  async createUploadUrl(key: string, contentType: string, bytes: number): Promise<SignedUpload> {
    const ttl = this.config.UPLOAD_URL_TTL_SECONDS;
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: bytes,
      }),
      { expiresIn: ttl, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return {
      url,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /** Presigned GET with a short TTL (packets for agents, previews). */
  async createDownloadUrl(
    key: string,
    ttlSeconds = this.config.DOWNLOAD_URL_TTL_SECONDS,
  ): Promise<{ url: string; expiresAt: Date }> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  /** Object size in bytes, or null if it doesn't exist. */
  async head(key: string): Promise<{ bytes: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { bytes: res.ContentLength ?? 0 };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Download an object fully into memory, refusing anything larger than maxBytes. */
  async getBuffer(key: string, maxBytes: number): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if ((res.ContentLength ?? 0) > maxBytes) {
      throw new Error(`Object ${key} exceeds ${maxBytes} bytes`);
    }
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof NotFound ||
    (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404)
  );
}
