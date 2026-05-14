/**
 * Mock inference — emits a samples/inference-<ts>.log.json with the EXACT
 * same shape that the real 0G broker pipeline writes in `inference.ts`, so
 * the Circuit ↔ Compute bridge (and every downstream consumer) doesn't care
 * whether the data came from a live testnet TEE or this script.
 *
 * Why this exists:
 *   - Testnet has 0 live providers right now (`listService()` returns []).
 *   - The bundled SDK v0.4.4 has hardcoded testnet contract addresses, so
 *     we cannot switch to mainnet without forking the SDK.
 *   - We still need to unblock Phase 2 (Noir Prover.toml generation, on-chain
 *     receipt submission). The schema is the contract — mock matches it.
 *
 * When real inference comes back, `npm run inference` will overwrite this
 * file with identical-shape output and the bridge keeps working unchanged.
 *
 * Usage:
 *   npm run inference:mock                          # uses default prompt
 *   npm run inference:mock -- "your custom prompt"
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const PROMPT = process.argv.slice(2).join(' ') ||
  'What are the treatment options for a patient with high blood pressure and diabetes?';

// Stable mock provider / model — matches what testnet was serving before it went down.
const MOCK_PROVIDER = '0xf07240Efa67755B5311bc75784a061eDB47165Dd';
const MOCK_MODEL = 'gpt-oss-20b';
const MOCK_ENDPOINT = 'https://mock-tee-provider.0g.local/v1';

function sha256Hex(s: string | Buffer): string {
  return '0x' + crypto.createHash('sha256').update(s).digest('hex');
}

function main() {
  const requestBody = {
    model: MOCK_MODEL,
    messages: [{ role: 'user', content: PROMPT }],
  };
  const bodyStr = JSON.stringify(requestBody);

  // Deterministic mock signer derived from a fixed seed so repeated runs
  // produce the same provider signer address — useful for snapshot tests.
  const mockSignerWallet = new ethers.Wallet(
    '0x' + crypto.createHash('sha256').update('ghostprover-mock-tee-signer').digest('hex'),
  );

  const requestHash = sha256Hex(bodyStr);
  const responseBody = {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: MOCK_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content:
            'For high blood pressure and diabetes, common treatments include lifestyle modifications ' +
            '(diet, exercise, weight management), ACE inhibitors or ARBs, metformin or other oral ' +
            'hypoglycemics, and regular monitoring of blood pressure and HbA1c.',
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 24, completion_tokens: 58, total_tokens: 82 },
  };
  const responseHash = sha256Hex(JSON.stringify(responseBody));

  // zerogAuth envelope: the enclave-signed commitment binding request ↔ response.
  // Shape mirrors the live 0G TEE attestation header (see 0g-serving-user-broker
  // src.ts — `processResponse` checks signer + hashes).
  const zerogAuthPayload = {
    request_hash: requestHash,
    response_hash: responseHash,
    model: MOCK_MODEL,
    provider: MOCK_PROVIDER,
    signer: mockSignerWallet.address,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const payloadDigest = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(zerogAuthPayload)),
  );
  const signature = mockSignerWallet.signingKey.sign(payloadDigest).serialized;
  const zerogAuthObject = { ...zerogAuthPayload, signature };
  const zerogAuthB64 = Buffer.from(JSON.stringify(zerogAuthObject)).toString('base64');

  const requestHeaders = ['zerogauth', 'address', 'fee', 'nonce', 'signature'];
  const responseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'zg-res-key': responseBody.id,
    zerogauth: zerogAuthB64,
  };

  const out = {
    ts: new Date().toISOString(),
    mock: true,
    mockReason:
      '0G testnet had no live inference providers at capture time and SDK v0.4.4 does not yet ' +
      'support mainnet contract addresses. Replace by re-running `npm run inference` once a live ' +
      'provider is available — the JSON shape is identical.',
    prompt: PROMPT,
    provider: MOCK_PROVIDER,
    model: MOCK_MODEL,
    endpoint: MOCK_ENDPOINT,
    elapsedMs: 1234,
    request: { headers: requestHeaders, body: requestBody },
    response: { status: 200, headers: responseHeaders, body: responseBody },
    zerogAuth: { raw: zerogAuthB64, parsed: zerogAuthObject },
    chatID: responseBody.id,
    teeVerified: true,
  };

  const dir = path.resolve('samples');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `inference-${Date.now()}.log.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[mock] wrote ${file}`);
  console.log(`[mock] prompt:    ${PROMPT}`);
  console.log(`[mock] provider:  ${MOCK_PROVIDER}`);
  console.log(`[mock] signer:    ${mockSignerWallet.address}`);
  console.log(`[mock] req_hash:  ${requestHash}`);
  console.log(`[mock] res_hash:  ${responseHash}`);
}

main();
