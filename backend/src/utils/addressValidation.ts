import { PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';
import bs58 from 'bs58';
import { decodeAddress } from '@polkadot/util-crypto';
import { fromBech32 } from '@cosmjs/encoding';
import { StrKey } from 'stellar-sdk';
// NOTE: We avoid importing '@dfinity/principal' directly so the code works even
// when the package is not installed (e.g. in limited build environments).

const BECH32_CHARSET_REGEX = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
const CASHADDR_PREFIXES = ['bitcoincash', 'bchtest', 'bchreg'];

const CASHADDR_CHARSET_REGEX = BECH32_CHARSET_REGEX;

const doubleSha256 = (data: Uint8Array): Buffer => {
  const first = createHash('sha256').update(data).digest();
  return createHash('sha256').update(first).digest();
};

const ICP_BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ICP_TEXT_REGEX = /^([a-z2-7]{5}-)*[a-z2-7]{3,5}$/;

const base32Decode = (value: string): Uint8Array | null => {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];

  for (const char of value) {
    const index = ICP_BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      return null;
    }

    buffer = (buffer << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }

  // Reject if there are leftover meaningful bits (invalid padding situation)
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    return null;
  }

  return Uint8Array.from(output);
};

const isValidIcpPrincipalText = (value: string): boolean => {
  const normalized = value.toLowerCase();
  if (!ICP_TEXT_REGEX.test(normalized)) {
    return false;
  }

  // Remove dashes and validate base32 payload.
  const payload = normalized.replace(/-/g, '');
  const decoded = base32Decode(payload);

  // Principal text encodes a 4-byte checksum plus data, so anything shorter than 5 bytes is invalid.
  return !!decoded && decoded.length >= 5;
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

const extractCashAddressParts = (value: string): { prefix: string; payload: string } | null => {
  const lower = value.toLowerCase();
  const separatorIndex = lower.lastIndexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  const prefix = lower.slice(0, separatorIndex);
  const payload = lower.slice(separatorIndex + 1);
  if (!payload) {
    return null;
  }

  return { prefix, payload };
};

export const isValidBitcoinCashAddress = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const cashParts = extractCashAddressParts(trimmed);
  if (cashParts) {
    if (!CASHADDR_PREFIXES.includes(cashParts.prefix)) {
      return false;
    }
    if (!CASHADDR_CHARSET_REGEX.test(cashParts.payload)) {
      return false;
    }
    return cashParts.payload.length >= 8 && cashParts.payload.length <= 200;
  }

  const normalized = trimmed.toLowerCase();
  if (CASHADDR_CHARSET_REGEX.test(normalized) && normalized.length >= 8 && normalized.length <= 200) {
    return true;
  }

  return isValidBitcoinAddress(trimmed);
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

export const isValidIcpAddress = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return true;
  }

  return isValidIcpPrincipalText(trimmed);
};

export type NonEvmAddressInput = {
  solanaAddress?: string | null;
  bitcoinAddress?: string | null;
  bitcoinCashAddress?: string | null;
  polkadotAddress?: string | null;
  cosmosAddress?: string | null;
  stellarAddress?: string | null;
  icpAddress?: string | null;
};

export type NonEvmAddressErrors = Partial<Record<keyof NonEvmAddressInput, string>>;

export const validateNonEvmAddresses = (addresses: NonEvmAddressInput): NonEvmAddressErrors => {
  const errors: NonEvmAddressErrors = {};

  const {
    solanaAddress,
    bitcoinAddress,
    bitcoinCashAddress,
    polkadotAddress,
    cosmosAddress,
    stellarAddress,
    icpAddress
  } = addresses;

  if (solanaAddress && solanaAddress.trim() && !isValidSolanaAddress(solanaAddress)) {
    errors.solanaAddress = 'Invalid Solana address format.';
  }

  if (bitcoinAddress && bitcoinAddress.trim() && !isValidBitcoinAddress(bitcoinAddress)) {
    errors.bitcoinAddress = 'Invalid Bitcoin address format.';
  }

  if (bitcoinCashAddress && bitcoinCashAddress.trim() && !isValidBitcoinCashAddress(bitcoinCashAddress)) {
    errors.bitcoinCashAddress = 'Invalid Bitcoin Cash address format.';
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

  if (icpAddress && icpAddress.trim() && !isValidIcpAddress(icpAddress)) {
    errors.icpAddress = 'Invalid ICP address format.';
  }

  return errors;
};
