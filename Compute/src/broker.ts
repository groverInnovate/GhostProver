import 'dotenv/config';
import { ethers } from 'ethers';
import { createRequire } from 'module';
import type { createZGComputeNetworkBroker as createZGComputeNetworkBrokerType } from '@0glabs/0g-serving-broker';

const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require('@0glabs/0g-serving-broker');

export interface Ctx {
  broker: Awaited<ReturnType<typeof createZGComputeNetworkBrokerType>>;
  wallet: ethers.Wallet;
  provider: ethers.JsonRpcProvider;
}

export interface BrokerConfig {
  rpc: string;
  modelFilter: string;
  pinnedProvider: string | null;
}

export async function initBroker(): Promise<Ctx> {
  const rpc = process.env.ZG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
  const pk = process.env.PRIVATE_KEY;
  if (!pk || !pk.startsWith('0x')) {
    throw new Error('PRIVATE_KEY missing in .env (must be hex-prefixed).');
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  return { broker, wallet, provider };
}

export function getBrokerConfig(): BrokerConfig {
  return {
    rpc: process.env.ZG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai',
    modelFilter: (process.env.MODEL_FILTER ?? 'qwen-2.5-7b-instruct').toLowerCase(),
    pinnedProvider: process.env.PROVIDER_ADDRESS?.trim() || null,
  };
}

export async function logBrokerContext(ctx: Ctx) {
  const network = await ctx.provider.getNetwork();
  console.log('[network]', {
    rpc: getBrokerConfig().rpc,
    chainId: network.chainId.toString(),
    name: network.name,
  });
}

export async function listServicesWithSummary(broker: Ctx['broker']) {
  const services = await broker.inference.listService();
  console.log(`[services] total=${services.length}`);
  if (services.length > 0) {
    console.dir(
      services.map((s: any) => ({
        provider: s.provider ?? null,
        model: s.model ?? null,
        serviceType: s.serviceType ?? null,
        serviceName: s.serviceName ?? null,
        verifiability: s.verifiability ?? null,
        url: s.url ?? null,
      })),
      { depth: null },
    );
  }
  return services;
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

<<<<<<< HEAD
=======
  const services = await broker.inference.listService();
  console.log(`[listService] found ${services.length} total services`);
  
>>>>>>> origin/main
  if (pinned) {
    const hit = services.find((s: any) => s.provider?.toLowerCase() === pinned.toLowerCase());
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
    provider: s.provider, 
    model: s.model, 
    serviceType: s.serviceType,
    url: s.url 
  })));
  
  const chatbots = services.filter((s: any) => (s.serviceType ?? s.serviceName ?? '').toLowerCase().includes('chat') || s.model);
  console.log(`[chatbots filtered] ${chatbots.length} services`);
  
  const match = chatbots.find((s: any) => (s.model ?? '').toLowerCase().includes(filter));
  if (!match) {
    console.error('No service matches filter. Available:', chatbots.map((s: any) => ({
      provider: s.provider,
      model: s.model,
      serviceType: s.serviceType ?? s.serviceName ?? null,
      url: s.url ?? null,
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
  const initial = Number(process.env.INITIAL_DEPOSIT ?? '0.1');
  try {
    const ledger = await broker.ledger.getLedger();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bal: bigint = (ledger as any)?.totalBalance ?? (ledger as any)?.balance ?? 0n;
    if (bal === 0n && initial > 0) {
      console.log(`[ledger] empty, depositing ${initial} 0G…`);
      await broker.ledger.depositFund(initial);
    } else {
      console.log(`[ledger] balance=${bal.toString()} wei`);
    }
  } catch (e) {
    console.log('[ledger] no account yet — creating via depositFund');
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
}
