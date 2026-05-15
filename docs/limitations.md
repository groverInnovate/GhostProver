# Known Limitations

GhostProver is already useful as a local compliance agent, but these limits are
important for judges and future contributors.

- **Proof generation is slow on WASM.** The daemon queues proofs in the
  background so demos should not block on full preset generation.
- **Patterns are fixed-length.** The current circuit supports fixed 1-32 byte
  character-class descriptors. Optional separators and variable-length formats
  are future work.
- **No semantic PII detection yet.** GhostProver checks structured patterns,
  not natural-language meaning.
- **False positives need policy tuning.** Broad patterns such as long digit
  sequences should be used carefully in company presets.
- **MCP requires workflow invocation.** MCP tools do not magically intercept all
  prompts; agent workflows must call GhostProver explicitly.
- **Live 0G anchoring is deferred.** Local receipts include the right fields,
  but live 0G Storage upload and on-chain tx hashes are a separate adapter.

Recommended next technical upgrades:

1. Luhn validation for credit card proofs.
2. Variable-length pattern compiler.
3. Registry UI for custom company policies.
4. 0G Storage + 0G Chain receipt adapter.
5. Production auth for daemon access.
