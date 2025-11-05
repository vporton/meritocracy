import { PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import bs58 from 'bs58';
import { decodeAddress } from '@polkadot/util-crypto';
import { fromBech32 } from '@cosmjs/encoding';
import { StrKey } from 'stellar-sdk';

const BECH32_CHARSET_REGEX = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;

const doubleSha256 = (data: Uint8Array): Buffer => {
  const first = createHash('sha256').update(data).digest();
  return createHash('sha256').update(first).digest();
};

const isValidBase58Check = (value: string): boolean => {
  try {
    const decoded = bs58.decode(value);
    if (decoded.length < 4) {
      return false;
    }
    const payload = Buffer.from(decoded.subarray(0, decoded.length - 4));
    const checksum = Buffer.from(decoded.subarray(decoded.length - 4));
    const expected = doubleSha256(payload).subarray(0, 4);
    return checksum.equals(expected);
  } catch {
    return false;
  }
};

const isBech32Format = (
  value: string,
  prefixes: string[],
  { minDataLength = 6, maxDataLength = 90 }: { minDataLength?: number; maxDataLength?: number } = {}
): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  if (value !== normalized && value !== value.toUpperCase()) {
    // Mixed case is not allowed in Bech32
    return false;
  }

  const separatorIndex = normalized.lastIndexOf('1');
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    return false;
  }

  const hrp = normalized.slice(0, separatorIndex);
  if (!prefixes.includes(hrp)) {
    return false;
  }

  const dataPart = normalized.slice(separatorIndex + 1);
  if (dataPart.length < minDataLength || dataPart.length > maxDataLength) {
    return false;
  }

  return BECH32_CHARSET_REGEX.test(dataPart);
};

export const isValidSolanaAddress = (value: string): boolean => {
  try {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
};

export const isValidBitcoinAddress = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (isBech32Format(trimmed, ['bc', 'tb', 'bcrt'], { minDataLength: 6, maxDataLength: 90 })) {
    return true;
  }

  if (trimmed.length < 26 || trimmed.length > 99) {
    return false;
  }

  if (!/^[123mn][1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
    return false;
  }

  return isValidBase58Check(trimmed);
};

export const isValidPolkadotAddress = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const decoded = decodeAddress(trimmed);
    return decoded.length === 32;
  } catch {
    return false;
  }
};

export const isValidCosmosAddress = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (!isBech32Format(trimmed, ['cosmos'])) {
    return false;
  }

  try {
    const decoded = fromBech32(trimmed);
    return decoded.prefix === 'cosmos' && decoded.data.length === 20;
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

  if (stellarAddress && stellarAddress.trim()) {
    const trimmed = stellarAddress.trim();
    if (!/^G[A-Z2-7]{55}$/.test(trimmed) || !StrKey.isValidEd25519PublicKey(trimmed)) {
      errors.stellarAddress = 'Invalid Stellar address format.';
    }
  }

  return errors;
};
