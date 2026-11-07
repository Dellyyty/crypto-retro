#!/usr/bin/env node
/**
 * Zero-dependency static server for docs/.
 * Correct MIME types for ES modules, woff2, webmanifest and svg.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../docs", import.meta.url)));
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const p = normalize(join(ROOT, decoded));
  return p.startsWith(ROOT) ? p : null;
}

const server = createServer(async (req, res) => {
  let path = safePath(req.url ?? "/");
  if (!path) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let info = await stat(path).catch(() => null);
    if (info?.isDirectory()) {
      path = join(path, "index.html");
      info = await stat(path).catch(() => null);
    }
    if (!info) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 Not Found");
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(`500 ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`CRYPTOCAST → http://localhost:${PORT}/`);
  console.log(`serving ${ROOT}`);
});
