import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const assets = [
  ["src/registry/patterns.json", "dist/registry/patterns.json"],
];

for (const [from, to] of assets) {
  const target = resolve(to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(from), target);
  console.log(`[build] copied ${from} -> ${to}`);
}

const registry = JSON.parse(readFileSync(resolve("src/registry/patterns.json"), "utf8"));
const classLabels = {
  0: "exact",
  1: "digit",
  2: "lower",
  3: "upper",
  4: "alpha",
  5: "alnum",
  6: "hex",
  7: "base64",
  8: "any",
};
const frontendRegistryPath = resolve("Frontend/src/registry.js");
writeFileSync(
  frontendRegistryPath,
  [
    "export const CLASS_LABELS = " + JSON.stringify(classLabels, null, 2) + ";",
    "",
    "export const REGISTRY = " + JSON.stringify(registry, null, 2) + ";",
    "",
  ].join("\n"),
);
console.log("[build] wrote src/registry/patterns.json -> Frontend/src/registry.js");
