export interface BattlefieldFields {
  name: string;
  geography: string;
  history: string;
}

export interface AssetImage {
  buffer: Buffer;
  mime: string;
  name: string;
}

export type AssetErrorCode =
  | "invalid name"
  | "invalid geography"
  | "invalid history"
  | "image required"
  | "invalid image"
  | "image too large"
  | "battlefield not found"
  | "battlefield archived"
  | "auction not found"
  | "preparation locked";

export class AssetError extends Error {
  constructor(public readonly code: AssetErrorCode) {
    super(code);
  }
}

export function validateBattlefield(fields: BattlefieldFields): BattlefieldFields {
  const result: BattlefieldFields = { name: "", geography: "", history: "" };
  for (const field of ["name", "geography", "history"] as const) {
    const value = fields?.[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AssetError(`invalid ${field}`);
    }
    result[field] = value.trim();
  }
  if (result.name.length > 200) throw new AssetError("invalid name");
  return result;
}

import { SINGLE_FILE_LIMIT_BYTES } from "./limits.js";

// Shared upload policy for battlefield and background images. Trusted bundled
// defaults are not uploads and do not pass through this validator.
export function validateAssetImage(image: AssetImage): AssetImage {
  if (!image) throw new AssetError("image required");
  const { buffer, mime } = image;
  if (!Buffer.isBuffer(buffer)) throw new AssetError("invalid image");
  if (buffer.length === 0) throw new AssetError("image required");
  if (buffer.length > SINGLE_FILE_LIMIT_BYTES) throw new AssetError("image too large");

  let matches = false;
  switch (mime) {
    case "image/png":
      matches = buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
      break;
    case "image/jpeg":
      matches = buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
      break;
    case "image/gif": {
      const header = buffer.subarray(0, 6);
      matches = header.equals(Buffer.from("GIF87a")) || header.equals(Buffer.from("GIF89a"));
      break;
    }
    case "image/webp":
      matches = buffer.subarray(0, 4).equals(Buffer.from("RIFF"))
        && buffer.subarray(8, 12).equals(Buffer.from("WEBP"));
      break;
  }
  if (!matches) throw new AssetError("invalid image");
  return image;
}
