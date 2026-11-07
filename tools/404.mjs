#!/usr/bin/env node
/**
 * Generate docs/404.html from the app shell.
 *
 * GitHub Pages serves 404.html for unknown paths. Deep links of the form
 * /crypto-retro/#network already land on index.html (the fragment is
 * client-side), but a mistyped path should still reach the broadcast rather
 * than GitHub's default page, and the fragment must survive the redirect.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../docs/", import.meta.url));

const shell = await readFile(new URL("./index.html", `file://${SITE}`), "utf8");

const fallback = shell
  .replace(
    '<script type="module" src="scripts/app.js"></script>',
    '<script type="module" src="scripts/redirect.js"></script>',
  )
  .replace(
    "<head>",
    `<head>
<meta name="robots" content="noindex">`,
  )
  // Redirect logic goes in an external module so no page carries ad-hoc
  // inline script beyond the service-worker registration.
  .replace(
    "</body>",
    `</body>`,
  )
  .replace(/<title>[^<]*<\/title>/, "<title>CRYPTOCAST — channel not found</title>");

await writeFile(new URL("./404.html", `file://${SITE}`), fallback);
console.log("✓ wrote docs/404.html");
