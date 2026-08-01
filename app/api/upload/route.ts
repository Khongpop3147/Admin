import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

// Slip photos come straight off a phone camera (or an unsent WhatsApp/LINE
// forward) with zero compression — a single upload can be 3-8MB despite the
// slip itself being a small block of text/QR on an otherwise blank
// background. Only the readable content matters here, not resolution, so
// resize+recompress every image upload (not PDFs — sharp can't touch those,
// and a slip exported as PDF is rare enough not to bother).
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 78;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file received." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadDir = path.join(process.cwd(), "public/uploads");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

    let outputBuffer = buffer;
    let filename = Date.now() + "_" + file.name.replace(/\s/g, "_");

    if (!isPdf) {
      try {
        outputBuffer = await sharp(buffer)
          .rotate() // apply the camera's EXIF orientation before stripping metadata
          .resize({ width: MAX_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer();
        // Normalize to .jpg since the content is now always a JPEG,
        // regardless of what the original extension was.
        filename = filename.replace(/\.[^./\\]+$/, "") + ".jpg";
      } catch (e) {
        // Not a format sharp can decode (or a corrupt file) — fall back to
        // storing the original untouched rather than losing the upload.
        console.error("Slip image compression failed, storing original:", e);
      }
    }

    await writeFile(path.join(uploadDir, filename), outputBuffer);

    // Served via a route handler (not the static /uploads/ pass-through) —
    // Next.js's static public/ handler only reliably serves files that
    // existed when the server process started, so a file uploaded seconds
    // ago while the server is already running can silently 404 there.
    const fileUrl = `/api/uploads/${filename}`;

    return NextResponse.json({ success: true, url: fileUrl }, { status: 201 });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
