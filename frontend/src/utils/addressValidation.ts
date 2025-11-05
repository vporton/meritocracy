const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BECH32_CHARSET_REGEX = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

const decodeBase32 = (value: string): Uint8Array => {
  const normalized = value.replace(/=+$/, '').toUpperCase();
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 character');
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
};

const crc16Xmodem = (data: Uint8Array): number => {
  let crc = 0x0000;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
};

export const isValidStellarAddress = (value: string): boolean => {
  const trimmed = value.trim();
  if (!STELLAR_ADDRESS_REGEX.test(trimmed)) {
    return false;
  }
  try {
    const decoded = decodeBase32(trimmed);
    if (decoded.length !== 35) {
      return false;
    }
    const payload = decoded.subarray(0, decoded.length - 2);
    const checksum = decoded.subarray(decoded.length - 2);
    const expected = crc16Xmodem(payload);
    const actual = checksum[0] | (checksum[1] << 8);
    return expected === actual;
  } catch {
    return false;
  }
};

export type NonEvmAddressInput = {
  solanaAddress?: string | null;
  bitcoinAddress?: string | null;
  polkadotAddress?: string | null;
  cosmosAddress?: string | null;
  stellarAddress?: string | null;
};

export type NonEvmAddressErrors = Partial<Record<keyof NonEvmAddressInput, string>>;

export const validateNonEvmAddresses = (addresses: NonEvmAddressInput): NonEvmAddressErrors => {
  const errors: NonEvmAddressErrors = {};

  const { solanaAddress, bitcoinAddress, polkadotAddress, cosmosAddress, stellarAddress } = addresses;

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

  if (stellarAddress && stellarAddress.trim() && !isValidStellarAddress(stellarAddress)) {
    errors.stellarAddress = 'Invalid Stellar address format.';
  }

  return errors;
};
