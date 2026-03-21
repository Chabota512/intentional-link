import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post("/storage/upload", upload.single("file"), async (req: Request, res: Response) => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  try {
    const { buffer, originalname, mimetype, size } = req.file;

    const [record] = await db.insert(uploadsTable).values({
      data: buffer,
      contentType: mimetype,
      filename: originalname,
      fileSize: size,
      uploadedBy: userId,
    }).returning({ id: uploadsTable.id });

    const url = `/api/storage/uploads/${record.id}`;
    res.json({ uploadId: record.id, url, objectPath: url });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/storage/uploads/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [record] = await db.select({
      data: uploadsTable.data,
      contentType: uploadsTable.contentType,
      filename: uploadsTable.filename,
      fileSize: uploadsTable.fileSize,
    }).from(uploadsTable).where(eq(uploadsTable.id, id)).limit(1);

    if (!record) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const data: Buffer = Buffer.isBuffer(record.data)
      ? record.data
      : Buffer.from(record.data as any);
    const totalSize = data.byteLength;
    const contentType = record.contentType;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(record.filename)}"`
    );

    const rangeHeader = req.headers["range"];
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      const chunkSize = end - start + 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        res.setHeader("Content-Range", `bytes */${totalSize}`);
        res.status(416).end();
        return;
      }

      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      res.setHeader("Content-Length", chunkSize);
      res.status(206);
      res.end(data.subarray(start, end + 1));
    } else {
      res.setHeader("Content-Length", totalSize);
      res.status(200);
      res.end(data);
    }
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Failed to retrieve file" });
  }
});

export default router;
