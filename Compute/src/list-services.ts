import { getBrokerConfig, initBroker, listServicesWithSummary, logBrokerContext } from './broker.js';

async function main() {
  const ctx = await initBroker();
  const { broker, wallet } = ctx;

  console.log('[wallet]', await wallet.getAddress());
  await logBrokerContext(ctx);
  console.log('[config]', getBrokerConfig());

  const services = await listServicesWithSummary(broker);
  if (services.length === 0) {
    console.log('[hint] No services are visible from the broker right now. Try again later, confirm the testnet RPC, or check whether the SDK version matches the current 0G environment.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
