import { REGISTRY } from "./registry.js";

const encoder = new TextEncoder();

export function bytesOf(value) {
  return encoder.encode(value);
}

export function matchesClass(byte, classType, classValue = 0) {
  switch (classType) {
    case 0:
      return byte === classValue;
    case 1:
      return byte >= 48 && byte <= 57;
    case 2:
      return byte >= 97 && byte <= 122;
    case 3:
      return byte >= 65 && byte <= 90;
    case 4:
      return (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    case 5:
      return (
        (byte >= 48 && byte <= 57) ||
        (byte >= 65 && byte <= 90) ||
        (byte >= 97 && byte <= 122)
      );
    case 6:
      return (
        (byte >= 48 && byte <= 57) ||
        (byte >= 65 && byte <= 70) ||
        (byte >= 97 && byte <= 102)
      );
    case 7:
      return (
        (byte >= 48 && byte <= 57) ||
        (byte >= 65 && byte <= 90) ||
        (byte >= 97 && byte <= 122) ||
        byte === 43 ||
        byte === 47 ||
        byte === 61
      );
    case 8:
      return true;
    default:
      return false;
  }
}

function getPatternArrays(pattern) {
  const types = new Array(32).fill(0);
  const values = new Array(32).fill(0);
  pattern.types.forEach((value, index) => {
    types[index] = value;
  });
  pattern.values?.forEach((value, index) => {
    values[index] = value;
  });
  return { types, values };
}

export function scanSinglePattern(promptBytes, pattern) {
  const { types, values } = getPatternArrays(pattern);

  for (let offset = 0; offset <= promptBytes.length - pattern.len; offset += 1) {
    let matched = true;
    for (let j = 0; j < pattern.len; j += 1) {
      if (!matchesClass(promptBytes[offset + j], types[j], values[j])) {
        matched = false;
        break;
      }
    }
    if (matched) return { matched: true, offset };
  }

  return { matched: false, offset: -1 };
}

export function scanPreset(prompt, presetId) {
  const promptBytes = bytesOf(prompt).slice(0, 512);
  const preset = REGISTRY.presets[presetId];
  const results = preset.patterns.map((patternId) => {
    const pattern = REGISTRY.patterns[patternId];
    const scan = scanSinglePattern(promptBytes, pattern);
    return {
      id: patternId,
      name: pattern.name,
      desc: pattern.desc,
      regulation: pattern.regulation,
      len: pattern.len,
      ...scan,
    };
  });

  return {
    presetId,
    presetName: preset.name,
    byteLength: promptBytes.length,
    clean: results.every((result) => !result.matched),
    results,
  };
}

export async function digestHex(value) {
  const hash = await crypto.subtle.digest("SHA-256", bytesOf(value));
  return `0x${Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function makeDemoReceipt(scan, commitment) {
  const seed = `${commitment.replace(/^0x/, "")}${Date.now().toString(16)}`.padEnd(96, "8");
  return {
    commitment,
    provider: "0G Compute TEE",
    providerAddress: `0x${seed.slice(0, 40)}`,
    modelId: "qwen-2.5-7b-instruct",
    storageRoot: `0x${seed.slice(32, 96)}`,
    registry: "0x7d2b...a091",
    chain: "0G Galileo Testnet",
    submittedAt: new Date().toISOString(),
  };
}
