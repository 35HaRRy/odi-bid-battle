import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import {
  REQUEST_BODY_BUDGET_BYTES,
  SINGLE_FILE_LIMIT_BYTES,
  utf8Bytes,
  PayloadTooLargeError,
} from "./limits.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SINGLE_FILE_LIMIT_BYTES },
});

export function isMulterFileSizeError(err: unknown): boolean {
  return err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
}

// Single-file uploads only. Works both as Express route middleware
// (app.post(path, uploadSingle("image"), handler)) and inline
// (uploadSingle("image")(req, res, cb)). Enforces the per-file ceiling via
// multer and the total request budget (file + text fields + multipart
// framing) against the actual parsed bytes, never just Content-Length.
export function uploadSingle(field: string) {
  // done takes an explicit any so inline callbacks keep multer's old shape.
  return (req: Request, res: Response, done: (err?: any) => void) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err) {
        done(err);
        return;
      }
      try {
        const fileBytes = req.file?.size ?? 0;
        const fieldBytes = utf8Bytes(JSON.stringify(req.body ?? {}));
        // Multipart boundary markers and part headers are not in req.body;
        // reserve a small fixed overhead allowance for them.
        const total = fileBytes + fieldBytes + 4096;
        if (total > REQUEST_BODY_BUDGET_BYTES) {
          done(new PayloadTooLargeError());
          return;
        }
        done();
      } catch (uploadErr) {
        done(uploadErr);
      }
    });
  };
}
