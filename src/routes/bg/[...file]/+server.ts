import { error } from "@sveltejs/kit";
import path from "node:path";
import process from "node:process";

import type { RequestHandler } from "./$types";

// Background images are not bundled into the build/executable; they are read from
// disk at runtime. Override the location with BG_DIR (relative paths resolve against cwd).
const bgDir = () => path.resolve(process.env.BG_DIR || "assets/bg");

export const GET: RequestHandler = async ({ params, request }) => {
  const root = bgDir();
  const filePath = path.resolve(root, params.file);
  if (!filePath.startsWith(root + path.sep) || path.basename(filePath).startsWith(".")) {
    error(404, "Not found");
  }

  const file = Bun.file(filePath);
  const stat = await file.stat().catch(() => null);
  if (!stat?.isFile()) error(404, "Not found");

  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "content-type": file.type,
    "cache-control": "public, max-age=0, must-revalidate",
    "last-modified": stat.mtime.toUTCString(),
    etag,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(file, { headers });
};
