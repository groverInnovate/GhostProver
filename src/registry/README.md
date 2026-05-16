# GhostProver — Registry

This folder contains the bundled sensitive-data registry used by GhostProver.

## Purpose

The registry defines:

- pattern descriptors
- preset groupings
- validation helpers

It is the policy vocabulary that connects business-facing compliance categories to circuit-facing proof inputs.

## Files

| File | Role |
|---|---|
| `patterns.json` | Bundled pattern and preset definitions |
| `index.ts` | Registry loading, validation, and lookup helpers |

Custom company registries can be layered on top of these bundled defaults through the configuration flow documented elsewhere in the repository.
