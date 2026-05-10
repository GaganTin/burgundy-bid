// Test Mistral AI OCR pipeline (server-side logic) directly with local wine images.
// Usage: node scripts/test_mistral_ocr.js [image1.png] [image2.png] ...
// Defaults to 172112.png and 172312.png in the project root.
//
// Requires MISTRAL_API_KEY in environment (or .env at project root).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  console.error("Error: MISTRAL_API_KEY not set in .env");
  process.exit(1);
}

const OCR_MODEL   = "mistral-ocr-latest";
const PARSE_MODEL = "ministral-8b-latest";

function estimateCostUsd({ ocrPages = 0, parseInputTokens = 0, parseOutputTokens = 0 }) {
  return (
    ocrPages * 0.001 +
    (parseInputTokens  / 1_000_000) * 0.10 +
    (parseOutputTokens / 1_000_000) * 0.30
  ).toFixed(6);
}

async function ocrImage(imagePath) {
  const ext  = path.extname(imagePath).toLowerCase().slice(1);
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  const mimeType = mime[ext] || "image/jpeg";
  const base64   = fs.readFileSync(imagePath).toString("base64");
  const hash     = createHash("sha256").update(base64).digest("hex");

  console.log(`  image_hash: ${hash.slice(0, 16)}…`);

  const r = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model: OCR_MODEL,
      document: { type: "image_url", image_url: `data:${mimeType};base64,${base64}` },
      include_image_base64: false,
    }),
  });

  const body = await r.text();
  if (!r.ok) throw new Error(`OCR ${r.status}: ${body.slice(0, 200)}`);
  const d = JSON.parse(body);
  return {
    text:     (d.pages || []).map(p => p.markdown).join("\n\n"),
    pages:    d.usage_info?.pages_processed || 1,
    docBytes: d.usage_info?.doc_size_bytes  || 0,
  };
}

async function parseWines(ocrText) {
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${MISTRAL_API_KEY}` },
    body: JSON.stringify({
      model: PARSE_MODEL,
      messages: [{
        role: "user",
        content:
          `From the following wine label or menu text, extract all wine entries.\n` +
          `Return a JSON object with a "wines" array. Each element must have:\n` +
          `- "name": producer and wine name (no vintage year, no bottle size)\n` +
          `- "vintage": 4-digit year string (e.g. "2019"), or "" if not present\n` +
          `- "size": bottle size (e.g. "750ml", "1.5L", "Magnum"), or "" if not visible\n\n` +
          `Text:\n${ocrText}\n\nReturn ONLY valid JSON.`,
      }],
      response_format: { type: "json_object" },
    }),
  });

  const body = await r.text();
  if (!r.ok) throw new Error(`Parse ${r.status}: ${body.slice(0, 200)}`);
  const d = JSON.parse(body);
  const wines = JSON.parse(d.choices[0].message.content).wines || [];
  return {
    wines:       wines.filter(w => w.name?.trim()),
    inputTokens: d.usage?.prompt_tokens     || 0,
    outputTokens:d.usage?.completion_tokens || 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const images = args.length > 0
    ? args.map(a => path.resolve(a))
    : ["172112.png", "172312.png"].map(f => path.join(PROJECT_ROOT, f));

  for (const imgPath of images) {
    if (!fs.existsSync(imgPath)) {
      console.error(`[SKIP] not found: ${imgPath}`);
      continue;
    }

    console.log(`\n=== ${path.basename(imgPath)} ===`);
    try {
      const { text, pages, docBytes } = await ocrImage(imgPath);
      console.log(`  OCR: ${pages} page(s), ${(docBytes / 1024).toFixed(1)} KB`);
      console.log(`  Raw text:\n${text.trim()}\n`);

      const { wines, inputTokens, outputTokens } = await parseWines(text);
      const cost = estimateCostUsd({ ocrPages: pages, parseInputTokens: inputTokens, parseOutputTokens: outputTokens });
      console.log(`  Parse: in=${inputTokens} out=${outputTokens} est_cost=$${cost}`);
      console.log(`  Wines (${wines.length}):`);
      console.log(JSON.stringify(wines, null, 2));
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }

    // Pause between images to stay within rate limits
    await new Promise(r => setTimeout(r, 2000));
  }
}

main();
