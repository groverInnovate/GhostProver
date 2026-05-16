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
- **Live 0G anchoring is opt-in.** The default daemon mode writes draft cache
  records for development. Mainnet submission requires `onChainSubmit: true`, a
  deployed registry, and a funded `Compute/.env` wallet.

Recommended next technical upgrades:

1. Luhn validation for credit card proofs.
2. Variable-length pattern compiler.
3. Registry UI for custom company policies.
4. Reuse already-generated daemon proofs inside the 0G adapter instead of
   proving again through the Compute orchestrator.
5. Production auth for daemon access.
