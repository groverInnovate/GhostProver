# 0G Mainnet Receipts

GhostProver has live `ComplianceBatchReceiptIssued` events on the deployed 0G
mainnet registry.

## Deployment

- Network: 0G mainnet
- Chain ID: `16661`
- Registry: `0x9595BD4e6b868C64001904EeF76d838D78604B6e`
- Verifier: `0x17B9D7B36Bf6E77F7dbc010B4B2be662A3f1dF78`

## Receipts

### One-Pattern Batch

- Transaction: [`0x13d66003114e12ef497abf98c4dc30f12efe81c4b90202a5d4385b0aeb01eb04`](https://0g.exploreme.pro/tx/0x13d66003114e12ef497abf98c4dc30f12efe81c4b90202a5d4385b0aeb01eb04)
- Block: `33386820`
- Provider: `0x992e6396157Dc4f22E74F2231235D7DE62696db5`
- Model: `qwen3.6-plus`
- Storage root: `0x75f25717c16fbddafd89ea64ce59d8a4d778d6f187273d38769303b35509a457`
- Target hashes: `1`

### Full SaaS Preset Batch

- Transaction: [`0xc4eeb667eeb53d41bd2d02131fde5927214b5675d05db7b317770b09a2f61a0d`](https://0g.exploreme.pro/tx/0xc4eeb667eeb53d41bd2d02131fde5927214b5675d05db7b317770b09a2f61a0d)
- Block: `33387304`
- Provider: `0x992e6396157Dc4f22E74F2231235D7DE62696db5`
- Model: `qwen3.6-plus`
- Storage root: `0x2395675625684a9af61f7f1cab499108f20cf789d106211a5d1fb426f9299700`
- Target hashes: `9`

The same structured data is checked into
[`Chain/deployments/0g-mainnet-receipts.json`](../Chain/deployments/0g-mainnet-receipts.json).

## Query Command

```bash
curl -s https://evmrpc.0g.ai \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_getLogs",
    "params":[{
      "fromBlock":"0x1fd70b6",
      "toBlock":"latest",
      "address":"0x9595BD4e6b868C64001904EeF76d838D78604B6e",
      "topics":["0xa485250989cf56217d40b0e16b0d9a76f70d1a7ae48b341430b13475bcd895a5"]
    }],
    "id":1
  }'
```
