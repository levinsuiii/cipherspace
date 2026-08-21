import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const distDirectory = resolve(scriptDirectory, "../dist");

async function readDist(path) {
  try {
    return await readFile(resolve(distDirectory, path));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing dist/${path}. Run the frontend build before this check.`);
    }
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(buffer.subarray(0, 8).equals(signature), "An application icon is not a valid PNG file.");
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) };
}

const manifest = JSON.parse((await readDist("manifest.webmanifest")).toString("utf8"));
assert(typeof manifest.name === "string" && manifest.name.length > 0, "Manifest name is missing.");
assert(typeof manifest.short_name === "string" && manifest.short_name.length > 0, "Manifest short_name is missing.");
assert(manifest.start_url === "/", "Manifest start_url must be root-relative.");
assert(manifest.scope === "/", "Manifest scope must cover the application.");
assert(manifest.display === "standalone", "Manifest display must be standalone.");
assert(/^#[0-9a-f]{6}$/i.test(manifest.theme_color), "Manifest theme_color is invalid.");
assert(/^#[0-9a-f]{6}$/i.test(manifest.background_color), "Manifest background_color is invalid.");
assert(Array.isArray(manifest.icons), "Manifest icons are missing.");

for (const requiredSize of [192, 512]) {
  const icon = manifest.icons.find((candidate) =>
    candidate.type === "image/png" && candidate.sizes === `${requiredSize}x${requiredSize}` &&
    String(candidate.purpose ?? "any").split(/\s+/).includes("any")
  );
  assert(icon, `Manifest is missing an any-purpose ${requiredSize}x${requiredSize} PNG icon.`);
  const buffer = await readDist(icon.src.replace(/^\//, ""));
  assert(
    JSON.stringify(pngDimensions(buffer)) === JSON.stringify({ height: requiredSize, width: requiredSize }),
    `${icon.src} does not have the declared dimensions.`
  );
}

const maskable = manifest.icons.find((icon) =>
  String(icon.purpose ?? "").split(/\s+/).includes("maskable")
);
assert(maskable, "Manifest is missing a maskable application icon.");
await readDist(maskable.src.replace(/^\//, ""));

const index = (await readDist("index.html")).toString("utf8");
assert(index.includes('rel="manifest"'), "Built index.html does not reference the manifest.");
assert(index.includes('name="theme-color"'), "Built index.html does not declare a theme color.");
assert(index.includes('rel="apple-touch-icon"'), "Built index.html does not declare an iOS icon.");
const serviceWorker = (await readDist("service-worker.js")).toString("utf8");
assert(
  serviceWorker.includes('url.pathname.startsWith("/api/")') &&
    serviceWorker.includes('url.pathname === "/health"'),
  "Service worker must explicitly bypass API and health responses."
);
await readDist("offline.html");
await readDist("offline.css");
await stat(resolve(distDirectory, "assets"));

console.log("PWA installability assets passed static validation.");
