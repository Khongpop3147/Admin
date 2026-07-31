import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file received." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = Date.now() + "_" + file.name.replace(/\s/g, "_");
    
    // Save to public/uploads
    const uploadDir = path.join(process.cwd(), "public/uploads");
    await writeFile(path.join(uploadDir, filename), buffer);

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
