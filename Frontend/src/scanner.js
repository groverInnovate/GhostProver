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
  const patternTypes = pattern.types ?? pattern.pattern_types ?? [];
  const patternValues = pattern.values ?? pattern.pattern_values ?? [];
  patternTypes.forEach((value, index) => {
    types[index] = value;
  });
  patternValues.forEach((value, index) => {
    values[index] = value;
  });
  return { types, values };
}

export function scanSinglePattern(promptBytes, pattern) {
  const { types, values } = getPatternArrays(pattern);
  const targetLen = pattern.len ?? pattern.target_len;

  for (let offset = 0; offset <= promptBytes.length - targetLen; offset += 1) {
    let matched = true;
    for (let j = 0; j < targetLen; j += 1) {
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
  const promptBytes = bytesOf(prompt);
  if (promptBytes.length > 512) {
    throw new Error(`Prompt exceeds GhostProver's 512-byte circuit limit: ${promptBytes.length} bytes`);
  }
  const preset = REGISTRY.presets[presetId];
  const results = preset.patterns.map((patternId) => {
    const pattern = REGISTRY.patterns[patternId];
    const scan = scanSinglePattern(promptBytes, pattern);
    return {
      id: patternId,
      name: pattern.name,
      desc: pattern.desc ?? pattern.description,
      regulation: pattern.regulation,
      len: pattern.len ?? pattern.target_len,
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
    modelId: "qwen3.6-plus",
    storageRoot: `0x${seed.slice(32, 96)}`,
    registry: "0x9595BD4e6b868C64001904EeF76d838D78604B6e",
    chain: "0G Mainnet",
    submittedAt: new Date().toISOString(),
  };
}
