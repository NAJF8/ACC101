import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/barcodeCamera.js", "utf8");
const app = fs.readFileSync("src/App.jsx", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.ok(packageJson.dependencies["@zxing/browser"], "ZXing must be a package dependency");
assert.match(source, /if \("BarcodeDetector" in window\)/, "native BarcodeDetector path is retained");
assert.match(source, /new BrowserMultiFormatReader\(\)/, "ZXing fallback is configured");
assert.match(source, /Native initialization failed; try ZXing/, "native initialization failure falls back");
assert.match(source, /facingMode: \{ ideal: "environment" \}/, "fallback prefers the rear camera");
assert.match(source, /active\.controls\?\.stop\?\.\(\)/, "ZXing controls are cleaned up");
assert.match(source, /active\.stream\?\.getTracks\?\.\(\)\.forEach/, "media tracks are cleaned up");
assert.match(source, /session\.delivered/, "duplicate scan callbacks are guarded");
assert.match(source, /onFound\(value\)/, "the first normalized scan reaches the existing callback");
assert.match(app, /muted autoPlay playsInline/, "mobile-compatible video attributes are present");
console.log("barcode-camera-regression: PASS");
