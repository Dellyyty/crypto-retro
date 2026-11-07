#!/usr/bin/env node
/**
 * Repo invariants. Runs in CI before deploy; fails loudly.
 *
 *  1. No TODO/FIXME/placeholder markers in shipped code.
 *  2. Every local href/src referenced by an HTML file resolves on disk.
 *  3. No obvious secrets (long hex/base64 tokens, API-key params).
 *  4. Every script referenced is an ES module.
 *  5. Required metadata present on index.html.
 */

import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SITE = join(ROOT, "docs");
const failures = [];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = await walk(SITE);
const codeFiles = files.filter((f) => [".html", ".js", ".css", ".mjs"].includes(extname(f)));
const htmlFiles = files.filter((f) => extname(f) === ".html");

// 1 -------------------------------------------------------------------
for (const file of codeFiles) {
  const text = await readFile(file, "utf8");
  const hits = text.match(/\b(TODO|FIXME|XXX|PLACEHOLDER|lorem ipsum)\b/gi);
  if (hits) failures.push(`${file}: placeholder marker ${hits[0]}`);
}

// 2 -------------------------------------------------------------------
for (const file of htmlFiles) {
  const text = await readFile(file, "utf8");
  const refs = [...text.matchAll(/(?:href|src)="([^"#][^"]*)"/g)]
    .map((m) => m[1])
    .filter((r) => !/^(https?:|data:|mailto:)/.test(r));
  for (const ref of refs) {
    const target = resolve(join(file, "..", ref.split("?")[0]));
    const found = files.includes(target);
    if (!found) failures.push(`${file}: missing asset ${ref}`);
  }
}

// 3 -------------------------------------------------------------------
const secretPatterns = [
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
];
for (const file of codeFiles) {
  const text = await readFile(file, "utf8");
  for (const pattern of secretPatterns) {
    const hit = text.match(pattern);
    if (hit) failures.push(`${file}: possible secret ${hit[0].slice(0, 12)}…`);
  }
}

// 4 ---- script discipline ----------------------------------------------
// External scripts must be ES modules. Inline scripts are allowed only for the
// service-worker registration, which must run before modules and has no imports.
// Each inline block is validated on its own body, not on the whole file.
const INLINE_ALLOWED = /^\s*if \("serviceWorker" in navigator[\s\S]*navigator\.serviceWorker\.register\("sw\.js"\)\.catch\(\(\) => \{\}\);[\s\S]*\}\s*$/;

for (const file of htmlFiles) {
  const text = await readFile(file, "utf8");
  for (const m of text.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const [, attrs, body] = m;
    const isExternal = /\bsrc=/.test(attrs);
    if (isExternal) {
      if (!attrs.includes('type="module"')) {
        failures.push(`${file}: classic external script ${attrs.trim()} — use type="module"`);
      }
      continue;
    }
    if (body.trim() && !INLINE_ALLOWED.test(body)) {
      failures.push(`${file}: inline script body is not the service-worker registration`);
    }
  }
}

// 5 -------------------------------------------------------------------
const index = await readFile(join(SITE, "index.html"), "utf8");
for (const needle of ['property="og:image"', 'name="twitter:card"', 'rel="manifest"', 'type="module"', 'lang="en"']) {
  if (!index.includes(needle)) failures.push(`index.html: missing ${needle}`);
}

// 6 ---- CSS structural validity ---------------------------------------
// A stray token outside a rule silently swallows the rest of the stylesheet
// in some browsers and promotes later rules to global scope. At-rules are
// the only legal top-level statements, so any other ';' is a broken block.
for (const file of files.filter((f) => extname(f) === ".css")) {
  const text = await readFile(file, "utf8");
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let line = 1;
  let buf = "";
  let broke = false;
  for (let i = 0; i < stripped.length && !broke; i++) {
    const ch = stripped[i];
    if (ch === "\n") line++;
    if (ch === "{") {
      if (depth === 0 && !buf.trim()) failures.push(`${file}:${line} block opened with no selector`);
      depth++;
      buf = "";
    } else if (ch === "}") {
      depth--;
      if (depth < 0) { failures.push(`${file}:${line} unbalanced }`); broke = true; }
      buf = "";
    } else if (ch === ";" && depth === 0) {
      const stmt = buf.trim();
      if (stmt && !stmt.startsWith("@")) {
        failures.push(`${file}:${line} declaration outside a rule: "${stmt.slice(0, 48)}"`);
        broke = true;
      }
      buf = "";
    } else if (depth === 0) {
      buf += ch;
    }
  }
  if (depth !== 0) failures.push(`${file}: ${depth} unclosed block(s)`);
}

// 7 ---- balanced HTML tags for block elements -------------------------
const BLOCK = ["section", "article", "div", "main", "header", "footer", "table", "tbody", "thead", "dl", "ol", "ul"];
for (const file of htmlFiles) {
  const text = await readFile(file, "utf8");
  for (const tag of BLOCK) {
    const opens = (text.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
    const closes = (text.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
    if (opens !== closes) failures.push(`${file}: <${tag}> ${opens} open vs ${closes} close`);
  }
}

// ---------------------------------------------------------------------
if (failures.length) {
  console.error(`✗ ${failures.length} check(s) failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ checks passed (${files.length} files, ${htmlFiles.length} pages)`);
