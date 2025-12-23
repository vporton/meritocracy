import { PrismaClient } from '@prisma/client';
import type { User } from '@prisma/client';
import type { TokenType } from '../types/token.js';
import { multiNetworkEthereumService } from './MultiNetworkEthereumService.js';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  TokenDistributionOptions
} from './gas-networks/types.js';
import {
  bitcoinGasTokenNetworkAdapter,
  evmGasTokenNetworkAdapter,
  cosmosGasTokenNetworkAdapter,
  polkadotGasTokenNetworkAdapter,
  solanaGasTokenNetworkAdapter,
  stellarGasTokenNetworkAdapter
} from './gas-networks/index.js';
import { systemSecretService } from './SystemSecretService.js';

export interface DistributionFiber {
  userId: number;
  recipientAddress: string;
  amountToken: number;
  shareInGDP: number;
  backlogToken?: number;
}

export interface NetworkDistributionResult {
  networkId: string;
  networkName: string;
  adapterType: string;
  tokenSymbol: string;
  tokenType: TokenType;
  tokenDecimals: number;
  distributedAmount: number;
  reservedAmount: number;
  distributions: Array<{
    userId: number;
    amount: number;
    status: 'SENT' | 'DEFERRED' | 'FAILED';
    transactionHash?: string;
    errorMessage?: string;
    gasCostToken?: number;
  }>;
  errors: string[];
  distributed?: number;
  reserved?: number;
}

export interface MultiNetworkDistributionResult {
  success: boolean;
  totalDistributedAmount: number;
  totalReservedAmount: number;
  networkResults: Map<string, NetworkDistributionResult>;
  errors: string[];
  totalDistributed?: number;
  totalReserved?: number;
}

type ReserveStatusEntry = {
  tokenSymbol: string;
  tokenType: TokenType;
  tokenDecimals: number;
  nativeTokenSymbol: string;
  totalReserve: number;
  walletBalance: number;
  availableForDistribution: number;
  lastDistribution: Date | null;
  adapterType: string;
  networkName: string;
  name?: string;
  chainId?: number;
  address?: string;
  balance?: string;
  gasPrice?: string;
  balanceFormatted?: string;
  gasPriceFormatted?: string;
};

type AdapterContextEntry = {
  adapter: GasTokenNetworkAdapter;
  context: GasTokenNetworkContext;
};

export class MultiNetworkGasTokenDistributionService {
  private prisma: PrismaClient;
  private readonly GAS_COST_VALUE_MULTIPLIER = 5;
  private readonly defaultTokenOptions: TokenDistributionOptions;
  private readonly networkAdapters: GasTokenNetworkAdapter[];
  private contextCache: Map<string, { entries: Map<string, AdapterContextEntry>; timestamp: number }> = new Map();
  private contextPromises: Map<string, Promise<Map<string, AdapterContextEntry>>> = new Map();
  private readonly CONTEXT_TTL = 5 * 60 * 1000; // 5 minutes

  // Cache for network status to coalesce parallel requests from frontend
  private statusCache: Map<string, { entry: ReserveStatusEntry; timestamp: number }> = new Map();
  private statusPromises: Map<string, Promise<ReserveStatusEntry | undefined>> = new Map();
  private readonly STATUS_TTL = 10 * 1000; // 10 seconds

  constructor(
    prisma: PrismaClient,
    adapters?: GasTokenNetworkAdapter[],
    defaultTokenOptions?: TokenDistributionOptions
  ) {
    this.prisma = prisma;
    this.networkAdapters =
      adapters ??
      [
        evmGasTokenNetworkAdapter,
        solanaGasTokenNetworkAdapter,
        bitcoinGasTokenNetworkAdapter,
        cosmosGasTokenNetworkAdapter,
        polkadotGasTokenNetworkAdapter,
        stellarGasTokenNetworkAdapter
      ];

    this.defaultTokenOptions = {
      tokenType: defaultTokenOptions?.tokenType ?? 'NATIVE'
    };

    this.warmupAdapters();
  }

  private warmupAdapters(): void {
    void this.collectNetworkAdapterContexts(this.defaultTokenOptions).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [MultiNetwork] Adapter warmup failed: ${message}`);
    });
  }

  private async collectNetworkAdapterContexts(
    tokenOptions: TokenDistributionOptions
  ): Promise<Map<string, AdapterContextEntry>> {
    const cacheKey = JSON.stringify(tokenOptions) + ':v2';
    const now = Date.now();
    const cached = this.contextCache.get(cacheKey);

    if (cached && (now - cached.timestamp < this.CONTEXT_TTL)) {
      return cached.entries;
    }

    const inProgress = this.contextPromises.get(cacheKey);
    if (inProgress) {
      return inProgress;
    }

    const promise = (async () => {
      const contextEntries = new Map<string, AdapterContextEntry>();
      console.log(`🔍 [MultiNetwork] Refreshing adapter contexts for ${cacheKey}...`);

      for (const adapter of this.networkAdapters) {
        let contexts: GasTokenNetworkContext[] = [];
        try {
          contexts = await adapter.getNetworkContexts(tokenOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Failed to load contexts for adapter ${adapter.type}: ${message}`);
          continue;
        }

        for (const context of contexts) {
          if (tokenOptions.country) {
            const secret = await systemSecretService.getCountrySecret(context.networkId, tokenOptions.country);

            let finalWalletAddress = 'ADDRESS-NOT-RESOLVED';
            let finalPrivateKey: string | undefined = undefined;

            if (secret) {
              finalPrivateKey = secret.trim();
              // Try to derive specific address if adapter supports it
              if (adapter.deriveAddress) {
                try {
                  const derived = await adapter.deriveAddress(finalPrivateKey);
                  finalWalletAddress = derived;
                } catch (e) {
                  console.error(`Derivation failed for ${context.networkId} (${tokenOptions.country}):`, e);
                  finalWalletAddress = 'DERIVATION-FAILED';
                }
              } else {
                finalWalletAddress = 'DERIVE-NOT-SUPPORTED';
              }
            } else {
              console.warn(`[MultiNetwork] No secret found for ${context.networkId} / ${tokenOptions.country}`);
              finalWalletAddress = 'SECRET-MISSING-DB';
            }

            const newNetworkId = `${context.networkId}-${tokenOptions.country}`;
            contextEntries.set(newNetworkId, {
              adapter,
              context: {
                ...context,
                networkId: newNetworkId,
                networkName: `${context.networkName} (${tokenOptions.country})`,
                country: tokenOptions.country,
                privateKey: finalPrivateKey,
                walletAddress: finalWalletAddress
              }
            });
          } else {
            // Global
            contextEntries.set(context.networkId, { adapter, context });
          }
        }
      }

      console.log(`✅ [MultiNetwork] Loaded ${contextEntries.size} network contexts.`);
      this.contextCache.set(cacheKey, { entries: contextEntries, timestamp: Date.now() });
      return contextEntries;
    })().finally(() => {
      this.contextPromises.delete(cacheKey);
    });

    this.contextPromises.set(cacheKey, promise);
    return promise;
  }

  public clearContextCache(): void {
    this.contextCache.clear();
    console.log('🧹 [MultiNetwork] Context cache cleared.');
  }

  private resolveTokenOptions(overrides?: TokenDistributionOptions): TokenDistributionOptions {
    return {
      tokenType: overrides?.tokenType ?? this.defaultTokenOptions.tokenType,
      country: overrides?.country
    };
  }

  private async fetchEligibleUsers(): Promise<User[]> {
    return await this.prisma.user.findMany({
      where: {
        onboarded: true,
        shareInGDP: { not: null }
      },
      orderBy: {
        shareInGDP: 'desc'
      }
    });
  }

  private async getTokenReserve(context: GasTokenNetworkContext): Promise<number> {
    const reserve = await this.prisma.gasTokenReserve.findUnique({
      where: {
        network_tokenSymbol_tokenType: {
          network: context.networkId,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType
        }
      }
    });
    return reserve ? Number(reserve.totalReserve) : 0;
  }

  private async updateGasTokenReserve(context: GasTokenNetworkContext, amount: number): Promise<void> {
    await this.prisma.gasTokenReserve.upsert({
      where: {
        network_tokenSymbol_tokenType: {
          network: context.networkId,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType
        }
      },
      update: {
        totalReserve: amount,
        lastDistribution: new Date(),
        tokenDecimals: context.tokenDecimals
      },
      create: {
        network: context.networkId,
        totalReserve: amount,
        lastDistribution: new Date(),
        tokenType: context.tokenType,
        tokenSymbol: context.tokenSymbol,
        tokenDecimals: context.tokenDecimals
      }
    });
  }

  private async calculateDistributions(
    tokenOptions: TokenDistributionOptions
  ): Promise<
    Map<
      string,
      {
        adapter: GasTokenNetworkAdapter;
        context: GasTokenNetworkContext;
        distributions: DistributionFiber[];
      }
    >
  > {
    const users = await this.fetchEligibleUsers();
    if (users.length === 0) {
      return new Map();
    }

    const networkDistributions = new Map<
      string,
      {
        adapter: GasTokenNetworkAdapter;
        context: GasTokenNetworkContext;
        distributions: DistributionFiber[];
      }
    >();

    for (const adapter of this.networkAdapters) {
      let contexts: GasTokenNetworkContext[] = [];
      try {
        contexts = await adapter.getNetworkContexts(tokenOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to load contexts for adapter ${adapter.type}: ${message}`);
        continue;
      }

      for (const originalContext of contexts) {
        // Prepare list of contexts to process (Global + Countries)
        const contextsToProcess: Array<{ context: GasTokenNetworkContext; userFilter?: (u: User) => boolean }> = [
          { context: originalContext } // Global
        ];

        // Identify countries with specific funds
        const distinctCountries = [...new Set(users.map(u => u.residenceCountry).filter(c => c))];
        for (const country of distinctCountries) {
          const countrySecret = await systemSecretService.getCountrySecret(originalContext.networkId, country!);
          if (countrySecret) {
            contextsToProcess.push({
              context: {
                ...originalContext,
                networkId: `${originalContext.networkId}-${country}`,
                networkName: `${originalContext.networkName} (${country})`,
                privateKey: countrySecret,
                country: country!
              },
              userFilter: (u) => u.residenceCountry === country
            });
          }
        }

        for (const { context, userFilter } of contextsToProcess) {
          const eligibleUsers = users.filter(user => {
            if (userFilter && !userFilter(user)) return false;

            const share = user.shareInGDP ?? 0;
            const address = adapter.getRecipientAddress(user);
            return share > 0 && !!address;
          });

          const totalShare = eligibleUsers.reduce((sum, user) => sum + (user.shareInGDP ?? 0), 0);
          if (eligibleUsers.length === 0 || totalShare <= 0) {
            // Only warn for Global, country specific might be empty mostly
            if (!context.country) {
              console.warn(
                `⚠️  No eligible recipients found for ${context.networkName} (${context.adapterType}).`
              );
            }
            networkDistributions.set(context.networkId, {
              adapter,
              context,
              distributions: []
            });
            continue;
          }

          let walletBalance = 0;
          try {
            walletBalance = await adapter.getWalletBalance(context);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error(
              `❌ Failed to read wallet balance for ${context.networkName} (${context.adapterType}): ${message}`
            );
            networkDistributions.set(context.networkId, {
              adapter,
              context,
              distributions: []
            });
            continue;
          }

          const currentReserve = await this.getTokenReserve(context);
          const spendableFromWallet = Math.max(0, walletBalance);
          const totalAvailable = spendableFromWallet + currentReserve;

          if (totalAvailable <= 0) {
            // Only warn for Global, country funds naturally empty often
            if (!context.country) {
              console.warn(
                `⚠️  No ${context.tokenSymbol} funds available for distribution on ${context.networkName}`
              );
            }
            networkDistributions.set(context.networkId, {
              adapter,
              context,
              distributions: []
            });
            continue;
          }

          const distributions: DistributionFiber[] = eligibleUsers.map(user => {
            const share = user.shareInGDP ?? 0;
            const proportion = share / totalShare;
            const recipientAddress = adapter.getRecipientAddress(user);

            return {
              userId: user.id,
              recipientAddress: recipientAddress!,
              amountToken: proportion > 0 ? spendableFromWallet * proportion : 0,
              shareInGDP: share
            };
          });

          const deferredRows = await this.prisma.gasTokenDistribution.findMany({
            where: {
              network: context.networkId,
              tokenSymbol: context.tokenSymbol,
              tokenType: context.tokenType,
              status: 'DEFERRED'
            },
            select: {
              userId: true,
              amount: true
            }
          });
          const backlogLookup = new Map<number, number>();
          for (const row of deferredRows) {
            const previous = backlogLookup.get(row.userId) ?? 0;
            backlogLookup.set(row.userId, previous + Number(row.amount));
          }

          for (const dist of distributions) {
            dist.backlogToken = backlogLookup.get(dist.userId) ?? 0;
            dist.amountToken += dist.backlogToken;
          }

          const filtered = distributions.filter(dist => dist.amountToken > 0);
          filtered.sort((a, b) => b.amountToken - a.amountToken);

          networkDistributions.set(context.networkId, {
            adapter,
            context,
            distributions: filtered
          });
        }
      }
    }

    return networkDistributions;
  }

  private buildGasCostMessage(
    context: GasTokenNetworkContext,
    gasCostToken: number,
    amountToken: number
  ): string {
    const minimumRequired = gasCostToken * this.GAS_COST_VALUE_MULTIPLIER;
    return `Transfer amount ${amountToken.toFixed(6)} ${context.tokenSymbol} must exceed ${minimumRequired.toFixed(
      6
    )} ${context.tokenSymbol} to stay ${this.GAS_COST_VALUE_MULTIPLIER}x above the estimated gas cost (${gasCostToken.toFixed(
      6
    )} ${context.tokenSymbol})`;
  }

  private async processNetworkDistribution(
    adapter: GasTokenNetworkAdapter,
    context: GasTokenNetworkContext,
    distributions: DistributionFiber[]
  ): Promise<NetworkDistributionResult> {
    const result: NetworkDistributionResult = {
      networkId: context.networkId,
      networkName: context.networkName,
      adapterType: context.adapterType,
      tokenSymbol: context.tokenSymbol,
      tokenType: context.tokenType,
      tokenDecimals: context.tokenDecimals,
      distributedAmount: 0,
      reservedAmount: 0,
      distributions: [],
      errors: []
    };

    console.log(
      `🔄 Processing ${distributions.length} ${context.tokenSymbol} distributions on ${context.networkName} (${context.adapterType})...`
    );

    let remainingAmount = distributions.reduce((sum, dist) => sum + dist.amountToken, 0);

    for (const dist of distributions) {
      try {
        if (remainingAmount <= 0) {
          break;
        }

        if (dist.amountToken > remainingAmount) {
          dist.amountToken = remainingAmount;
        }

        let gasCostToken: number | undefined;
        let estimationError: string | undefined;
        let shouldStopDueToGasCost = false;
        let totalCostToken = dist.amountToken;

        let estimate: GasTransferEstimate | undefined;
        try {
          estimate = await adapter.estimateTransfer(
            context,
            dist.recipientAddress,
            dist.amountToken
          );
        } catch (error) {
          estimationError = error instanceof Error ? error.message : 'Failed to estimate gas cost';
        }

        if (estimate?.gasCostToken !== undefined) {
          gasCostToken = estimate.gasCostToken;
          const totalRequired = dist.amountToken + gasCostToken;
          if (totalRequired > remainingAmount + Number.EPSILON) {
            const adjustedAmount = Math.max(0, remainingAmount - gasCostToken);
            if (adjustedAmount <= 0) {
              estimationError = `Insufficient ${context.tokenSymbol} to cover gas cost of ${gasCostToken.toFixed(
                6
              )} ${context.tokenSymbol}`;
              shouldStopDueToGasCost = true;
            } else {
              dist.amountToken = adjustedAmount;
            }
          }

          const minimumRequired = gasCostToken * this.GAS_COST_VALUE_MULTIPLIER;
          if (!estimationError && dist.amountToken <= minimumRequired) {
            estimationError = this.buildGasCostMessage(context, gasCostToken, dist.amountToken);
            shouldStopDueToGasCost = true;
          }

          totalCostToken = dist.amountToken + gasCostToken;
        } else {
          totalCostToken = dist.amountToken;
        }

        if (estimate?.deferReason) {
          estimationError = estimate.deferReason;
        }

        if (estimationError) {
          result.reservedAmount += dist.amountToken;

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkId,
              amount: dist.amountToken,
              amountUsd: 0,
              status: 'DEFERRED',
              errorMessage: estimationError,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            status: 'DEFERRED',
            errorMessage: estimationError,
            gasCostToken
          });

          console.log(
            `⏳ [${context.networkName}] Deferred distribution for user ${dist.userId}: ${estimationError}`
          );
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);
          if (shouldStopDueToGasCost) {
            console.log(
              `🛑 [${context.networkName}] Halting further distributions due to gas cost threshold.`
            );
            break;
          }
          continue;
        }

        try {
          const transferResult = await adapter.sendTransfer(
            context,
            dist.recipientAddress,
            dist.amountToken
          );

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkId,
              amount: dist.amountToken,
              amountUsd: 0,
              status: 'SENT',
              transactionHash: transferResult.transactionHash,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            status: 'SENT',
            transactionHash: transferResult.transactionHash,
            gasCostToken
          });

          result.distributedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - totalCostToken);

          const gasInfo =
            gasCostToken !== undefined
              ? ` (gas ${gasCostToken.toFixed(6)} ${context.tokenSymbol})`
              : '';
          console.log(
            `✅ [${context.networkName}] Sent ${dist.amountToken.toFixed(6)} ${context.tokenSymbol} to user ${dist.userId}${gasInfo}`
          );
        } catch (error) {
          result.reservedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkId,
              amount: dist.amountToken,
              amountUsd: 0,
              status: 'FAILED',
              errorMessage,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            status: 'FAILED',
            errorMessage,
            gasCostToken
          });

          const message = `Failed to send to user ${dist.userId}: ${errorMessage}`;
          result.errors.push(message);
          console.error(`❌ [${context.networkName}] ${message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error processing user ${dist.userId}: ${errorMessage}`);
        console.error(
          `❌ [${context.networkName}] Error processing user ${dist.userId}: ${errorMessage}`
        );
      }
    }

    const currentReserve = await this.getTokenReserve(context);
    const newReserve = currentReserve + result.reservedAmount;
    await this.updateGasTokenReserve(context, newReserve);

    console.log(
      `📊 [${context.networkName}] Distribution completed: ${result.distributedAmount.toFixed(
        6
      )} ${context.tokenSymbol} distributed, ${result.reservedAmount.toFixed(
        6
      )} ${context.tokenSymbol} reserved`
    );

    return {
      ...result,
      distributed: result.distributedAmount,
      reserved: result.reservedAmount
    };
  }

  async processMultiNetworkDistribution(
    overrides?: Partial<TokenDistributionOptions>
  ): Promise<MultiNetworkDistributionResult> {
    const tokenOptions = this.resolveTokenOptions(overrides);
    console.log('🔄 Starting multi-network gas token distribution...');

    try {
      const networkDistributions = await this.calculateDistributions(tokenOptions);
      const networkResults = new Map<string, NetworkDistributionResult>();
      let totalDistributedAmount = 0;
      let totalReservedAmount = 0;
      const errors: string[] = [];

      const networkPromises = Array.from(networkDistributions.entries()).map(
        async ([networkId, payload]) => {
          const { adapter, context, distributions } = payload;

          try {
            if (distributions.length === 0) {
              networkResults.set(networkId, {
                networkId: context.networkId,
                networkName: context.networkName,
                adapterType: context.adapterType,
                tokenSymbol: context.tokenSymbol,
                tokenType: context.tokenType,
                tokenDecimals: context.tokenDecimals,
                distributedAmount: 0,
                reservedAmount: 0,
                distributions: [],
                errors: [],
                distributed: 0,
                reserved: 0
              });
              return;
            }

            const networkResult = await this.processNetworkDistribution(
              adapter,
              context,
              distributions
            );
            networkResults.set(networkId, networkResult);
            totalDistributedAmount += networkResult.distributedAmount;
            totalReservedAmount += networkResult.reservedAmount;

            errors.push(
              ...networkResult.errors.map(error => `[${context.networkName}] ${error}`)
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`[${context.networkName}] Fatal error: ${errorMessage}`);
            console.error(`💥 [${context.networkName}] Fatal error:`, errorMessage);
          }
        }
      );

      await Promise.all(networkPromises);

      const result: MultiNetworkDistributionResult = {
        success: errors.length === 0,
        totalDistributedAmount,
        totalReservedAmount,
        totalDistributed: totalDistributedAmount,
        totalReserved: totalReservedAmount,
        networkResults,
        errors
      };

      console.log('📊 Multi-network gas token distribution completed:');
      console.log(`  💰 Total distributed: ${totalDistributedAmount.toFixed(6)} tokens`);
      console.log(`  🏦 Total reserved: ${totalReservedAmount.toFixed(6)} tokens`);

      for (const [, networkResult] of networkResults) {
        console.log(
          `  🌐 [${networkResult.networkName}]: ${networkResult.distributedAmount.toFixed(
            6
          )} ${networkResult.tokenSymbol} distributed, ${networkResult.reservedAmount.toFixed(
            6
          )} ${networkResult.tokenSymbol} reserved`
        );
        console.log(
          `    ✅ Successful: ${networkResult.distributions.filter(d => d.status === 'SENT').length
          }`
        );
        console.log(
          `    ⏳ Deferred: ${networkResult.distributions.filter(d => d.status === 'DEFERRED').length
          }`
        );
        console.log(
          `    ❌ Failed: ${networkResult.distributions.filter(d => d.status === 'FAILED').length
          }`
        );
      }

      if (errors.length > 0) {
        console.log('⚠️  Errors occurred:');
        errors.forEach(error => console.log(`  - ${error}`));
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('💥 Fatal error in multi-network gas token distribution:', errorMessage);

      return {
        success: false,
        totalDistributedAmount: 0,
        totalReservedAmount: 0,
        totalDistributed: 0,
        totalReserved: 0,
        networkResults: new Map(),
        errors: [errorMessage]
      };
    }
  }

  async getUserDistributionHistory(userId: number) {
    return await this.prisma.gasTokenDistribution.findMany({
      where: { userId },
      orderBy: { distributionDate: 'desc' }
    });
  }

  async getNetworkDistributionHistory(networkId: string) {
    return await this.prisma.gasTokenDistribution.findMany({
      where: { network: networkId },
      include: {
        user: true
      },
      orderBy: { distributionDate: 'desc' }
    });
  }

  async getAllDistributionHistory() {
    return await this.prisma.gasTokenDistribution.findMany({
      include: {
        user: true
      },
      orderBy: { distributionDate: 'desc' }
    });
  }

  async getReserveStatus(
    overrides?: Partial<TokenDistributionOptions>,
    contextEntries?: Map<string, AdapterContextEntry>
  ) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const contexts = contextEntries ?? (await this.collectNetworkAdapterContexts(tokenOptions));
    const reserveStatus = new Map<string, ReserveStatusEntry>();

    for (const [networkId, entry] of contexts.entries()) {
      const status = await this.getSingleNetworkReserveStatus(networkId, entry);
      reserveStatus.set(networkId, status);
    }

    return reserveStatus;
  }

  async getSingleNetworkReserveStatus(
    networkId: string,
    entry: AdapterContextEntry
  ): Promise<ReserveStatusEntry> {
    const { adapter, context } = entry;
    const reserveRow = await this.prisma.gasTokenReserve.findUnique({
      where: {
        network_tokenSymbol_tokenType: {
          network: context.networkId,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType
        }
      }
    });

    let walletBalance = 0;
    try {
      walletBalance = await adapter.getWalletBalance(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(
        `⚠️  Failed to read wallet balance for reserve status on ${context.networkName}: ${message}`
      );
    }

    const reserveAmount = reserveRow ? Number(reserveRow.totalReserve) : 0;
    const availableForDistribution = walletBalance + reserveAmount;

    return {
      tokenSymbol: context.tokenSymbol,
      tokenType: context.tokenType,
      tokenDecimals: context.tokenDecimals,
      nativeTokenSymbol: context.nativeTokenSymbol,
      totalReserve: reserveAmount,
      walletBalance,
      availableForDistribution,
      lastDistribution: reserveRow?.lastDistribution ?? null,
      adapterType: context.adapterType,
      networkName: context.networkName,
      address: context.walletAddress
    };
  }

  async getSingleNetworkStatus(
    networkId: string,
    overrides?: Partial<TokenDistributionOptions>
  ): Promise<ReserveStatusEntry | undefined> {
    const cacheKey = `${networkId}:${JSON.stringify(overrides || {})}`;
    const now = Date.now();
    const cached = this.statusCache.get(cacheKey);

    if (cached && (now - cached.timestamp < this.STATUS_TTL)) {
      return cached.entry;
    }

    const inProgress = this.statusPromises.get(cacheKey);
    if (inProgress) {
      return inProgress;
    }

    const promise = (async () => {
      try {
        const result = await this.fetchSingleNetworkStatusDirectly(networkId, overrides);
        if (result) {
          this.statusCache.set(cacheKey, { entry: result, timestamp: Date.now() });
        }
        return result;
      } finally {
        this.statusPromises.delete(cacheKey);
      }
    })();

    this.statusPromises.set(cacheKey, promise);
    return promise;
  }

  private async fetchSingleNetworkStatusDirectly(
    networkId: string,
    overrides?: Partial<TokenDistributionOptions>
  ): Promise<ReserveStatusEntry | undefined> {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const contexts = await this.collectNetworkAdapterContexts(tokenOptions);

    let lookupKey = networkId;
    if (tokenOptions.country && !networkId.endsWith(`-${tokenOptions.country}`)) {
      lookupKey = `${networkId}-${tokenOptions.country}`;
    }
    const entry = contexts.get(lookupKey);
    if (!entry) return undefined;

    const { adapter, context } = entry;

    // 1. Get info from DB
    const reserveRow = await this.prisma.gasTokenReserve.findUnique({
      where: {
        network_tokenSymbol_tokenType: {
          network: context.networkId,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType
        }
      }
    });

    const reserveAmount = reserveRow ? Number(reserveRow.totalReserve) : 0;
    const lastDistribution = reserveRow?.lastDistribution ?? null;

    // 2. Initial status state
    let status: ReserveStatusEntry = {
      tokenSymbol: context.tokenSymbol,
      tokenType: context.tokenType,
      tokenDecimals: context.tokenDecimals,
      nativeTokenSymbol: context.nativeTokenSymbol,
      totalReserve: reserveAmount,
      walletBalance: 0,
      availableForDistribution: reserveAmount,
      lastDistribution,
      adapterType: context.adapterType,
      networkName: context.networkName,
      address: context.walletAddress
    };

    // 3. Supplement with live blockchain info (One batch of calls if possible)
    if (adapter.type === 'EVM') {
      try {
        const info = await multiNetworkEthereumService.getNetworkInfo(networkId);
        if (info) {
          const walletBalanceEth = Number(multiNetworkEthereumService.formatUnits(info.balance, context.tokenDecimals));
          status = {
            ...status,
            name: info.name,
            chainId: info.chainId,
            address: info.address,
            balance: info.balance.toString(),
            gasPrice: info.gasPrice.toString(),
            walletBalance: walletBalanceEth,
            availableForDistribution: reserveAmount + walletBalanceEth,
            balanceFormatted: multiNetworkEthereumService.formatEther(info.balance),
            gasPriceFormatted: multiNetworkEthereumService.formatEther(info.gasPrice)
          };
        }
      } catch (error) {
        console.error(`Failed to get live EVM info for ${networkId}:`, error);
      }
    } else {
      // Non-EVM adapters
      try {
        const walletBalance = await adapter.getWalletBalance(context);
        status.walletBalance = walletBalance;
        status.availableForDistribution = reserveAmount + walletBalance;
      } catch (error) {
        console.warn(`⚠️  Failed to read wallet balance for ${context.networkName}:`, error);
      }
    }

    // 4. Apply formatting and gas estimates if still missing
    if (!status.balanceFormatted) {
      status.balanceFormatted = Number.isFinite(status.walletBalance)
        ? adapter.formatAmount(context, status.walletBalance)
        : 'N/A';
    }

    if (!status.gasPriceFormatted || status.gasPriceFormatted === 'N/A') {
      const estimatedGasCost = await this.estimateNetworkGasCost(adapter, context);
      if (estimatedGasCost !== undefined) {
        status.gasPrice = estimatedGasCost.toString();
        status.gasPriceFormatted = adapter.formatAmount(context, estimatedGasCost);
      } else {
        status.gasPrice ??= 'N/A';
        status.gasPriceFormatted ??= 'N/A';
      }
    }

    return status;
  }

  async getEnabledNetworks(overrides?: Partial<TokenDistributionOptions>) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const contextEntries = await this.collectNetworkAdapterContexts(tokenOptions);

    return Array.from(contextEntries.values()).map(entry => ({
      networkId: entry.context.networkId,
      networkName: entry.context.networkName,
      adapterType: entry.context.adapterType,
      walletAddress: entry.context.walletAddress
    }));
  }

  async getNetworkStatus(overrides?: Partial<TokenDistributionOptions>) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const contextEntries = await this.collectNetworkAdapterContexts(tokenOptions);

    // Get reserve info for all networks
    const status = await this.getReserveStatus(overrides, contextEntries);

    // Supplementary info from EVM (Batch fetch)
    try {
      const networkInfo = await multiNetworkEthereumService.getAllNetworkInfo();

      // Iterate over all active status entries (which might include country suffixes)
      for (const [contextKey, reserve] of status.entries()) {
        // Resolve base network ID by stripping known suffix format if present
        // Or simpler: iterate networkInfo and check if contextKey starts with networkId

        let matchedInfo: { name: string; chainId: number; address: string; balance: bigint; gasPrice: bigint } | undefined;

        for (const [baseNetworkId, info] of networkInfo) {
          if (contextKey === baseNetworkId || contextKey.startsWith(`${baseNetworkId}-`)) {
            matchedInfo = info;
            break;
          }
        }

        if (!matchedInfo) continue;

        const info = matchedInfo;
        const walletBalanceEth = Number(multiNetworkEthereumService.formatUnits(info.balance, reserve.tokenDecimals));

        // NOTE: We do NOT overwrite 'address' here with info.address (which is the Global address from EVM service), 
        // because reserve.address might be the country specific address we just derived.
        // However, we DO want gasPrice.
        // Balance comes from info.balance? No, info.balance is GLOBAL balance.
        // Is info.balance global?
        // multiNetworkEthereumService.getAllNetworkInfo uses getBalance(this.getAddress()).
        // this.getAddress() is global.
        // So info.balance is WRONG for country context.

        // But wait! getReserveStatus calls getSingleNetworkReserveStatus -> calls adapter.getWalletBalance -> calls service.getTokenBalance
        // service.getTokenBalance uses context.walletAddress.
        // So 'reserve.walletBalance' is ALREADY CORRECT (Country Balance).

        // So we should NOT overwrite balance/walletBalance with info.balance.
        // We SHOULD overwrite gasPrice, chainId, name.

        status.set(contextKey, {
          ...reserve,
          name: info.name,
          chainId: info.chainId,
          // address: info.address, // Keep existing (country) address
          // balance: info.balance.toString(), // Keep existing (country) balance
          // walletBalance: walletBalanceEth, // Keep existing (country) balance
          gasPrice: info.gasPrice.toString(),
          // availableForDistribution: reserve.totalReserve + walletBalanceEth, // Keep calculated
          // balanceFormatted: multiNetworkEthereumService.formatEther(info.balance), // Keep existing
          gasPriceFormatted: multiNetworkEthereumService.formatEther(info.gasPrice)
        });
      }
    } catch (error) {
      console.error('Failed to get EVM network status:', error);
    }

    // Now fill in non-EVM or missing data
    for (const [networkId, entryData] of contextEntries.entries()) {
      const { adapter, context } = entryData;
      let entry = status.get(networkId);

      if (!entry) {
        continue;
      }

      // If it's not EVM, and we don't have a wallet balance yet (getReserveStatus already hit WALLET balancer for non-EVM?)
      // Wait, let's check getReserveStatus. It calls getSingleNetworkReserveStatus.
      // And getSingleNetworkReserveStatus calls adapter.getWalletBalance.
      // So for non-EVM, it's ALREADY populated.
      // For EVM, we just updated it above with the batch info from getAllNetworkInfo.

      let gasPrice = entry.gasPrice;
      let gasPriceFormatted = entry.gasPriceFormatted;

      const needsGasEstimate =
        context.adapterType !== 'EVM' &&
        (!gasPriceFormatted || gasPriceFormatted === 'N/A' || gasPriceFormatted === undefined);

      if (needsGasEstimate) {
        const estimatedGasCost = await this.estimateNetworkGasCost(adapter, context);
        if (estimatedGasCost !== undefined) {
          gasPrice = estimatedGasCost.toString();
          gasPriceFormatted = adapter.formatAmount(context, estimatedGasCost);
        } else {
          gasPrice ??= 'N/A';
          gasPriceFormatted ??= 'N/A';
        }
      }

      status.set(networkId, {
        ...entry,
        name: entry.name ?? context.networkName,
        address: entry.address ?? context.walletAddress,
        gasPrice,
        gasPriceFormatted
      });
    }

    for (const [networkId, entry] of status.entries()) {
      const walletBalance = entry.walletBalance ?? 0;
      const decimals = entry.tokenDecimals ?? 0;
      const fallbackBalance = Number.isFinite(walletBalance)
        ? walletBalance.toString()
        : undefined;
      const fallbackFormatted = Number.isFinite(walletBalance)
        ? walletBalance.toLocaleString('en-US', { maximumFractionDigits: decimals })
        : undefined;
      const fallbackGasPrice =
        entry.gasPrice ??
        (entry.gasPriceFormatted && entry.gasPriceFormatted !== 'N/A'
          ? entry.gasPriceFormatted
          : undefined);
      const fallbackGasPriceFormatted =
        entry.gasPriceFormatted ?? (fallbackGasPrice ?? 'N/A');

      status.set(networkId, {
        ...entry,
        name: (entry as unknown as { name?: string }).name ?? entry.networkName ?? networkId,
        chainId: (entry as unknown as { chainId?: number }).chainId ?? undefined,
        address: (entry as unknown as { address?: string }).address ?? entry.address ?? undefined,
        balance: (entry as unknown as { balance?: string }).balance ?? fallbackBalance,
        gasPrice: (entry as unknown as { gasPrice?: string }).gasPrice ?? fallbackGasPrice,
        balanceFormatted:
          (entry as unknown as { balanceFormatted?: string | null }).balanceFormatted ??
          fallbackFormatted,
        gasPriceFormatted:
          (entry as unknown as { gasPriceFormatted?: string }).gasPriceFormatted ??
          fallbackGasPriceFormatted
      });
    }

    return status;
  }

  private async estimateNetworkGasCost(
    adapter: GasTokenNetworkAdapter,
    context: GasTokenNetworkContext
  ): Promise<number | undefined> {
    const defaultGasCost = context.defaultGasCostToken;
    const baseAmount = Math.max(1 / 10 ** context.tokenDecimals, Number.EPSILON);
    const attemptAmounts = [baseAmount, baseAmount * 10];
    const recipientAddress =
      context.walletAddress ??
      (context.adapterType === 'BITCOIN' ? '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' : undefined);

    if (!recipientAddress) {
      return undefined;
    }

    for (const amountToken of attemptAmounts) {
      try {
        const estimate = await adapter.estimateTransfer(context, recipientAddress, amountToken);
        if (estimate?.gasCostToken !== undefined) {
          return estimate.gasCostToken;
        }
        if (!estimate?.deferReason) {
          break;
        }
        if (!estimate.deferReason.toLowerCase().includes('too small')) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(
          `⚠️  Failed to estimate gas cost for ${context.networkName} (${context.adapterType}): ${message}`
        );
        break;
      }
    }

    return defaultGasCost;
  }
}

// Export singleton instance
export const multiNetworkGasTokenDistributionService = new MultiNetworkGasTokenDistributionService(new PrismaClient());
export default MultiNetworkGasTokenDistributionService;
