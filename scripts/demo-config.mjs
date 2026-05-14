export const DEMO_PROMPT =
  'What are the treatment options for a patient with high blood pressure and diabetes ?';

export const DEMO_TARGET = '234567890123';

export const DEMO_LIMITATIONS = [
  'prompt and target are hardcoded local sample inputs',
  'no live 0G provider or TEE attestation is involved',
  'no zerogAuth/processResponse verification is performed',
  'no 0G Storage root is produced',
  'transactions are sent to local Anvil, not 0G Chain',
];
