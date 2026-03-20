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

    res.setHeader("Content-Type", record.contentType);
    res.setHeader("Content-Length", record.fileSize);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(record.filename)}"`
    );
    res.send(record.data);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: "Failed to retrieve file" });
  }
});

export default router;
