/**
 * Dump the provider's TEE attestation object shape via verifyService().
 * Writes per-step reports into ./reports and prints the structured result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { initBroker, pickService } from './broker.js';

async function main() {
  const { broker } = await initBroker();
  const service = await pickService(broker);
  const providerAddress: string = service.provider;
  console.log('[service]', { provider: providerAddress, model: service.model });

  const outDir = path.resolve('reports');
  fs.mkdirSync(outDir, { recursive: true });

  // In @0glabs/0g-serving-broker 0.4.x verifyService only returns a boolean —
  // it fetches the raw TEE quote, checks signer match on-chain, and caches
  // the signer. To actually inspect the attestation object shape we also read
  // the provider's signer address + service metadata the SDK caches after
  // this call completes.
  const ok = await broker.inference.verifyService(providerAddress);
  console.log('[verifyService] signer+quote check =', ok);

  const meta = await broker.inference.getServiceMetadata(providerAddress);
  console.log('\n=== service metadata ===');
  console.dir(meta, { depth: null });

  const result = {
    provider: providerAddress,
    model: service.model,
    serviceType: service.serviceType,
    url: service.url,
    verifiability: service.verifiability,
    additionalInfo: service.additionalInfo,
    verifyServiceOk: ok,
    serviceMetadata: meta,
  };

  fs.writeFileSync(
    path.join(outDir, `attestation-${providerAddress}.json`),
    JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
  console.log(`[saved] reports/attestation-${providerAddress}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
