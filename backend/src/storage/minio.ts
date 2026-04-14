import type { Readable } from 'node:stream';
import { Client } from 'minio';

import { config } from '../config.ts';

export const minioClient = new Client({
  endPoint: config.MINIO_ENDPOINT,
  port: config.MINIO_PORT,
  useSSL: config.MINIO_USE_SSL,
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});

export const BUCKET = config.MINIO_BUCKET;

export async function putReport(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await minioClient.putObject(BUCKET, key, body, body.byteLength, {
    'Content-Type': contentType,
  });
}

export async function getReportStream(key: string): Promise<Readable> {
  return minioClient.getObject(BUCKET, key);
}

export async function statReport(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  try {
    const stat = await minioClient.statObject(BUCKET, key);
    return {
      size: stat.size,
      contentType: stat.metaData?.['content-type'] ?? 'application/octet-stream',
    };
  } catch (err) {
    if ((err as { code?: string }).code === 'NotFound') return null;
    throw err;
  }
}
