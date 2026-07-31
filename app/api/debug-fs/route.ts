import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const cwd = process.cwd();
  const uploadDir = path.join(cwd, "public/uploads");
  let uploadDirExists = false;
  let uploadDirContents: string[] = [];
  let uploadDirError: string | null = null;
  try {
    uploadDirExists = fs.existsSync(uploadDir);
    if (uploadDirExists) {
      uploadDirContents = fs.readdirSync(uploadDir);
    }
  } catch (e: any) {
    uploadDirError = e.message;
  }

  return NextResponse.json({
    cwd,
    uploadDir,
    uploadDirExists,
    uploadDirContents,
    uploadDirError,
    __dirname_equivalent: __dirname,
  });
}
