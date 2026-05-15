/**
 * P3 task — 0G Compute SDK wiring.
 *
 * 1. init broker against the configured 0G network (mainnet by default)
 * 2. discover a model provider (or use PROVIDER_ADDRESS)
 * 3. fund + acknowledge
 * 4. POST /chat/completions with a sample prompt
 * 5. dump:
 *      - raw JSON body
 *      - ALL response headers (zerogAuth / ZG-* are what we care about)
 *      - parsed zerogAuth attestation object shape
 *      - SDK processResponse() validity boolean
 *
 * Output is written to samples/inference-<ts>.log.json so other phases
 * (ZK commitment, on-chain receipt) can consume it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ensureFunded,
  getBrokerConfig,
  getServiceModel,
  getServiceProvider,
  initBroker,
  logBrokerContext,
  pickService,
} from './broker.js';

const PROMPT = process.argv.slice(2).join(' ') ||
  'In one short sentence: what is a zero-knowledge proof?';

function tryParseZerogAuth(raw: string | null): unknown {
  if (!raw) return null;
  // Observed formats: base64(JSON), JSON directly, or "scheme <b64>".
  const candidates = [raw, raw.split(' ').pop() ?? raw];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
    try { return JSON.parse(Buffer.from(c, 'base64').toString('utf8')); } catch {}
  }
  return raw;
}

function completionUrl(endpoint: string): string {
  const clean = endpoint.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

async function getInferenceHeaders(broker: any, providerAddress: string, body: string) {
  const fn = broker.inference.getRequestHeaders;
  if (typeof fn !== 'function') {
    throw new Error('broker.inference.getRequestHeaders is not available on this 0G SDK.');
  }

  // Newer SDKs generate provider-scoped session tokens with one argument.
  // Older @0glabs/0g-serving-broker versions require the request body for billing headers.
  if (fn.length <= 1) {
    return await fn.call(broker.inference, providerAddress);
  }
  return await fn.call(broker.inference, providerAddress, body);
}

async function verifyProviderService(broker: any, providerAddress: string): Promise<boolean | null> {
  const fn = broker.inference.verifyService;
  if (typeof fn !== 'function') {
    console.warn('[verifyService] not available on this SDK');
    return null;
  }
  try {
    const ok = await fn.call(broker.inference, providerAddress);
    console.log('[verifyService] provider TEE verification =', ok);
    return Boolean(ok);
  } catch (e: any) {
    console.warn('[verifyService] failed:', e?.message ?? e);
    return false;
  }
}

async function processInferenceResponse(
  broker: any,
  sdk: { packageName: string; packageVersion: string },
  providerAddress: string,
  responseContent: string,
  chatID?: string,
): Promise<boolean | null> {
  const fn = broker.inference.processResponse;
  if (typeof fn !== 'function') {
    console.warn('[processResponse] not available on this SDK');
    return null;
  }

  try {
    const legacyResponseOrder =
      sdk.packageName === '@0glabs/0g-serving-broker' &&
      /^0\.[0-4]\./.test(sdk.packageVersion);
    if (legacyResponseOrder) {
      return await fn.call(broker.inference, providerAddress, responseContent, chatID);
    }
    return await fn.call(broker.inference, providerAddress, chatID, responseContent);
  } catch (e: any) {
    console.warn('[processResponse] failed:', e?.message ?? e);
    return false;
  }
}

async function main() {
  const ctx = await initBroker();
  const { broker, wallet, sdk } = ctx;
  console.log('[wallet]', await wallet.getAddress());
  await logBrokerContext(ctx);
  console.log('[config]', getBrokerConfig());

  const service = await pickService(broker);
  const providerAddress = getServiceProvider(service);
  console.log('[service]', { provider: providerAddress, model: getServiceModel(service), url: service.url ?? service.endpoint });

  await ensureFunded(broker, providerAddress);
  const providerVerified = await verifyProviderService(broker, providerAddress);

  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
  console.log('[metadata]', { endpoint, model });

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: PROMPT }],
  });

  const headers = await getInferenceHeaders(broker, providerAddress, body);
  console.log('[request-headers]', Object.keys(headers));

  const t0 = Date.now();
  const url = completionUrl(endpoint);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  const elapsedMs = Date.now() - t0;

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  const zerogAuthRaw = res.headers.get('zerogauth') ?? res.headers.get('zerog-auth') ?? null;
  const zerogAuth = tryParseZerogAuth(zerogAuthRaw);

  console.log('\n=== RAW RESPONSE ===');
  console.log('status', res.status, `(${elapsedMs}ms)`);
  console.log('headers', resHeaders);
  console.log('body', data);
  console.log('\n=== zerogAuth (parsed) ===');
  console.dir(zerogAuth, { depth: null });

  // chatID is either a response header (ZG-Res-Key) or .id on the body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatID: string | undefined = (data as any)?.id ?? resHeaders['zg-res-key'] ?? resHeaders['ZG-Res-Key'];
  const responseContent: string =
    typeof (data as any)?.usage === 'object'
      ? JSON.stringify((data as any).usage)
      : typeof data === 'string'
        ? data
        : String((data as any)?.choices?.[0]?.message?.content ?? text);

  let verified: boolean | null = null;
  if (chatID) {
    verified = await processInferenceResponse(broker, sdk, providerAddress, responseContent, chatID);
    console.log('\n[processResponse] TEE signature valid =', verified);
  } else {
    console.warn('[processResponse] no chatID on response, skipping');
  }

  const out = {
    ts: new Date().toISOString(),
    prompt: PROMPT,
    provider: providerAddress,
    model,
    endpoint,
    url,
    elapsedMs,
    request: { headers: Object.keys(headers), body: JSON.parse(body) },
    response: { status: res.status, headers: resHeaders, body: data },
    zerogAuth: { raw: zerogAuthRaw, parsed: zerogAuth },
    chatID: chatID ?? null,
    providerVerified,
    teeVerified: verified,
  };

  const dir = path.resolve('samples');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `inference-${Date.now()}.log.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n[saved] ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
