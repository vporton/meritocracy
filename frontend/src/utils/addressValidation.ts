const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BECH32_CHARSET_REGEX = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;

const hasBech32Prefix = (value: string, prefixes: string[]): boolean => {
  const normalized = value.toLowerCase();
  const separatorIndex = normalized.lastIndexOf('1');
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    return false;
  }

  const hrp = normalized.slice(0, separatorIndex);
  const dataPart = normalized.slice(separatorIndex + 1);

  if (value !== normalized && value !== value.toUpperCase()) {
    // Bech32 does not allow mixed case
    return false;
  }

  if (!prefixes.includes(hrp)) {
    return false;
  }

  return BECH32_CHARSET_REGEX.test(dataPart);
};

export const isValidSolanaAddress = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    trimmed.length >= 32 &&
    trimmed.length <= 44 &&
    BASE58_REGEX.test(trimmed)
  );
};

export const isValidBitcoinAddress = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (hasBech32Prefix(trimmed, ['bc', 'tb', 'bcrt'])) {
    return true;
  }

  return (
    trimmed.length >= 26 &&
    trimmed.length <= 99 &&
    BASE58_REGEX.test(trimmed) &&
    /^[13mn]/.test(trimmed)
  );
};

export const isValidPolkadotAddress = (value: string): boolean => {
  const trimmed = value.trim();
  return (
    trimmed.length >= 47 &&
    trimmed.length <= 49 &&
    BASE58_REGEX.test(trimmed)
  );
};

export const isValidCosmosAddress = (value: string): boolean => {
  const trimmed = value.trim();
  return hasBech32Prefix(trimmed, ['cosmos']);
};

export type NonEvmAddressInput = {
  solanaAddress?: string | null;
  bitcoinAddress?: string | null;
  polkadotAddress?: string | null;
  cosmosAddress?: string | null;
};

export type NonEvmAddressErrors = Partial<Record<keyof NonEvmAddressInput, string>>;

export const validateNonEvmAddresses = (addresses: NonEvmAddressInput): NonEvmAddressErrors => {
  const errors: NonEvmAddressErrors = {};

  const { solanaAddress, bitcoinAddress, polkadotAddress, cosmosAddress } = addresses;

  if (solanaAddress && solanaAddress.trim() && !isValidSolanaAddress(solanaAddress)) {
    errors.solanaAddress = 'Invalid Solana address format.';
  }

  if (bitcoinAddress && bitcoinAddress.trim() && !isValidBitcoinAddress(bitcoinAddress)) {
    errors.bitcoinAddress = 'Invalid Bitcoin address format.';
  }

  if (polkadotAddress && polkadotAddress.trim() && !isValidPolkadotAddress(polkadotAddress)) {
    errors.polkadotAddress = 'Invalid Polkadot address format.';
  }

  if (cosmosAddress && cosmosAddress.trim() && !isValidCosmosAddress(cosmosAddress)) {
    errors.cosmosAddress = 'Invalid Cosmos address format.';
  }

  return errors;
};
