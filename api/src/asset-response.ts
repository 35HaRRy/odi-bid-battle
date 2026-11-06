import type { Response } from "express";
import { validateAssetImage } from "./battlefield-domain.js";

export function sendAsset(res: Response, image: { buffer: Buffer; mime: string }, trustedDefault = false): void {
  let mime = "application/octet-stream";
  try {
    validateAssetImage({ ...image, name: "" });
    mime = image.mime;
  } catch { /* Preserve legacy bytes, never execute unsupported stored content. */ }
  if (trustedDefault) mime = image.mime;
  res.setHeader("Content-Type", mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Cache-Control", "no-store");
  if (mime === "application/octet-stream") res.setHeader("Content-Disposition", "attachment");
  res.send(image.buffer);
}
