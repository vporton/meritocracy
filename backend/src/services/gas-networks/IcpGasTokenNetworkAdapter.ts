import type { User } from '@prisma/client';
import { createPrivateKey } from 'crypto';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Principal } from '@icp-sdk/core/principal';
import { AccountIdentifier, IcpLedgerCanister as LedgerCanister } from '@icp-sdk/canisters/ledger/icp';
import { systemSecretService } from '../SystemSecretService.js';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';
import { withRetry } from '../../utils/retry.js';

interface IcpNetworkConfig {
  enabled: boolean;
  networkId: string;
  networkName: string;
  host?: string;
  ledgerCanisterId?: string;
  walletAddress?: string;
  transferFeeE8s: number;
  supportedTokens: IcpTokenConfig[];
}

interface IcpTokenConfig {
  tokenType: GasTokenNetworkContext['tokenType'];
  tokenSymbol: string;
  tokenDecimals: number;
  ledgerCanisterId: string;
  transferFeeDecimals: number;
  networkSuffix?: string;
  nativeSymbol?: string;
  erc20ContractAddress?: string;
}

const DEFAULT_ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const DEFAULT_ICP_HOST = 'https://ic0.app';
const DEFAULT_ICP_DECIMALS = 8;
const DEFAULT_CKBTC_MINTER_CANISTER_ID = 'mqygn-kiaaa-aaaar-qaadq-cai';
const DEFAULT_CKETH_HELPER_CONTRACT_ADDRESS = '0x6abDA0438307733FC299e9C229FD3cc074bD8cC0';
const DEFAULT_USDT_ERC20_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const DEFAULT_USDC_ERC20_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DEFAULT_EURC_ERC20_CONTRACT_ADDRESS = '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c';
const ICRC1_ACCOUNT = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(IDL.Vec(IDL.Nat8))
});
const ICRC1_TRANSFER_ARG = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  to: ICRC1_ACCOUNT,
  amount: IDL.Nat,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64)
});
const ICRC1_TRANSFER_ERROR = IDL.Variant({
  BadFee: IDL.Record({ expected_fee: IDL.Nat }),
  BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
  InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
  TooOld: IDL.Null,
  CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
  TemporarilyUnavailable: IDL.Null,
  Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
  GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text })
});
const icrc1IdlFactory = ({ IDL: idl }: { IDL: typeof IDL }) =>
  idl.Service({
    icrc1_balance_of: idl.Func([ICRC1_ACCOUNT], [idl.Nat], ['query']),
    icrc1_decimals: idl.Func([], [idl.Nat8], ['query']),
    icrc1_fee: idl.Func([], [idl.Nat], ['query']),
    icrc1_symbol: idl.Func([], [idl.Text], ['query']),
    icrc1_transfer: idl.Func([ICRC1_TRANSFER_ARG], [IDL.Variant({
      Ok: IDL.Nat,
      Err: ICRC1_TRANSFER_ERROR
    })], [])
  });
const ckbtcMinterIdlFactory = ({ IDL: idl }: { IDL: any }) =>
  idl.Service({
    get_btc_address: idl.Func(
      [idl.Record({ owner: idl.Opt(idl.Principal), subaccount: idl.Opt(idl.Vec(idl.Nat8)) })],
      [idl.Text],
      []
    )
  });

type Icrc1Actor = {
  icrc1_balance_of: (account: { owner: Principal; subaccount: [] | [Uint8Array] }) => Promise<bigint>;
  icrc1_decimals: () => Promise<number>;
  icrc1_fee: () => Promise<bigint>;
  icrc1_symbol: () => Promise<string>;
  icrc1_transfer: (args: {
    from_subaccount: [];
    to: { owner: Principal; subaccount: [] | [Uint8Array] };
    amount: bigint;
    fee: [] | [bigint];
    memo: [];
    created_at_time: [];
  }) => Promise<{ Ok?: bigint; Err?: Record<string, unknown> }>;
};


export interface IcpTreasuryFundingAddress {
  network: 'Bitcoin' | 'Ethereum' | 'ICP';
  label: string;
  address: string;
  note?: string;
  kind?: 'btc-deposit' | 'eth-deposit' | 'erc20-deposit' | 'manual';
  receiverPrincipal?: string;
  receiverPrincipalBytes32?: string;
  tokenContractAddress?: string;
}

type CkbtcMinterActor = {
  get_btc_address: (args: { owner: [] | [Principal]; subaccount: [] | [Uint8Array] }) => Promise<string>;
};

const ICP_TOKENS: readonly IcpTokenConfig[] = [
  {
    tokenType: 'NATIVE',
    tokenSymbol: 'ICP',
    tokenDecimals: DEFAULT_ICP_DECIMALS,
    ledgerCanisterId: DEFAULT_ICP_LEDGER_CANISTER_ID,
    transferFeeDecimals: DEFAULT_ICP_DECIMALS,
    nativeSymbol: 'ICP'
  },
  {
    tokenType: 'ICRC1',
    tokenSymbol: 'ckBTC',
    tokenDecimals: 8,
    ledgerCanisterId: process.env.ICP_CKBTC_LEDGER_CANISTER_ID ?? 'mxzaz-hqaaa-aaaar-qaada-cai',
    transferFeeDecimals: 8,
    networkSuffix: 'ckbtc',
    nativeSymbol: 'ICP'
  },
  {
    tokenType: 'ICRC1',
    tokenSymbol: 'ckETH',
    tokenDecimals: 18,
    ledgerCanisterId: process.env.ICP_CKETH_LEDGER_CANISTER_ID ?? 'ss2fx-dyaaa-aaaar-qacoq-cai',
    transferFeeDecimals: 18,
    networkSuffix: 'cketh',
    nativeSymbol: 'ICP'
  },
  {
    tokenType: 'ICRC1',
    tokenSymbol: 'ckUSDT',
    tokenDecimals: 6,
    ledgerCanisterId: process.env.ICP_CKUSDT_LEDGER_CANISTER_ID ?? 'cngnf-vqaaa-aaaar-qag4q-cai',
    transferFeeDecimals: 6,
    networkSuffix: 'ckusdt',
    nativeSymbol: 'ICP',
    erc20ContractAddress:
      process.env.ICP_CKUSDT_ERC20_CONTRACT_ADDRESS?.trim() || DEFAULT_USDT_ERC20_CONTRACT_ADDRESS
  },
  {
    tokenType: 'ICRC1',
    tokenSymbol: 'ckUSDC',
    tokenDecimals: 6,
    ledgerCanisterId: process.env.ICP_CKUSDC_LEDGER_CANISTER_ID ?? 'xevnm-gaaaa-aaaar-qafnq-cai',
    transferFeeDecimals: 6,
    networkSuffix: 'ckusdc',
    nativeSymbol: 'ICP',
    erc20ContractAddress:
      process.env.ICP_CKUSDC_ERC20_CONTRACT_ADDRESS?.trim() || DEFAULT_USDC_ERC20_CONTRACT_ADDRESS
  },
  {
    tokenType: 'ICRC1',
    tokenSymbol: 'ckEURC',
    tokenDecimals: 6,
    ledgerCanisterId: process.env.ICP_CKEURC_LEDGER_CANISTER_ID ?? 'pe5t5-diaaa-aaaar-qahwa-cai',
    transferFeeDecimals: 6,
    networkSuffix: 'ckeurc',
    nativeSymbol: 'ICP',
    erc20ContractAddress:
      process.env.ICP_CKEURC_ERC20_CONTRACT_ADDRESS?.trim() || DEFAULT_EURC_ERC20_CONTRACT_ADDRESS
  }
] as const;

const readIcpConfig = (): IcpNetworkConfig => {
  const transferFeeE8sRaw = Number(process.env.ICP_TRANSFER_FEE_E8S ?? 10000);
  const transferFeeE8s =
    Number.isFinite(transferFeeE8sRaw) && transferFeeE8sRaw > 0
      ? Math.floor(transferFeeE8sRaw)
      : 10000;

  return {
    enabled: process.env.ICP_ENABLED === 'true',
    networkId: 'icp-mainnet',
    networkName: 'Internet Computer',
    host: process.env.ICP_HOST ?? DEFAULT_ICP_HOST,
    ledgerCanisterId: process.env.ICP_LEDGER_CANISTER_ID ?? DEFAULT_ICP_LEDGER_CANISTER_ID,
    walletAddress: process.env.ICP_WALLET_ADDRESS,
    transferFeeE8s,
    supportedTokens: ICP_TOKENS.map(token =>
      token.tokenType === 'NATIVE'
        ? {
            ...token,
            ledgerCanisterId: process.env.ICP_LEDGER_CANISTER_ID ?? DEFAULT_ICP_LEDGER_CANISTER_ID
          }
        : {
            ...token,
            erc20ContractAddress: normalizeEthereumAddress(token.erc20ContractAddress)
          }
    )
  };
};

const normalizeEthereumAddress = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error(`[ICP] Invalid Ethereum address configured: ${trimmed}`);
  }

  return trimmed;
};

const principalToBytes32Hex = (principalText: string): string => {
  const principalBytes = Principal.fromText(principalText).toUint8Array();
  if (principalBytes.length > 32) {
    throw new Error('[ICP] Principal bytes exceed bytes32 length');
  }

  const padded = Buffer.alloc(32);
  padded.set(principalBytes, 0);
  return `0x${padded.toString('hex')}`;
};

const toBaseUnits = (amountToken: number, decimals: number): bigint => {
  if (!Number.isFinite(amountToken)) {
    throw new Error('[ICP] Invalid token amount');
  }
  return BigInt(Math.round(amountToken * 10 ** decimals));
};

const fromBaseUnits = (amount: bigint | number, decimals: number): number =>
  Number(amount) / 10 ** decimals;

const ED25519_PKCS8_DER_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const ed25519IdentityFromPem = (pem: string): Ed25519KeyIdentity => {
  const privateKeyObject = createPrivateKey({ key: pem, format: 'pem' });
  const privateKeyDer = privateKeyObject.export({ format: 'der', type: 'pkcs8' });
  const privateKeyBuffer = Buffer.isBuffer(privateKeyDer)
    ? privateKeyDer
    : Buffer.from(privateKeyDer as ArrayBuffer);

  const prefix = privateKeyBuffer.subarray(0, ED25519_PKCS8_DER_PREFIX.length);
  if (!prefix.equals(ED25519_PKCS8_DER_PREFIX)) {
    throw new Error('[ICP] Unsupported Ed25519 private key format');
  }

  const secretKey = privateKeyBuffer.subarray(ED25519_PKCS8_DER_PREFIX.length);
  if (secretKey.length !== 32) {
    throw new Error('[ICP] Invalid Ed25519 private key length');
  }

  return Ed25519KeyIdentity.fromSecretKey(secretKey);
};

export class IcpGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'ICP';
  private agent?: HttpAgent;
  private ledger?: LedgerCanister;
  private identity?: Ed25519KeyIdentity;
  private icrcActors = new Map<string, Icrc1Actor>();
  private icrcMetadataCache = new Map<string, Promise<{ symbol: string; decimals: number; fee: bigint }>>();
  private ckbtcMinter?: CkbtcMinterActor;
  private fundingAddressCache = new Map<string, Promise<IcpTreasuryFundingAddress[] | undefined>>();

  private ensureEnabledConfig(): IcpNetworkConfig {
    const config = readIcpConfig();
    if (!config.enabled) {
      throw new Error('[ICP] Network disabled');
    }
    if (!config.host) {
      throw new Error('[ICP] ICP_HOST not configured');
    }
    if (!config.ledgerCanisterId) {
      throw new Error('[ICP] ICP_LEDGER_CANISTER_ID not configured');
    }
    return config;
  }

  private async getIdentity(): Promise<Ed25519KeyIdentity> {
    if (!this.identity) {
      const pem = await systemSecretService.ensureSecretInDb('ICP_IDENTITY_PEM');
      this.identity = ed25519IdentityFromPem(pem);
    }
    return this.identity;
  }

  private async getAgent(config: IcpNetworkConfig): Promise<HttpAgent> {
    if (!this.agent) {
      this.agent = new HttpAgent({
        host: config.host,
        identity: await this.getIdentity()
      });
    }
    return this.agent;
  }

  private async getLedger(config: IcpNetworkConfig): Promise<LedgerCanister> {
    if (!this.ledger) {
      this.ledger = LedgerCanister.create({
        agent: await this.getAgent(config),
        canisterId: Principal.fromText(config.ledgerCanisterId ?? DEFAULT_ICP_LEDGER_CANISTER_ID)
      });
    }
    return this.ledger;
  }

  private async getIcrcActor(canisterId: string, config: IcpNetworkConfig): Promise<Icrc1Actor> {
    const existing = this.icrcActors.get(canisterId);
    if (existing) {
      return existing;
    }

    const actor = Actor.createActor(icrc1IdlFactory as never, {
      agent: await this.getAgent(config),
      canisterId: Principal.fromText(canisterId)
    }) as unknown as Icrc1Actor;
    this.icrcActors.set(canisterId, actor);
    return actor;
  }


  private async getCkbtcMinter(config: IcpNetworkConfig): Promise<CkbtcMinterActor> {
    if (this.ckbtcMinter) {
      return this.ckbtcMinter;
    }

    const actor = Actor.createActor(
      ckbtcMinterIdlFactory as never,
      {
        agent: await this.getAgent(config),
        canisterId: Principal.fromText(
          process.env.ICP_CKBTC_MINTER_CANISTER_ID ?? DEFAULT_CKBTC_MINTER_CANISTER_ID
        )
      }
    ) as unknown as CkbtcMinterActor;

    this.ckbtcMinter = actor;
    return actor;
  }

  private getTokenConfig(
    config: IcpNetworkConfig,
    contextOrSymbol: GasTokenNetworkContext | string
  ): IcpTokenConfig {
    const tokenSymbol =
      typeof contextOrSymbol === 'string' ? contextOrSymbol : contextOrSymbol.tokenSymbol;
    const token = config.supportedTokens.find(entry => entry.tokenSymbol === tokenSymbol);
    if (!token) {
      throw new Error(`[ICP] Unsupported token ${tokenSymbol}`);
    }
    return token;
  }

  private async getIcrcMetadata(
    canisterId: string,
    config: IcpNetworkConfig,
    fallback: Pick<IcpTokenConfig, 'tokenSymbol' | 'tokenDecimals'>
  ): Promise<{ symbol: string; decimals: number; fee: bigint }> {
    const existing = this.icrcMetadataCache.get(canisterId);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const actor = await this.getIcrcActor(canisterId, config);
      try {
        const [symbol, decimals, fee] = await Promise.all([
          actor.icrc1_symbol(),
          actor.icrc1_decimals(),
          actor.icrc1_fee()
        ]);
        return { symbol, decimals, fee };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  [ICP] Failed to load ICRC-1 metadata for ${canisterId}: ${message}`);
        return {
          symbol: fallback.tokenSymbol,
          decimals: fallback.tokenDecimals,
          fee: BigInt(0)
        };
      }
    })();

    this.icrcMetadataCache.set(canisterId, promise);
    return promise;
  }

  private normalizePrincipalAddress(address: string): string {
    const trimmed = address.trim();
    return Principal.fromText(trimmed).toText();
  }

  private resolveOwnerPrincipal(address: string): Principal {
    const trimmed = address.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      throw new Error('[ICP] ICRC-1 transfers require a principal address, not a legacy account identifier');
    }
    return Principal.fromText(trimmed);
  }

  private formatAccountIdentifier(accountIdentifier: AccountIdentifier): string {
    const maybeHex = (accountIdentifier as unknown as { toHex?: () => string }).toHex;
    if (maybeHex) {
      return maybeHex.call(accountIdentifier);
    }
    return accountIdentifier.toString();
  }

  private getAccountIdentifierForPrincipal(principal: Principal): AccountIdentifier {
    const creator = AccountIdentifier as unknown as {
      fromPrincipal: (args: { principal: Principal }) => AccountIdentifier;
    };
    return creator.fromPrincipal({ principal });
  }

  private resolveAccountIdentifier(address: string): AccountIdentifier {
    const trimmed = address.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const creator = AccountIdentifier as unknown as {
        fromHex: (value: string) => AccountIdentifier;
      };
      return creator.fromHex(trimmed);
    }
    const principal = Principal.fromText(trimmed);
    return this.getAccountIdentifierForPrincipal(principal);
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readIcpConfig();
    if (!config.enabled) {
      return [];
    }

    if (!config.ledgerCanisterId || !config.host) {
      console.warn('⚠️  [ICP] Missing ICP ledger configuration, skipping.');
      return [];
    }

    const supportedTokenTypes = new Set(['NATIVE', 'ICRC1']);
    if (tokenOptions.tokenType && !supportedTokenTypes.has(tokenOptions.tokenType)) {
      console.warn(`⚠️  [ICP] Token type ${tokenOptions.tokenType} not supported, skipping.`);
      return [];
    }

    const contexts = await Promise.all(
      config.supportedTokens
        .filter(token =>
          (!tokenOptions.tokenType || tokenOptions.tokenType === token.tokenType) &&
          (!tokenOptions.tokenSymbol || tokenOptions.tokenSymbol === token.tokenSymbol)
        )
        .map(async token => {
          const metadata =
            token.tokenType === 'ICRC1'
              ? await this.getIcrcMetadata(token.ledgerCanisterId, config, token)
              : {
                  symbol: token.tokenSymbol,
                  decimals: token.tokenDecimals,
                  fee: BigInt(config.transferFeeE8s)
                };

          return {
            adapterType: this.type,
            networkId: token.networkSuffix ? `${config.networkId}-${token.networkSuffix}` : config.networkId,
            networkName: token.tokenType === 'NATIVE' ? config.networkName : `${config.networkName} (${metadata.symbol})`,
            tokenType: token.tokenType,
            tokenSymbol: metadata.symbol,
            tokenDecimals: metadata.decimals,
            tokenAddress: token.ledgerCanisterId,
            nativeTokenSymbol: token.nativeSymbol ?? 'ICP',
            nativeTokenDecimals: DEFAULT_ICP_DECIMALS,
            walletAddress: await this.resolveWalletAddress(config, token),
            defaultGasCostToken:
              token.tokenType === 'NATIVE'
                ? fromBaseUnits(config.transferFeeE8s, token.transferFeeDecimals)
                : fromBaseUnits(metadata.fee, metadata.decimals),
            baseNetworkId: config.networkId
          } satisfies GasTokenNetworkContext;
        })
    );

    return contexts;
  }

  async getTreasuryFundingAddresses(
    context: GasTokenNetworkContext
  ): Promise<IcpTreasuryFundingAddress[] | undefined> {
    if (
      context.tokenSymbol !== 'ckBTC' &&
      context.tokenSymbol !== 'ckETH' &&
      context.tokenSymbol !== 'ckUSDT' &&
      context.tokenSymbol !== 'ckUSDC' &&
      context.tokenSymbol !== 'ckEURC'
    ) {
      return undefined;
    }

    const cacheKey = `${context.networkId}:${context.walletAddress ?? ''}`;
    const cached = this.fundingAddressCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.loadTreasuryFundingAddresses(context).catch(error => {
      this.fundingAddressCache.delete(cacheKey);
      throw error;
    });
    this.fundingAddressCache.set(cacheKey, promise);
    return promise;
  }

  private async loadTreasuryFundingAddresses(
    context: GasTokenNetworkContext
  ): Promise<IcpTreasuryFundingAddress[] | undefined> {
    const config = this.ensureEnabledConfig();
    const principalText = context.walletAddress ?? (await this.resolveWalletAddress(config, { tokenType: 'ICRC1' }));
    const normalizedPrincipal = principalText ? this.normalizePrincipalAddress(principalText) : undefined;
    const receiverPrincipalBytes32 = normalizedPrincipal ? principalToBytes32Hex(normalizedPrincipal) : undefined;

    if (context.tokenSymbol === 'ckBTC') {
      if (!principalText) {
        return undefined;
      }

      const minter = await this.getCkbtcMinter(config);
      const owner = Principal.fromText(this.normalizePrincipalAddress(principalText));
      const btcAddress = await withRetry(
        () => minter.get_btc_address({ owner: [owner], subaccount: [] }),
        { taskName: 'ckBTC get_btc_address' }
      );

      return [
        {
          network: 'Bitcoin',
          label: 'Treasury Bitcoin deposit address',
          address: btcAddress,
          kind: 'btc-deposit',
          note: 'Send BTC here, then call the ckBTC minter update_balance flow to mint ckBTC to the treasury principal.'
        },
        {
          network: 'ICP',
          label: 'Treasury ICP principal',
          address: owner.toText(),
          receiverPrincipal: owner.toText(),
          receiverPrincipalBytes32,
          note: 'This principal receives the minted ckBTC on ICP.'
        }
      ];
    }

    if (!principalText) {
      return undefined;
    }

    const receiverPrincipal = normalizedPrincipal ?? this.normalizePrincipalAddress(principalText);
    const helperContractAddress =
      normalizeEthereumAddress(process.env.ICP_CKETH_HELPER_CONTRACT_ADDRESS) ?? DEFAULT_CKETH_HELPER_CONTRACT_ADDRESS;
    const isStablecoin =
      context.tokenSymbol === 'ckUSDT' ||
      context.tokenSymbol === 'ckUSDC' ||
      context.tokenSymbol === 'ckEURC';
    const token = this.getTokenConfig(config, context);
    const stablecoinContractAddress = normalizeEthereumAddress(token.erc20ContractAddress);

    return [
      {
        network: 'Ethereum',
        label: isStablecoin ? `${context.tokenSymbol} helper contract` : 'ckETH helper contract',
        address: helperContractAddress,
        kind: isStablecoin ? (stablecoinContractAddress ? 'erc20-deposit' : 'manual') : 'eth-deposit',
        receiverPrincipal,
        receiverPrincipalBytes32,
        tokenContractAddress: stablecoinContractAddress,
        note: isStablecoin
          ? stablecoinContractAddress
            ? `Approve the helper contract to spend ${context.tokenSymbol.slice(2)}, then call deposit with the treasury principal as receiver.`
            : `Set ${context.tokenSymbol === 'ckUSDT' ? 'ICP_CKUSDT_ERC20_CONTRACT_ADDRESS' : context.tokenSymbol === 'ckUSDC' ? 'ICP_CKUSDC_ERC20_CONTRACT_ADDRESS' : 'ICP_CKEURC_ERC20_CONTRACT_ADDRESS'} to enable direct browser-wallet deposits.`
          : 'Call the helper contract deposit function on Ethereum and pass the treasury principal as the receiver.'
      },
      {
        network: 'ICP',
        label: 'Treasury ICP principal',
        address: receiverPrincipal,
        receiverPrincipal,
        receiverPrincipalBytes32,
        note: `Use this principal as the ${context.tokenSymbol} receiver when depositing from Ethereum.`
      }
    ];
  }

  private async resolveWalletAddress(
    config: IcpNetworkConfig,
    token?: Pick<IcpTokenConfig, 'tokenType'>
  ): Promise<string | undefined> {
    if (config.walletAddress) {
      try {
        if (token?.tokenType === 'ICRC1') {
          return this.normalizePrincipalAddress(config.walletAddress);
        }
        return Principal.fromText(config.walletAddress.trim()).toText();
      } catch {
        if (token?.tokenType !== 'ICRC1') {
          return config.walletAddress;
        }
      }
    }
    try {
      return (await this.getIdentity()).getPrincipal().toText();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [ICP] Failed to derive wallet address: ${message}`);
      return config.walletAddress;
    }
  }

  async getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
    const config = this.ensureEnabledConfig();
    const token = this.getTokenConfig(config, context);
    const walletAddress = context.walletAddress ?? (await this.resolveWalletAddress(config, token));
    if (!walletAddress) {
      throw new Error('[ICP] Wallet address not configured');
    }

    if (token.tokenType === 'NATIVE') {
      const ledger = await this.getLedger(config);
      const accountIdentifier = this.resolveAccountIdentifier(walletAddress);
      const balance = await withRetry(
        () => ledger.accountBalance({ accountIdentifier }),
        { taskName: 'ICP accountBalance' }
      );
      const balanceValue = balance as unknown as { e8s?: bigint; toE8s?: () => bigint };
      const e8s = balanceValue.toE8s ? balanceValue.toE8s() : balanceValue.e8s ?? BigInt(0);
      return fromBaseUnits(e8s, token.tokenDecimals);
    }

    const actor = await this.getIcrcActor(token.ledgerCanisterId, config);
    const owner = this.resolveOwnerPrincipal(walletAddress);
    const balance = await withRetry(
      () => actor.icrc1_balance_of({ owner, subaccount: [] }),
      { taskName: `${token.tokenSymbol} icrc1_balance_of` }
    );
    return fromBaseUnits(balance, context.tokenDecimals);
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return (user as User & { icpAddress?: string | null }).icpAddress ?? null;
  }

  async estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    try {
      const config = this.ensureEnabledConfig();
      const token = this.getTokenConfig(config, context);
      const amountBaseUnits = toBaseUnits(amountToken, context.tokenDecimals);
      if (amountBaseUnits <= 0n) {
        return { deferReason: 'Transfer amount too small' };
      }
      if (token.tokenType === 'NATIVE') {
        this.resolveAccountIdentifier(recipientAddress);
        return { gasCostToken: fromBaseUnits(config.transferFeeE8s, token.transferFeeDecimals) };
      }

      this.resolveOwnerPrincipal(recipientAddress);
      const actor = await this.getIcrcActor(token.ledgerCanisterId, config);
      const fee = await withRetry(() => actor.icrc1_fee(), { taskName: `${token.tokenSymbol} icrc1_fee` });
      return { gasCostToken: fromBaseUnits(fee, context.tokenDecimals) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ICP estimation error';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    const config = this.ensureEnabledConfig();
    const token = this.getTokenConfig(config, context);
    const amountBaseUnits = toBaseUnits(amountToken, context.tokenDecimals);
    if (amountBaseUnits <= 0n) {
      throw new Error('[ICP] Transfer amount must be greater than zero');
    }

    if (token.tokenType === 'NATIVE') {
      const ledger = await this.getLedger(config);
      const accountIdentifier = this.resolveAccountIdentifier(recipientAddress);
      const amount = amountBaseUnits;
      const fee = BigInt(config.transferFeeE8s);

      const blockHeight = await withRetry(
        () =>
          ledger.transfer({
            to: accountIdentifier,
            amount,
            fee,
            memo: BigInt(0)
          }),
        { taskName: 'ICP transfer' }
      );

      return { transactionHash: String(blockHeight) };
    }

    const actor = await this.getIcrcActor(token.ledgerCanisterId, config);
    const owner = this.resolveOwnerPrincipal(recipientAddress);
    const fee = await withRetry(() => actor.icrc1_fee(), { taskName: `${token.tokenSymbol} icrc1_fee` });
    const result = await withRetry(
      () =>
        actor.icrc1_transfer({
          from_subaccount: [],
          to: { owner, subaccount: [] },
          amount: amountBaseUnits,
          fee: [fee],
          memo: [],
          created_at_time: []
        }),
      { taskName: `${token.tokenSymbol} icrc1_transfer` }
    );

    if (result.Err) {
      throw new Error(`[ICP] ${token.tokenSymbol} transfer failed: ${JSON.stringify(result.Err)}`);
    }

    return { transactionHash: String(result.Ok ?? '') };
  }

  async deriveAddress(privateKey: string): Promise<string> {
    const pem = privateKey.trim().startsWith('-----BEGIN')
      ? privateKey
      : Buffer.from(privateKey, 'base64').toString('utf-8');
    const identity = ed25519IdentityFromPem(pem);
    return identity.getPrincipal().toText();
  }
}

export const icpGasTokenNetworkAdapter = new IcpGasTokenNetworkAdapter();
