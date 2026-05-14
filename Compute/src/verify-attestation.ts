/**
 * TEE Attestation Verification for GhostProver.
 *
 * Parses and verifies the zerogAuth header from 0G Compute inference responses.
 * The zerogAuth envelope contains:
 *   - request_hash: SHA256 of the request body
 *   - response_hash: SHA256 of the response body
 *   - model: model identifier
 *   - provider: 0G Compute provider address
 *   - signer: TEE enclave signer address
 *   - timestamp: Unix timestamp
 *   - nonce: Random nonce for replay protection
 *   - signature: ECDSA signature over the envelope
 *
 * The signature proves the response came from a genuine TEE enclave
 * registered with the 0G Compute network.
 */
import { ethers } from 'ethers';
import * as crypto from 'node:crypto';

export interface ZerogAuthEnvelope {
  request_hash: string;
  response_hash: string;
  model: string;
  provider: string;
  signer: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export interface VerificationResult {
  valid: boolean;
  recoveredSigner: string | null;
  expectedSigner: string;
  error?: string;
}

/**
 * Parse a zerogAuth header value (base64 or raw JSON).
 */
export function parseZerogAuth(raw: string): ZerogAuthEnvelope | null {
  if (!raw) return null;

  // Try direct JSON parse first
  try {
    return JSON.parse(raw) as ZerogAuthEnvelope;
  } catch {
    // Ignore
  }

  // Try base64 decode
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded) as ZerogAuthEnvelope;
  } catch {
    // Ignore
  }

  // Try "scheme <base64>" format
  const parts = raw.split(' ');
  if (parts.length === 2) {
    try {
      const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
      return JSON.parse(decoded) as ZerogAuthEnvelope;
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Verify the ECDSA signature in a zerogAuth envelope.
 *
 * The signature is computed over keccak256(JSON.stringify(envelope_without_signature)).
 *
 * @param envelope - The parsed zerogAuth envelope
 * @returns Verification result with recovered signer address
 */
export function verifyZerogAuthSignature(envelope: ZerogAuthEnvelope): VerificationResult {
  try {
    // Reconstruct the payload that was signed (envelope without signature)
    const { signature, ...payload } = envelope;

    // Compute the digest (keccak256 of JSON payload)
    const payloadJson = JSON.stringify(payload);
    const digest = ethers.keccak256(ethers.toUtf8Bytes(payloadJson));

    // Recover the signer from the signature
    const recoveredSigner = ethers.recoverAddress(digest, signature);

    // Check if recovered signer matches the claimed signer
    const valid = recoveredSigner.toLowerCase() === envelope.signer.toLowerCase();

    return {
      valid,
      recoveredSigner,
      expectedSigner: envelope.signer,
      error: valid ? undefined : 'Recovered signer does not match claimed signer',
    };
  } catch (error) {
    return {
      valid: false,
      recoveredSigner: null,
      expectedSigner: envelope.signer,
      error: `Signature verification failed: ${error}`,
    };
  }
}

/**
 * Verify that the request_hash in the envelope matches the actual request body.
 *
 * @param envelope - The parsed zerogAuth envelope
 * @param requestBody - The original request body (string or object)
 * @returns true if the hash matches
 */
export function verifyRequestHash(
  envelope: ZerogAuthEnvelope,
  requestBody: string | object
): boolean {
  const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
  const computed = '0x' + crypto.createHash('sha256').update(bodyStr).digest('hex');
  return computed.toLowerCase() === envelope.request_hash.toLowerCase();
}

/**
 * Verify that the response_hash in the envelope matches the actual response body.
 *
 * @param envelope - The parsed zerogAuth envelope
 * @param responseBody - The response body (string or object)
 * @returns true if the hash matches
 */
export function verifyResponseHash(
  envelope: ZerogAuthEnvelope,
  responseBody: string | object
): boolean {
  const bodyStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
  const computed = '0x' + crypto.createHash('sha256').update(bodyStr).digest('hex');
  return computed.toLowerCase() === envelope.response_hash.toLowerCase();
}

/**
 * Full attestation verification: signature + request/response hash binding.
 */
export interface FullVerificationResult extends VerificationResult {
  requestHashValid: boolean;
  responseHashValid: boolean;
}

export function verifyFullAttestation(
  envelope: ZerogAuthEnvelope,
  requestBody: string | object,
  responseBody: string | object
): FullVerificationResult {
  const sigResult = verifyZerogAuthSignature(envelope);
  const requestHashValid = verifyRequestHash(envelope, requestBody);
  const responseHashValid = verifyResponseHash(envelope, responseBody);

  return {
    ...sigResult,
    valid: sigResult.valid && requestHashValid && responseHashValid,
    requestHashValid,
    responseHashValid,
    error: sigResult.error ??
      (!requestHashValid ? 'Request hash mismatch' : undefined) ??
      (!responseHashValid ? 'Response hash mismatch' : undefined),
  };
}

/**
 * Verify attestation from an inference log file.
 */
export function verifyInferenceLog(log: {
  request?: { body?: unknown };
  response?: { body?: unknown };
  zerogAuth?: { parsed?: ZerogAuthEnvelope };
}): FullVerificationResult | null {
  const envelope = log.zerogAuth?.parsed;
  if (!envelope) {
    return null;
  }

  const requestBody = log.request?.body;
  const responseBody = log.response?.body;

  if (!requestBody || !responseBody) {
    return {
      valid: false,
      recoveredSigner: null,
      expectedSigner: envelope.signer,
      requestHashValid: false,
      responseHashValid: false,
      error: 'Missing request or response body in log',
    };
  }

  return verifyFullAttestation(envelope, requestBody as string | object, responseBody as string | object);
}
