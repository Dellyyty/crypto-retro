#!/usr/bin/env node
/**
 * Rasterize site/assets/img/og.svg → og.png (1200x630) and app icons.
 * Requires rsvg-convert (brew install librsvg) or ImageMagick.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const IMG = resolve(fileURLToPath(new URL("../site/assets/img", import.meta.url)));

async function have(bin) {
  try {
    await run("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

const hasRsvg = await have("rsvg-convert");
const hasMagick = await have("magick");

async function render(svg, png, width, height) {
  if (hasRsvg) {
    await run("rsvg-convert", ["-w", String(width), "-h", String(height), "-o", png, svg]);
  } else if (hasMagick) {
    await run("magick", ["-background", "none", "-density", "300", svg, "-resize", `${width}x${height}!`, png]);
  } else {
    throw new Error("need rsvg-convert or ImageMagick");
  }
}

await access(join(IMG, "og.svg"));

await render(join(IMG, "og.svg"), join(IMG, "og.png"), 1200, 630);
await render(join(IMG, "favicon.svg"), join(IMG, "icon-192.png"), 192, 192);
await render(join(IMG, "favicon.svg"), join(IMG, "icon-512.png"), 512, 512);
await render(join(IMG, "favicon.svg"), join(IMG, "apple-touch-icon.png"), 180, 180);

console.log("✓ rendered og.png, icon-192.png, icon-512.png, apple-touch-icon.png");
