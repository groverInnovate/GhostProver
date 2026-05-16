import { copyFileSync, mkdirSync } from "node:fs";
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
