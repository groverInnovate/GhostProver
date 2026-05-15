import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export interface Ctx {
  broker: any;
  wallet: ethers.Wallet;
  provider: ethers.JsonRpcProvider;
  sdk: LoadedComputeSdk;
}

export interface BrokerConfig {
  rpc: string;
  network: 'mainnet' | 'testnet' | 'local' | 'custom';
  modelFilter: string;
  pinnedProvider: string | null;
  contracts: {
    ledger: string | null;
    inference: string | null;
    fineTuning: string | null;
  };
  initialDeposit: number;
  providerTransferAmount: string | null;
}

interface LoadedComputeSdk {
  packageName: string;
  packageVersion: string;
  createZGComputeNetworkBroker: (...args: any[]) => Promise<any>;
}

const DEFAULT_RPC = 'https://evmrpc.0g.ai';

function loadComputeSdk(): LoadedComputeSdk {
  const candidates = [
    '@0gfoundation/0g-compute-ts-sdk',
    '@0glabs/0g-serving-broker',
  ];

  for (const packageName of candidates) {
    try {
      const sdk = require(packageName);
      if (typeof sdk.createZGComputeNetworkBroker !== 'function') {
        continue;
      }
      return {
        packageName,
        packageVersion: readPackageVersion(packageName),
        createZGComputeNetworkBroker: sdk.createZGComputeNetworkBroker,
      };
    } catch {
      // Try the next SDK package.
    }
  }

  throw new Error(
    'No 0G Compute TypeScript SDK found. Install @0gfoundation/0g-compute-ts-sdk ' +
      'or @0glabs/0g-serving-broker in Compute/.',
  );
}

function readPackageVersion(packageName: string): string {
  try {
    let dir = path.dirname(require.resolve(packageName));
    while (dir !== path.dirname(dir)) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (pkg.name === packageName) return String(pkg.version ?? 'unknown');
      }
      dir = path.dirname(dir);
    }
  } catch {
    // Best-effort diagnostic only.
  }
  return 'unknown';
}

function envAddress(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function detectNetwork(rpc: string): BrokerConfig['network'] {
  const configured = process.env.ZG_NETWORK?.trim().toLowerCase();
  if (configured === 'mainnet' || configured === 'testnet' || configured === 'local' || configured === 'custom') {
    return configured;
  }
  if (rpc.includes('evmrpc.0g.ai') && !rpc.includes('testnet')) return 'mainnet';
  if (rpc.includes('evmrpc-testnet.0g.ai')) return 'testnet';
  if (rpc.includes('127.0.0.1') || rpc.includes('localhost')) return 'local';
  return 'custom';
}

function parseTransferAmount(): string | null {
  const raw = process.env.PROVIDER_TRANSFER_AMOUNT?.trim();
  if (!raw || raw === '0') return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('PROVIDER_TRANSFER_AMOUNT must be a non-negative 0G amount.');
  }
  return raw;
}

function assertContractConfig(config: BrokerConfig, sdk: LoadedComputeSdk) {
  const { ledger, inference, fineTuning } = config.contracts;
  const provided = [ledger, inference, fineTuning].filter(Boolean).length;
  if (provided > 0 && provided < 3) {
    throw new Error(
      'Provide all three 0G Compute contract env vars together: ' +
        'ZG_LEDGER_CA, ZG_INFERENCE_CA, and ZG_FINE_TUNING_CA.',
    );
  }

  const usingLegacyHardcodedSdk =
    sdk.packageName === '@0glabs/0g-serving-broker' &&
    /^0\.[0-4]\./.test(sdk.packageVersion);

  if (config.network === 'mainnet' && provided === 0 && usingLegacyHardcodedSdk) {
    throw new Error(
      `Mainnet selected (${config.rpc}) but ${sdk.packageName}@${sdk.packageVersion} ` +
        'uses hardcoded testnet contract addresses by default. Set ZG_LEDGER_CA, ' +
        'ZG_INFERENCE_CA, and ZG_FINE_TUNING_CA, or upgrade the Compute SDK.',
    );
  }
}

export async function initBroker(): Promise<Ctx> {
  const config = getBrokerConfig();
  const sdk = loadComputeSdk();
  assertContractConfig(config, sdk);

  const pk = process.env.PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('PRIVATE_KEY missing or invalid in .env (must be a 0x-prefixed 32-byte hex private key).');
  }
  const provider = new ethers.JsonRpcProvider(config.rpc);
  const wallet = new ethers.Wallet(pk, provider);

  const { ledger, inference, fineTuning } = config.contracts;
  const broker =
    ledger && inference && fineTuning
      ? await sdk.createZGComputeNetworkBroker(wallet, ledger, inference, fineTuning)
      : await sdk.createZGComputeNetworkBroker(wallet);

  return { broker, wallet, provider, sdk };
}

export function getBrokerConfig(): BrokerConfig {
  const rpc = process.env.ZG_RPC_URL ?? DEFAULT_RPC;
  return {
    rpc,
    network: detectNetwork(rpc),
    modelFilter: (process.env.MODEL_FILTER ?? 'qwen-2.5-7b-instruct').toLowerCase(),
    pinnedProvider: process.env.PROVIDER_ADDRESS?.trim() || null,
    contracts: {
      ledger: envAddress('ZG_LEDGER_CA'),
      inference: envAddress('ZG_INFERENCE_CA'),
      fineTuning: envAddress('ZG_FINE_TUNING_CA'),
    },
    initialDeposit: Number(process.env.INITIAL_DEPOSIT ?? '0'),
    providerTransferAmount: parseTransferAmount(),
  };
}

export async function logBrokerContext(ctx: Ctx) {
  const network = await ctx.provider.getNetwork();
  console.log('[network]', {
    rpc: getBrokerConfig().rpc,
    chainId: network.chainId.toString(),
    name: network.name,
  });
  console.log('[compute-sdk]', {
    packageName: ctx.sdk.packageName,
    packageVersion: ctx.sdk.packageVersion,
  });
}

export async function listServicesWithSummary(broker: Ctx['broker']) {
  const services = await broker.inference.listService();
  console.log(`[services] total=${services.length}`);
  if (services.length > 0) {
    console.dir(
      services.map((s: any) => ({
        provider: getServiceProvider(s),
        model: getServiceModel(s),
        serviceType: s.serviceType ?? s.service_type ?? null,
        serviceName: s.serviceName ?? s.service_name ?? null,
        verifiability: s.verifiability ?? s.verifiabilityType ?? null,
        url: s.url ?? s.endpoint ?? null,
      })),
      { depth: null },
    );
  }
  return services;
}

export function getServiceProvider(service: any): string {
  return service?.provider ?? service?.providerAddress ?? service?.provider_address ?? '';
}

export function getServiceModel(service: any): string {
  return service?.model ?? service?.modelName ?? service?.model_name ?? '';
}

export function getServiceType(service: any): string {
  return String(service?.serviceType ?? service?.service_type ?? service?.serviceName ?? service?.service_name ?? '');
}

/** Pick a live chatbot service whose `model` matches MODEL_FILTER, or PROVIDER_ADDRESS if pinned. */
export async function pickService(broker: Ctx['broker']) {
  const { pinnedProvider: pinned, modelFilter: filter } = getBrokerConfig();
  const services = await listServicesWithSummary(broker);
  if (services.length === 0) {
    throw new Error(
      `No services returned by broker.inference.listService(). ` +
      `This usually means the 0G registry is empty on the selected network or the SDK/network combo is out of date. ` +
      `RPC=${getBrokerConfig().rpc}`,
    );
  }

  if (pinned) {
    const hit = services.find((s: any) => getServiceProvider(s).toLowerCase() === pinned.toLowerCase());
    if (!hit) {
      throw new Error(
        `Pinned PROVIDER_ADDRESS ${pinned} was not returned by listService(). ` +
        `Run npm run list-services to inspect currently visible providers.`,
      );
    }
    return hit;
  }
  
  // Log all services for debugging
  console.log('[all services]', services.map((s: any) => ({ 
    provider: getServiceProvider(s),
    model: getServiceModel(s),
    serviceType: getServiceType(s),
    url: s.url ?? s.endpoint ?? null,
  })));
  
  const chatbots = services.filter((s: any) => getServiceType(s).toLowerCase().includes('chat') || getServiceModel(s));
  console.log(`[chatbots filtered] ${chatbots.length} services`);
  
  const match = chatbots.find((s: any) => getServiceModel(s).toLowerCase().includes(filter));
  if (!match) {
    console.error('No service matches filter. Available:', chatbots.map((s: any) => ({
      provider: getServiceProvider(s),
      model: getServiceModel(s),
      serviceType: getServiceType(s) || null,
      url: s.url ?? s.endpoint ?? null,
    })));
    throw new Error(
      `No live provider for model filter "${filter}". ` +
      `Either set PROVIDER_ADDRESS manually or relax MODEL_FILTER.`,
    );
  }
  return match;
}

/** Ensure main-account balance + provider acknowledgement. Safe to call repeatedly. */
export async function ensureFunded(broker: Ctx['broker'], providerAddress: string) {
  const config = getBrokerConfig();
  const initial = config.initialDeposit;
  try {
    const ledger = await broker.ledger.getLedger();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bal: bigint = (ledger as any)?.totalBalance ?? (ledger as any)?.balance ?? (ledger as any)?.availableBalance ?? 0n;
    if (bal === 0n && initial > 0) {
      console.log(`[ledger] empty, depositing ${initial} 0G…`);
      await broker.ledger.depositFund(initial);
    } else {
      console.log(`[ledger] totalBalance=${bal.toString()} wei`);
    }
  } catch (e) {
    if (initial <= 0) {
      throw new Error(
        'No 0G Compute ledger exists and INITIAL_DEPOSIT is 0. ' +
          'Set INITIAL_DEPOSIT to create/fund the ledger before inference.',
      );
    }
    console.log(`[ledger] no account yet — creating via addLedger(${initial})`);
    await broker.ledger.addLedger(initial);
  }

  try {
    await broker.inference.acknowledgeProviderSigner(providerAddress);
    console.log(`[ack] acknowledged provider ${providerAddress}`);
  } catch (e: any) {
    // already acknowledged is fine
    if (!String(e?.message ?? e).toLowerCase().includes('already')) {
      console.warn('[ack] acknowledgeProviderSigner:', e?.message ?? e);
    }
  }

  if (config.providerTransferAmount) {
    const amountWei = ethers.parseEther(config.providerTransferAmount);
    console.log(
      `[ledger] transferring ${config.providerTransferAmount} 0G (${amountWei.toString()} wei) ` +
        `to inference provider ${providerAddress}`,
    );
    await broker.ledger.transferFund(providerAddress, 'inference', amountWei);
  }
}
