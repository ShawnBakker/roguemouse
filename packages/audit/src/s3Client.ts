import { S3Client } from "@aws-sdk/client-s3";

import type { S3ClientConfig } from "./types.js";

/**
 * Construct an AWS S3 SDK v3 client configured for Vultr Object Storage.
 *
 * Vultr's S3-compatible endpoint is `https://ams1.vultrobjects.com` in
 * region `ams1`. Virtual-hosted style URL addressing works (per
 * `.claude/rules/vultr.md`); we leave `forcePathStyle` at its default.
 *
 * The factory keeps `process.env` reads out of this workspace package per
 * the stack rule — the caller (the smoke runner; later, the Next.js API
 * route) reads env values once at the entry point and passes them in.
 */
export function createS3Client(config: S3ClientConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
