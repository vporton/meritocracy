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
import emailService from './EmailService.js';
import { pendingTransactionService } from './PendingTransactionService.js';

export interface DistributionFiber {
  userId: number;
  recipientAddress: string;
  amountToken: number;
  shareInGDP: number;
  backlogAmount: number;
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
  errors: string[];
  distributed?: number;
  reserved?: number;
}

export interface MultiNetworkDistributionResult {
  totalDistributedAmount: number;
  totalReservedAmount: number;
  networkResults: Map<string, NetworkDistributionResult>;
  errors: string[];
  totalDistributed: number;
  totalReserved: number;
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
  private readonly STATUS_TTL = 100 * 1000; // 100 seconds

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
    const cacheKey = JSON.stringify(tokenOptions) + ':v3';
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

      // If no specific country is requested, we include all countries that have onboarded users
      let countriesToInclude: string[] = [];
      if (tokenOptions.country) {
        countriesToInclude = [tokenOptions.country];
      } else {
        const usersWithCountry = await this.prisma.user.findMany({
          where: { residenceCountry: { not: null }, onboarded: true },
          select: { residenceCountry: true },
          distinct: ['residenceCountry']
        });
        countriesToInclude = usersWithCountry.map(u => u.residenceCountry!);
      }

      for (const adapter of this.networkAdapters) {
        let baseContexts: GasTokenNetworkContext[] = [];
        try {
          baseContexts = await adapter.getNetworkContexts(tokenOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Failed to load contexts for adapter ${adapter.type}: ${message}`);
          continue;
        }

        for (const context of baseContexts) {
          // Add Global context (only if we are not restricted to a specific country)
          if (!tokenOptions.country) {
            contextEntries.set(context.networkId, { adapter, context });
          }

          // Add Country contexts
          for (const country of countriesToInclude) {
            try {
              const secret = await systemSecretService.ensureCountrySecret(context.networkId, country);

              let finalWalletAddress = 'ADDRESS-NOT-RESOLVED';
              let finalPrivateKey: string | undefined = undefined;

              if (secret) {
                finalPrivateKey = secret.trim();
                if (adapter.deriveAddress) {
                  try {
                    finalWalletAddress = await adapter.deriveAddress(finalPrivateKey);
                  } catch (e) {
                    console.error(`Derivation failed for ${context.networkId} (${country}):`, e);
                    finalWalletAddress = 'DERIVATION-FAILED';
                  }
                } else {
                  finalWalletAddress = 'DERIVE-NOT-SUPPORTED';
                }
              } else {
                finalWalletAddress = 'SECRET-MISSING-DB';
              }

              const newNetworkId = `${context.networkId}-${country}`;
              contextEntries.set(newNetworkId, {
                adapter,
                context: {
                  ...context,
                  networkId: newNetworkId,
                  networkName: `${context.networkName} (${country})`,
                  country,
                  privateKey: finalPrivateKey,
                  walletAddress: finalWalletAddress,
                  baseNetworkId: context.networkId
                }
              });
            } catch (error) {
              console.error(`❌ Failed to setup country context for ${context.networkId} / ${country}:`, error);
            }
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

  /**
   * Fetch users eligible for distribution.
   * CRITICAL: This method filters out users who are currently banned.
   * This timing is synchronized with the weekly ban voting system (see BanVotingService).
   * Do not change the exclusion of banned users or the weekly distribution timing 
   * in CronService without ensuring the voting cycle remains aligned.
   */
  private async fetchEligibleUsers(): Promise<User[]> { // TODO@P3: Don't store all in memory.
    const now = new Date();
    return await this.prisma.user.findMany({
      where: {
        onboarded: true,
        shareInGDP: { not: null },
        OR: [
          { bannedTill: null },
          { bannedTill: { lt: now } }
        ]
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
          tokenSymbol: context.tokenSymbol, // TODO@P2: Use tokenAddress instead.
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

    // Pre-calculate GDP share totals for groups (all users with shares, even not onboarded)
    const gdpStats = await this.prisma.user.groupBy({
      by: ['residenceCountry'],
      where: { shareInGDP: { not: null } },
      _sum: { shareInGDP: true }
    });

    const countryShareTotals = new Map<string, number>();
    let globalShareTotal = 0;
    for (const row of gdpStats) {
      const share = row._sum.shareInGDP ?? 0;
      globalShareTotal += share;
      if (row.residenceCountry) {
        countryShareTotals.set(row.residenceCountry, share);
      }
    }

    const networkDistributions = new Map<
      string,
      {
        adapter: GasTokenNetworkAdapter;
        context: GasTokenNetworkContext;
        distributions: DistributionFiber[];
      }
    >();

    // Use collectNetworkAdapterContexts to get all relevant contexts (Global + Countries)
    const contextEntries = await this.collectNetworkAdapterContexts(tokenOptions);

    for (const [contextId, { adapter, context }] of contextEntries.entries()) {
      const userFilter = context.country ? (u: User) => u.residenceCountry === context.country : undefined;

      const eligibleUsers = users.filter(user => {
        if (userFilter && !userFilter(user)) return false;

        const share = user.shareInGDP ?? 0;
        const address = adapter.getRecipientAddress(user);
        return share > 0 && !!address;
      });

      // Total share used as denominator
      // For global: denominator is the sum of shares of all known users
      // For country: denominator is the sum of shares of all known citizens of that country
      const totalShareDenom = context.country
        ? (countryShareTotals.get(context.country) ?? 0)
        : globalShareTotal;

      if (eligibleUsers.length === 0 || totalShareDenom <= 0) {
        if (!context.country) {
          console.warn(
            `⚠️  No eligible recipients found for ${context.networkName} (${context.adapterType}).`
          );
        }
        networkDistributions.set(contextId, {
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
        networkDistributions.set(contextId, {
          adapter,
          context,
          distributions: []
        });
        continue;
      }

      // Fetch aggregated backlog from DB
      const backlogSums = await this.prisma.gasTokenDistribution.groupBy({
        by: ['userId'],
        where: {
          network: context.networkId,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType,
          status: { in: ['DEFERRED', 'FAILED'] }
        },
        _sum: {
          amount: true
        }
      });

      const backlogLookup = new Map<number, number>();
      let totalBacklogLiability = 0;
      for (const row of backlogSums) {
        const amount = Number(row._sum.amount ?? 0);
        backlogLookup.set(row.userId, amount);
        totalBacklogLiability += amount;
      }

      const currentReserve = await this.getTokenReserve(context);

      // We must deduct the total backlog liability from the wallet balance to find 
      // the amount available for NEW distribution. 
      // If we don't, we effectively re-distribute the money that is already "owned" 
      // by the backlog holders.
      const realWalletBalance = Math.max(0, walletBalance);
      const spendableFromWallet = Math.max(0, realWalletBalance - totalBacklogLiability);
      const totalAvailable = spendableFromWallet + currentReserve; // currentReserve checks the separate reserve table, mostly for reporting now

      if (totalAvailable <= 0 && totalBacklogLiability <= 0) {
        if (!context.country) {
          console.warn(
            `⚠️  No ${context.tokenSymbol} funds available for distribution on ${context.networkName}`
          );
        }
        networkDistributions.set(contextId, {
          adapter,
          context,
          distributions: []
        });
        continue;
      }

      console.log(`[${context.networkName}] Wallet: ${realWalletBalance}, Backlog Liability: ${totalBacklogLiability}, New Distributable: ${spendableFromWallet}`);

      const distributions: DistributionFiber[] = eligibleUsers.map(user => {
        const share = user.shareInGDP ?? 0;
        const proportion = share / totalShareDenom;
        const recipientAddress = adapter.getRecipientAddress(user);

        const backlogAmount = backlogLookup.get(user.id) ?? 0;
        const newAmount = proportion > 0 ? spendableFromWallet * proportion : 0;

        return {
          userId: user.id,
          recipientAddress: recipientAddress!,
          amountToken: newAmount + backlogAmount,
          shareInGDP: share,
          backlogAmount: backlogAmount
        };
      });

      const filtered = distributions.filter(dist => dist.amountToken > 0);
      filtered.sort((a, b) => b.amountToken - a.amountToken);

      networkDistributions.set(contextId, {
        adapter,
        context,
        distributions: filtered
      });
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

        const user = await this.prisma.user.findUnique({ where: { id: dist.userId } });
        if (user?.kycStatus !== 'APPROVED') {
          const kycError = 'KYC_REQUIRED';
          // Critical change: Do NOT reserve funds for user if KYC not passed.
          // result.reservedAmount += dist.amountToken; // REMOVED

          await this.prisma.$transaction([
            this.prisma.gasTokenDistribution.updateMany({
              where: {
                userId: dist.userId,
                network: context.networkId,
                tokenSymbol: context.tokenSymbol,
                status: { in: ['DEFERRED', 'FAILED'] }
              },
              data: { status: 'PROCESSED' }
            }),
            this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: context.networkId,
                amount: 0, // Set amount to 0 so it doesn't count as backlog
                backlogAmount: dist.backlogAmount, // Keep tracking old backlog? Or should this also be 0? 
                // If we want to "not reserve", we probably shouldn't carry over old backlog either for *this* record, 
                // but preserving it in `backlogAmount` field might be useful for history. 
                // However, since we set amount=0, next time the aggregated sums won't include this "new" amount. 
                // The old backlog is "processed" by the updateMany above.
                // So effectively, the user LOSES their backlog claim if we mark old ones PROCESSED and new one has amount 0.
                // This satisfies "money are not reserved for him" (clearing reservation).
                amountUsd: 0,
                status: 'FAILED', // Use FAILED instead of DEFERRED so it's not picked up as active backlog
                errorMessage: kycError,
                tokenType: context.tokenType,
                tokenSymbol: context.tokenSymbol,
                tokenDecimals: context.tokenDecimals
              }
            })
          ]);

          console.log(`⏳ [${context.networkName}] Skipped distribution for user ${dist.userId}: KYC required (reservation cleared)`);

          if (user?.email) {
            const token = emailService.generateKycToken();
            await emailService.storeKycToken(token, user.id);
            await emailService.sendKycRequestEmail(user.email, token, user.name || undefined);
          }

          // Do NOT decrement remainingAmount because we didn't use it.
          // remainingAmount = Math.max(0, remainingAmount - dist.amountToken); // REMOVED
          continue;
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

          // The user pays for gas, so we subtract it from their distribution
          const originalAllocatedAmount = dist.amountToken;
          dist.amountToken = Math.max(0, originalAllocatedAmount - gasCostToken);

          // The total cost to the system is the original allocated amount (amount + gas)
          totalCostToken = originalAllocatedAmount;

          if (totalCostToken > remainingAmount + Number.EPSILON) {
            totalCostToken = remainingAmount;
            dist.amountToken = Math.max(0, totalCostToken - gasCostToken);

            if (dist.amountToken <= 0 && totalCostToken > 0) {
              estimationError = `Insufficient ${context.tokenSymbol} to cover gas cost of ${gasCostToken.toFixed(6)} ${context.tokenSymbol}`;
              shouldStopDueToGasCost = true;
            }
          }

          const minimumRequired = gasCostToken * this.GAS_COST_VALUE_MULTIPLIER;
          if (!estimationError && dist.amountToken < minimumRequired) {
            estimationError = this.buildGasCostMessage(context, gasCostToken, dist.amountToken);
            shouldStopDueToGasCost = true;
          }
        } else {
          totalCostToken = dist.amountToken;
        }

        if (estimate?.deferReason) {
          estimationError = estimate.deferReason;
        }

        if (estimationError) {
          result.reservedAmount += dist.amountToken;

          await this.prisma.$transaction([
            this.prisma.gasTokenDistribution.updateMany({
              where: {
                userId: dist.userId,
                network: context.networkId,
                tokenSymbol: context.tokenSymbol,
                status: { in: ['DEFERRED', 'FAILED'] }
              },
              data: { status: 'PROCESSED' }
            }),
            this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: context.networkId,
                amount: dist.amountToken,
                backlogAmount: dist.backlogAmount,
                amountUsd: 0,
                status: 'DEFERRED',
                errorMessage: estimationError,
                tokenType: context.tokenType,
                tokenSymbol: context.tokenSymbol,
                tokenDecimals: context.tokenDecimals
              }
            })
          ]);

          console.log(`⏳ [${context.networkName}] Deferred distribution for user ${dist.userId}: ${estimationError}`);
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);
          if (shouldStopDueToGasCost) {
            console.log(`🛑 [${context.networkName}] Halting further distributions due to gas cost threshold.`);
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

          await this.prisma.$transaction([
            this.prisma.gasTokenDistribution.updateMany({
              where: {
                userId: dist.userId,
                network: context.networkId,
                tokenSymbol: context.tokenSymbol,
                status: { in: ['DEFERRED', 'FAILED'] }
              },
              data: { status: 'PROCESSED' }
            }),
            this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: context.networkId,
                amount: dist.amountToken,
                backlogAmount: dist.backlogAmount,
                amountUsd: 0,
                status: 'SENT',
                transactionHash: transferResult.transactionHash,
                tokenType: context.tokenType,
                tokenSymbol: context.tokenSymbol,
                tokenDecimals: context.tokenDecimals
              }
            })
          ]);

          result.distributedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - totalCostToken);

          const gasInfo = gasCostToken !== undefined ? ` (gas ${gasCostToken.toFixed(6)} ${context.tokenSymbol})` : '';
          console.log(`✅ [${context.networkName}] Sent ${dist.amountToken.toFixed(6)} ${context.tokenSymbol} to user ${dist.userId}${gasInfo}`);
        } catch (error) {
          result.reservedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          await this.prisma.$transaction([
            this.prisma.gasTokenDistribution.updateMany({
              where: {
                userId: dist.userId,
                network: context.networkId,
                tokenSymbol: context.tokenSymbol,
                status: { in: ['DEFERRED', 'FAILED'] }
              },
              data: { status: 'PROCESSED' }
            }),
            this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: context.networkId,
                amount: dist.amountToken,
                backlogAmount: dist.backlogAmount,
                amountUsd: 0,
                status: 'FAILED',
                errorMessage,
                tokenType: context.tokenType,
                tokenSymbol: context.tokenSymbol,
                tokenDecimals: context.tokenDecimals
              }
            })
          ]);

          const message = `Failed to send to user ${dist.userId}: ${errorMessage}`;
          result.errors.push(message);
          console.error(`❌ [${context.networkName}] ${message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error processing user ${dist.userId}: ${errorMessage}`);
        console.error(`❌ [${context.networkName}] Error processing user ${dist.userId}: ${errorMessage}`);
      }
    }

    const currentReserve = await this.getTokenReserve(context);
    const newReserve = currentReserve + result.reservedAmount;
    await this.updateGasTokenReserve(context, newReserve);

    console.log(
      `📊 [${context.networkName}] Distribution completed: ${result.distributedAmount.toFixed(6)} ${context.tokenSymbol} distributed, ${result.reservedAmount.toFixed(6)} ${context.tokenSymbol} reserved`
    );

    return result;
  }

  /**
   * STAGE 1: Process network distribution by creating pending transactions with computed hashes
   * This does NOT execute transactions immediately - they are stored for later execution
   */
  private async processNetworkDistributionTwoStage(
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
      errors: []
    };

    console.log(
      `🔄 [STAGE 1] Preparing ${distributions.length} ${context.tokenSymbol} transactions on ${context.networkName} (${context.adapterType})...`
    );

    let remainingAmount = distributions.reduce((sum, dist) => sum + dist.amountToken, 0);

    for (const dist of distributions) {
      try {
        if (remainingAmount <= 0) {
          break;
        }

        const user = await this.prisma.user.findUnique({ where: { id: dist.userId } });
        if (user?.kycStatus !== 'APPROVED') {
          const kycError = 'KYC_REQUIRED';
          // Critical change: Do NOT reserve funds for user if KYC not passed.
          // result.reservedAmount += dist.amountToken; // REMOVED

          await this.prisma.$transaction([
            this.prisma.gasTokenDistribution.updateMany({
              where: {
                userId: dist.userId,
                network: context.networkId,
                tokenSymbol: context.tokenSymbol,
                status: { in: ['DEFERRED', 'FAILED'] }
              },
              data: { status: 'PROCESSED' }
            }),
            this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: context.networkId,
                amount: 0, // Set amount to 0 to clear reservation
                backlogAmount: dist.backlogAmount,
                amountUsd: 0,
                status: 'FAILED', // FAILED instead of DEFERRED
                errorMessage: kycError,
                tokenType: context.tokenType,
                tokenSymbol: context.tokenSymbol,
                tokenDecimals: context.tokenDecimals
              }
            })
          ]);

          console.log(`⏳ [${context.networkName}] Skipped distribution for user ${dist.userId}: KYC required (reservation cleared)`);

          if (user?.email) {
            const token = emailService.generateKycToken();
            await emailService.storeKycToken(token, user.id);
            await emailService.sendKycRequestEmail(user.email, token, user.name || undefined);
          }

          // Do not decrement remainingAmount
          // remainingAmount = Math.max(0, remainingAmount - dist.amountToken); // REMOVED
          continue;


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

          // The user pays for gas, so we subtract it from their distribution
          const originalAllocatedAmount = dist.amountToken;
          dist.amountToken = Math.max(0, originalAllocatedAmount - gasCostToken);

          // The total cost to the system is the original allocated amount (amount + gas)
          totalCostToken = originalAllocatedAmount;

          if (totalCostToken > remainingAmount + Number.EPSILON) {
            totalCostToken = remainingAmount;
            dist.amountToken = Math.max(0, totalCostToken - gasCostToken);

            if (dist.amountToken <= 0 && totalCostToken > 0) {
              estimationError = `Insufficient ${context.tokenSymbol} to cover gas cost of ${gasCostToken.toFixed(6)} ${context.tokenSymbol}`;
              shouldStopDueToGasCost = true;
            }
          }

          const minimumRequired = gasCostToken * this.GAS_COST_VALUE_MULTIPLIER;
          if (!estimationError && dist.amountToken < minimumRequired) {
            estimationError = this.buildGasCostMessage(context, gasCostToken, dist.amountToken);
            shouldStopDueToGasCost = true;
          }
        } else {
          totalCostToken = dist.amountToken;
        }

        if (estimate?.deferReason) {
          estimationError = estimate.deferReason;
        }

        if (estimationError) {
          result.reservedAmount += dist.amountToken;

          await this.prisma.$transaction([
            this.prisma.gasTokenDistribution.updateMany({
              where: {
                userId: dist.userId,
                network: context.networkId,
                tokenSymbol: context.tokenSymbol,
                status: { in: ['DEFERRED', 'FAILED'] }
              },
              data: { status: 'PROCESSED' }
            }),
            this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: context.networkId,
                amount: dist.amountToken,
                backlogAmount: dist.backlogAmount,
                amountUsd: 0,
                status: 'DEFERRED',
                errorMessage: estimationError,
                tokenType: context.tokenType,
                tokenSymbol: context.tokenSymbol,
                tokenDecimals: context.tokenDecimals
              }
            })
          ]);

          console.log(`⏳ [${context.networkName}] Deferred distribution for user ${dist.userId}: ${estimationError}`);
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);
          if (shouldStopDueToGasCost) {
            console.log(`🛑 [${context.networkName}] Halting further distributions due to gas cost threshold.`);
            break;
          }
          continue;
        }

        // STAGE 1: Store transaction instead of executing it
        try {
          const txHash = await pendingTransactionService.storeTransaction({
            userId: dist.userId,
            network: context.networkId,
            recipientAddress: dist.recipientAddress,
            amount: dist.amountToken,
            backlogAmount: dist.backlogAmount,
            tokenType: context.tokenType,
            tokenSymbol: context.tokenSymbol,
            tokenDecimals: context.tokenDecimals
          });

          if (txHash) {
            // Transaction stored successfully
            await this.prisma.$transaction([
              this.prisma.gasTokenDistribution.updateMany({
                where: {
                  userId: dist.userId,
                  network: context.networkId,
                  tokenSymbol: context.tokenSymbol,
                  status: { in: ['DEFERRED', 'FAILED'] }
                },
                data: { status: 'PROCESSED' }
              }),
              this.prisma.gasTokenDistribution.create({
                data: {
                  userId: dist.userId,
                  network: context.networkId,
                  amount: dist.amountToken,
                  backlogAmount: dist.backlogAmount,
                  amountUsd: 0,
                  status: 'PENDING',
                  transactionHash: txHash,
                  tokenType: context.tokenType,
                  tokenSymbol: context.tokenSymbol,
                  tokenDecimals: context.tokenDecimals
                }
              })
            ]);

            result.distributedAmount += dist.amountToken;
            remainingAmount = Math.max(0, remainingAmount - totalCostToken);

            console.log(`📝 [${context.networkName}] Stored transaction ${txHash.substring(0, 16)}... for user ${dist.userId} (${dist.amountToken.toFixed(6)} ${context.tokenSymbol})`);
          } else {
            // Transaction already exists - skip
            console.log(`⏭️ [${context.networkName}] Skipping duplicate transaction for user ${dist.userId}`);
          }
        } catch (error) {
          result.reservedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          await this.prisma.$transaction([
            this.prisma.gasTokenDistribution.updateMany({
              where: {
                userId: dist.userId,
                network: context.networkId,
                tokenSymbol: context.tokenSymbol,
                status: { in: ['DEFERRED', 'FAILED'] }
              },
              data: { status: 'PROCESSED' }
            }),
            this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: context.networkId,
                amount: dist.amountToken,
                backlogAmount: dist.backlogAmount,
                amountUsd: 0,
                status: 'FAILED',
                errorMessage,
                tokenType: context.tokenType,
                tokenSymbol: context.tokenSymbol,
                tokenDecimals: context.tokenDecimals
              }
            })
          ]);

          const message = `Failed to store transaction for user ${dist.userId}: ${errorMessage}`;
          result.errors.push(message);
          console.error(`❌ [${context.networkName}] ${message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error processing user ${dist.userId}: ${errorMessage}`);
        console.error(`❌ [${context.networkName}] Error processing user ${dist.userId}: ${errorMessage}`);
      }
    }

    const currentReserve = await this.getTokenReserve(context);
    const newReserve = currentReserve + result.reservedAmount;
    await this.updateGasTokenReserve(context, newReserve);

    console.log(
      `📊 [${context.networkName}] Stage 1 completed: ${result.distributedAmount.toFixed(6)} ${context.tokenSymbol} prepared for execution, ${result.reservedAmount.toFixed(6)} ${context.tokenSymbol} reserved`
    );

    return {
      ...result,
      distributed: result.distributedAmount,
      reserved: result.reservedAmount
    };
  }

  /**
   * STAGE 2: Execute all pending transactions from the database
   * This ensures no transaction is executed more than once or missed
   */
  async executePendingTransactions(
    networkFilter?: string,
    maxTransactions: number = 100
  ): Promise<{
    success: boolean;
    executed: number;
    failed: number;
    skipped: number;
    errors: string[];
  }> {
    console.log('🚀 [STAGE 2] Starting execution of pending transactions...');

    // Reset any stuck transactions first
    await pendingTransactionService.resetStuckTransactions();

    // Get pending transactions
    const pendingTxs = await pendingTransactionService.getPendingTransactions(networkFilter);
    const transactionsToExecute = pendingTxs.slice(0, maxTransactions);

    console.log(`📋 Found ${pendingTxs.length} pending transactions, executing up to ${transactionsToExecute.length} `);

    const results = {
      success: true,
      executed: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[]
    };

    // Keep track of networks we've skipped in this batch to avoid nonce collisions
    const skippedNetworks = new Set<string>();

    // Get contexts for all networks we need
    const tokenOptions = this.resolveTokenOptions();
    const contextEntries = await this.collectNetworkAdapterContexts(tokenOptions);

    for (const pendingTx of transactionsToExecute) {
      try {
        // If we failed to lock an earlier transaction for this network, skip all subsequent ones
        // to maintain strict sequential order and correct nonces.
        if (skippedNetworks.has(pendingTx.network)) {
          results.skipped++;
          continue;
        }

        // Mark as executing (this prevents concurrent execution)
        const locked = await pendingTransactionService.markAsExecuting(pendingTx.transactionHash);

        if (!locked) {
          console.log(`⏭️  Transaction ${pendingTx.transactionHash.substring(0, 16)}... already being executed or completed. Skipping network ${pendingTx.network} to maintain order.`);
          skippedNetworks.add(pendingTx.network);
          results.skipped++;
          continue;
        }

        // Find the appropriate adapter and context
        const entry = contextEntries.get(pendingTx.network);
        if (!entry) {
          const error = `No adapter found for network: ${pendingTx.network} `;
          await pendingTransactionService.markAsFailed(pendingTx.transactionHash, error);
          results.failed++;
          results.errors.push(error);
          continue;
        }

        const { adapter, context } = entry;

        // Execute the transaction
        try {
          const transferResult = await adapter.sendTransfer(
            context,
            pendingTx.recipientAddress,
            Number(pendingTx.amount)
          );

          // Mark as completed
          if (!transferResult.transactionHash) {
            throw new Error(`Transaction succeeded but no hash was returned for ${pendingTx.transactionHash}`);
          }

          await pendingTransactionService.markAsCompleted(
            pendingTx.transactionHash,
            transferResult.transactionHash
          );

          // Update gas token distribution status
          await this.prisma.gasTokenDistribution.updateMany({
            where: {
              userId: pendingTx.userId,
              network: pendingTx.network,
              transactionHash: pendingTx.transactionHash,
              status: 'PENDING'
            },
            data: {
              status: 'SENT',
              transactionHash: transferResult.transactionHash
            }
          });

          results.executed++;
          console.log(
            `✅ Executed transaction ${pendingTx.transactionHash.substring(0, 16)}... -> ${transferResult.transactionHash} `
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Mark as failed
          await pendingTransactionService.markAsFailed(pendingTx.transactionHash, errorMessage);

          // Update gas token distribution status
          await this.prisma.gasTokenDistribution.updateMany({
            where: {
              userId: pendingTx.userId,
              network: pendingTx.network,
              transactionHash: pendingTx.transactionHash,
              status: 'PENDING'
            },
            data: {
              status: 'FAILED',
              errorMessage
            }
          });

          results.failed++;
          results.errors.push(`Transaction ${pendingTx.transactionHash.substring(0, 16)}...: ${errorMessage} `);
          console.error(`❌ Failed to execute transaction ${pendingTx.transactionHash}: ${errorMessage} `);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Error processing transaction ${pendingTx.transactionHash}: ${errorMessage} `);
        console.error(`💥 Error processing transaction ${pendingTx.transactionHash}: `, errorMessage);
      }
    }

    results.success = results.failed === 0 && results.errors.length === 0;

    console.log('📊 [STAGE 2] Execution completed:');
    console.log(`  ✅ Executed: ${results.executed} `);
    console.log(`  ❌ Failed: ${results.failed} `);
    console.log(`  ⏭️  Skipped: ${results.skipped} `);

    return results;
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
              ...networkResult.errors.map(error => `[${context.networkName}] ${error} `)
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`[${context.networkName}] Fatal error: ${errorMessage} `);
            console.error(`💥[${context.networkName}] Fatal error: `, errorMessage);
          }
        }
      );

      await Promise.all(networkPromises);

      const result: MultiNetworkDistributionResult = {
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
          `  🌐[${networkResult.networkName}]: ${networkResult.distributedAmount.toFixed(
            6
          )
          } ${networkResult.tokenSymbol} distributed, ${networkResult.reservedAmount.toFixed(
            6
          )
          } ${networkResult.tokenSymbol} reserved`
        );
      }

      if (errors.length > 0) {
        console.log('⚠️  Errors occurred:');
        errors.forEach(error => console.log(`  - ${error} `));
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('💥 Fatal error in multi-network gas token distribution:', errorMessage);

      return {
        totalDistributedAmount: 0,
        totalReservedAmount: 0,
        totalDistributed: 0,
        totalReserved: 0,
        networkResults: new Map(),
        errors: [errorMessage]
      };
    }
  }

  /**
   * TWO-STAGE VARIANT: Prepare distributions without executing transactions
   * This is Stage 1 of the two-stage payment system
   * Call executePendingTransactions() afterward to execute the stored transactions
   * 
   * TODO@P3: Execute a payment right after storing it.
   */
  async processMultiNetworkDistributionTwoStage(
    overrides?: Partial<TokenDistributionOptions>
  ): Promise<MultiNetworkDistributionResult> {
    const tokenOptions = this.resolveTokenOptions(overrides);
    console.log('🔄 [TWO-STAGE] Starting multi-network gas token distribution (Stage 1: Preparation)...');

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
                errors: [],
                distributed: 0,
                reserved: 0
              });
              return;
            }

            // Use two-stage processing instead of immediate execution
            const networkResult = await this.processNetworkDistributionTwoStage(
              adapter,
              context,
              distributions
            );
            networkResults.set(networkId, networkResult);
            totalDistributedAmount += networkResult.distributedAmount;
            totalReservedAmount += networkResult.reservedAmount;

            errors.push(
              ...networkResult.errors.map(error => `[${context.networkName}] ${error} `)
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`[${context.networkName}] Fatal error: ${errorMessage} `);
            console.error(`💥[${context.networkName}] Fatal error: `, errorMessage);
          }
        }
      );

      await Promise.all(networkPromises);

      const result: MultiNetworkDistributionResult = {
        totalDistributedAmount,
        totalReservedAmount,
        totalDistributed: totalDistributedAmount,
        totalReserved: totalReservedAmount,
        networkResults,
        errors
      };

      console.log('📊 [TWO-STAGE] Multi-network gas token distribution (Stage 1) completed:');
      console.log(`  📝 Total prepared: ${totalDistributedAmount.toFixed(6)} tokens`);
      console.log(`  🏦 Total reserved: ${totalReservedAmount.toFixed(6)} tokens`);

      for (const [, networkResult] of networkResults) {
        console.log(
          `  🌐[${networkResult.networkName}]: ${networkResult.distributedAmount.toFixed(
            6
          )
          } ${networkResult.tokenSymbol} prepared, ${networkResult.reservedAmount.toFixed(
            6
          )
          } ${networkResult.tokenSymbol} reserved`
        );
      }

      if (errors.length > 0) {
        console.log('⚠️  Errors occurred:');
        errors.forEach(error => console.log(`  - ${error} `));
      }

      console.log('💡 Next step: Call executePendingTransactions() to execute stored transactions');

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('💥 Fatal error in multi-network gas token distribution (Stage 1):', errorMessage);

      return {
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
          tokenSymbol: context.tokenSymbol, // TODO@P2: Use tokenAddress instead.
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
        `⚠️  Failed to read wallet balance for reserve status on ${context.networkName}: ${message} `
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
    const cacheKey = `${networkId}:${JSON.stringify(overrides || {})} `;
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

    // 3. Supplement with live blockchain info
    if (adapter.type === 'EVM') {
      try {
        // Resolve base network ID (strip country suffix if present)
        let baseNetworkId = networkId;
        const enabledEvmNetworks = multiNetworkEthereumService.getEnabledNetworks();

        if (!enabledEvmNetworks.includes(networkId)) {
          // Try exact suffix match first
          if (tokenOptions.country && networkId.endsWith(`-${tokenOptions.country}`)) {
            const potential = networkId.slice(0, -1 * (tokenOptions.country.length + 1));
            if (enabledEvmNetworks.includes(potential)) {
              baseNetworkId = potential;
            }
          }

          // If still not found, try prefix matching
          if (baseNetworkId === networkId) {
            const match = enabledEvmNetworks.find(n => networkId.startsWith(`${n}-`));
            if (match) baseNetworkId = match;
          }
        }

        // Fetch global network info (for gas price, chainId, name)
        const info = await multiNetworkEthereumService.getNetworkInfo(baseNetworkId);

        // Always fetch balance for the SPECIFIC context (which handles country-specific addresses)
        let walletBalanceEth = 0;
        try {
          walletBalanceEth = await adapter.getWalletBalance(context);
        } catch (e) {
          console.error(`Failed to get EVM wallet balance for ${context.networkName}: `, e);
        }

        if (info) {
          status = {
            ...status,
            name: info.name,
            chainId: info.chainId,
            // Keep derived/context address, do NOT overwrite with global info.address
            address: context.walletAddress,
            // balance: info.balance.toString(), // Do NOT use global balance
            gasPrice: info.gasPrice.toString(),
            walletBalance: walletBalanceEth,
            availableForDistribution: reserveAmount + walletBalanceEth,
            balanceFormatted: adapter.formatAmount(context, walletBalanceEth),
            gasPriceFormatted: multiNetworkEthereumService.formatEther(info.gasPrice)
          };
        }
      } catch (error) {
        console.error(`Failed to get live EVM info for ${networkId}: `, error);
      }
    } else {
      // Non-EVM adapters
      try {
        const walletBalance = await adapter.getWalletBalance(context);
        status.walletBalance = walletBalance;
        status.availableForDistribution = reserveAmount + walletBalance;
      } catch (error) {
        console.warn(`⚠️  Failed to read wallet balance for ${context.networkName}: `, error);
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

  private sanitizeContext(context: GasTokenNetworkContext): Partial<GasTokenNetworkContext> {
    const { privateKey, ...sanitized } = context;
    return sanitized;
  }

  async getEnabledNetworks(overrides?: Partial<TokenDistributionOptions>) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const contextEntries = await this.collectNetworkAdapterContexts(tokenOptions);

    return Array.from(contextEntries.values()).map(entry => {
      const sanitized = this.sanitizeContext(entry.context);
      return {
        networkId: sanitized.networkId!,
        networkName: sanitized.networkName!,
        adapterType: sanitized.adapterType!,
        walletAddress: sanitized.walletAddress
      };
    });
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
          if (contextKey === baseNetworkId || contextKey.startsWith(`${baseNetworkId} -`)) {
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
          `⚠️  Failed to estimate gas cost for ${context.networkName}(${context.adapterType}): ${message} `
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
