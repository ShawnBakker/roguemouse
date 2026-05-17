export const __packageName = "@roguemouse/audit";

export { sha256Hex } from "./sha256.js";
export { GENESIS_HASH, GENESIS_SEED } from "./genesis.js";

export { createS3Client } from "./s3Client.js";
export { RunAuditWriter } from "./runAuditWriter.js";

export type {
  AppendData,
  AppendInput,
  AppendResult,
  AuditError,
  ListData,
  ListResult,
  ReadData,
  ReadResult,
  RunAuditWriterArgs,
  S3ClientConfig,
} from "./types.js";
