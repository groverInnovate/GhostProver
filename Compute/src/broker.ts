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

/** Pick a live chatbot service whose `model` matches MODEL_FILTER, or PROVIDER_ADDRESS if pinned. */
export async function pickService(broker: Ctx['broker']) {
  const pinned = process.env.PROVIDER_ADDRESS?.trim();
  const filter = (process.env.MODEL_FILTER ?? 'qwen-2.5-7b-instruct').toLowerCase();

  const services = await broker.inference.listService();
  console.log(`[listService] found ${services.length} total services`);
  
  if (pinned) {
    const hit = services.find((s: any) => s.provider?.toLowerCase() === pinned.toLowerCase());
    if (!hit) throw new Error(`Pinned PROVIDER_ADDRESS ${pinned} not in listService()`);
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
    console.error('No service matches filter. Available:', chatbots.map((s: any) => ({ provider: s.provider, model: s.model })));
    throw new Error(`No live provider for model filter "${filter}"`);
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
