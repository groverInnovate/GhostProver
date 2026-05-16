/**
 * 0G Storage integration for GhostProver.
 *
 * Uploads the full audit bundle (inference log + attestation) to 0G Storage
 * and returns the Merkle root hash for on-chain anchoring.
 *
 * The audit bundle contains:
 *   - prompt (private, but auditor can verify commitment)
 *   - response (AI output)
 *   - zerogAuth attestation (TEE signature binding request ↔ response)
 *   - ZK proof public inputs (commitment, target_hash)
 *   - timestamp
 *
 * Usage:
 *   const { rootHash, txHash } = await uploadAuditBundle(bundleJson);
 */
import 'dotenv/config';
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';

const INDEXER_URL_TESTNET = 'https://indexer-storage-testnet-standard.0g.ai';
const INDEXER_URL_MAINNET = 'https://indexer-storage-turbo.0g.ai';
const ZG_RPC_URL = process.env.ZG_RPC_URL ?? 'https://evmrpc.0g.ai';

function getStorageIndexerUrl(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.ZG_INDEXER_URL) return process.env.ZG_INDEXER_URL;
  const network = process.env.ZG_NETWORK?.toLowerCase();
  const mainnetRpc = ZG_RPC_URL.includes('evmrpc.0g.ai') && !ZG_RPC_URL.includes('testnet');
  return network === 'mainnet' || mainnetRpc ? INDEXER_URL_MAINNET : INDEXER_URL_TESTNET;
}

export interface AuditBundle {
  /** Original inference log (from samples/inference-*.log.json) */
  inferenceLog: Record<string, unknown>;
  /** ZK proof public inputs */
  publicInputs: {
    commitment: string;
    targetHash: string;
  };
  /** Timestamp of bundle creation */
  createdAt: string;
  /** Optional: raw proof bytes as hex (for full audit trail) */
  proofHex?: string;
  /** Optional: batch proof bytes as hex strings */
  proofHexes?: string[];
  /** Optional: batch target hashes */
  targetHashes?: string[];
}

export interface UploadResult {
  /** 0G Storage Merkle root hash */
  rootHash: string;
  /** Transaction hash on 0G Chain */
  txHash: string;
  /** Transaction sequence number */
  txSeq: number;
  /** Size of uploaded data in bytes */
  sizeBytes: number;
}

/**
 * Upload an audit bundle to 0G Storage.
 *
 * @param bundle - The audit bundle to upload
 * @param privateKey - Wallet private key for signing the upload tx
 * @param indexerUrl - Optional: override the indexer URL
 * @returns Upload result with rootHash for on-chain anchoring
 */
export async function uploadAuditBundle(
  bundle: AuditBundle,
  privateKey?: string,
  indexerUrl?: string
): Promise<UploadResult> {
  const pk = privateKey ?? process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error('PRIVATE_KEY required for 0G Storage upload');
  }

  const provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
  const signer = new ethers.Wallet(pk, provider);
  const resolvedIndexerUrl = getStorageIndexerUrl(indexerUrl);
  const indexer = new Indexer(resolvedIndexerUrl);

  // Serialize bundle to JSON bytes
  const bundleJson = JSON.stringify(bundle, null, 2);
  const data = new TextEncoder().encode(bundleJson);
  const memData = new MemData(data);

  console.log(`[storage] uploading ${data.length} bytes to 0G Storage...`);
  console.log(`[storage] indexer: ${resolvedIndexerUrl}`);
  console.log(`[storage] rpc: ${ZG_RPC_URL}`);

  // Compute Merkle tree (required before upload)
  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr !== null) {
    throw new Error(`Merkle tree error: ${treeErr}`);
  }
  const rootHash = tree!.rootHash();
  console.log(`[storage] root hash: ${rootHash}`);

  // Upload to 0G Storage
  const [tx, uploadErr] = await indexer.upload(memData, ZG_RPC_URL, signer);
  if (uploadErr !== null) {
    throw new Error(`Upload error: ${uploadErr}`);
  }

  // Handle single file response (our bundles are always <4GB)
  if ('rootHash' in tx) {
    console.log(`[storage] upload success: txHash=${tx.txHash}, rootHash=${tx.rootHash}`);
    return {
      rootHash: tx.rootHash,
      txHash: tx.txHash,
      txSeq: tx.txSeq,
      sizeBytes: data.length,
    };
  } else {
    // Fragmented upload (shouldn't happen for audit bundles)
    console.log(`[storage] fragmented upload: ${tx.rootHashes.length} fragments`);
    return {
      rootHash: tx.rootHashes[0],
      txHash: tx.txHashes[0],
      txSeq: tx.txSeqs[0],
      sizeBytes: data.length,
    };
  }
}

/**
 * Download an audit bundle from 0G Storage.
 *
 * @param rootHash - The Merkle root hash from uploadAuditBundle
 * @param indexerUrl - Optional: override the indexer URL
 * @returns The parsed audit bundle
 */
export async function downloadAuditBundle(
  rootHash: string,
  indexerUrl?: string
): Promise<AuditBundle> {
  const indexer = new Indexer(getStorageIndexerUrl(indexerUrl));

  console.log(`[storage] downloading ${rootHash}...`);
  const [blob, err] = await indexer.downloadToBlob(rootHash);
  if (err !== null) {
    throw new Error(`Download error: ${err}`);
  }

  const text = await blob.text();
  return JSON.parse(text) as AuditBundle;
}

/**
 * Compute the Merkle root hash of an audit bundle without uploading.
 * Useful for pre-computing the storageRoot before the actual upload.
 */
export async function computeStorageRoot(bundle: AuditBundle): Promise<string> {
  const bundleJson = JSON.stringify(bundle, null, 2);
  const data = new TextEncoder().encode(bundleJson);
  const memData = new MemData(data);

  const [tree, err] = await memData.merkleTree();
  if (err !== null) {
    throw new Error(`Merkle tree error: ${err}`);
  }
  const root = tree!.rootHash();
  if (root === null) {
    throw new Error('Merkle tree root is null');
  }
  return root;
}

// CLI entry point for testing
if (import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''))) {
  const testBundle: AuditBundle = {
    inferenceLog: {
      prompt: 'Test prompt for 0G Storage upload',
      response: { content: 'Test response' },
      zerogAuth: { parsed: { request_hash: '0x123', response_hash: '0x456' } },
    },
    publicInputs: {
      commitment: '0x2a7c9afe09311823202d1411a5b006b9ce935937416bfa7d648905c3b7a0b884',
      targetHash: '0x19c70db02accdb8349beeda4c691bd93e3ea0226d47e97f8c2041d3a70be186c',
    },
    createdAt: new Date().toISOString(),
  };

  console.log('[storage] test mode — computing root hash only (no upload)');
  computeStorageRoot(testBundle).then((root) => {
    console.log(`[storage] computed root: ${root}`);
  });
}
