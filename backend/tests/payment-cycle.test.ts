import { PrismaClient } from '@prisma/client';
import type { User } from '@prisma/client';
import { MultiNetworkGasTokenDistributionService } from '../src/services/MultiNetworkGasTokenDistributionService.js';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate
} from '../src/services/gas-networks/types.js';

const prisma = new PrismaClient();
const TEST_EMAIL_PREFIX = 'test-payment-';

interface TransferRecord {
  networkId: string;
  recipient: string;
  amount: number;
  contextName: string;
}

interface AdapterOptions {
  balances?: Record<string, number>;
  defaultGasCostToken?: number;
  perContextGasCost?: Record<string, number>;
}

class PaymentTestMockAdapter implements GasTokenNetworkAdapter {
  readonly type = 'MOCK';
  private contexts: GasTokenNetworkContext[];
  private balances: Record<string, number>;
  private readonly defaultGasCostToken: number;
  private perContextGasCost: Record<string, number>;
  public sendLog: TransferRecord[] = [];

  constructor(contexts: GasTokenNetworkContext[], options: AdapterOptions = {}) {
    this.contexts = contexts;
    this.balances = { ...(options.balances ?? {}) };
    this.defaultGasCostToken = options.defaultGasCostToken ?? 0;
    this.perContextGasCost = { ...(options.perContextGasCost ?? {}) };
  }

  getNetworkContexts(): Promise<GasTokenNetworkContext[]> {
    return Promise.resolve(this.contexts);
  }

  getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
    return Promise.resolve(this.balances[context.networkId] ?? 0);
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toFixed(context.tokenDecimals);
  }

  getRecipientAddress(user: User): string | null {
    return user.ethereumAddress ?? null;
  }

  estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    const gasCostToken =
      this.perContextGasCost[context.networkId] ?? this.defaultGasCostToken;
    return Promise.resolve({ gasCostToken });
  }

  sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<{ transactionHash: string }> {
    this.sendLog.push({
      networkId: context.networkId,
      recipient: recipientAddress,
      amount: amountToken,
      contextName: context.networkName
    });
    return Promise.resolve({ transactionHash: `mock-tx-${this.sendLog.length}` });
  }

  setBalance(networkId: string, balance: number): void {
    this.balances[networkId] = balance;
  }

  setGasCost(networkId: string, gasCostToken: number): void {
    this.perContextGasCost[networkId] = gasCostToken;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApproximately(actual: number, expected: number, description: string): void {
  const delta = 1e-6;
  if (Math.abs(actual - expected) > delta) {
    throw new Error(`${description}: expected ${expected}, got ${actual}`);
  }
}

async function cleanupTestState(): Promise<void> {
  await prisma.gasTokenDistribution.deleteMany({});
  await prisma.gasTokenReserve.deleteMany({});
  await prisma.pendingTransaction.deleteMany({});
  await prisma.systemSecret.deleteMany({ where: { name: { contains: 'TESTPAY' } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
}

async function createTestUser(overrides: Partial<User>): Promise<User> {
  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${cryptoRandom()}@example.com`,
      ethereumAddress: `0x${cryptoRandom()}${cryptoRandom()}`,
      onboarded: true,
      kycStatus: 'APPROVED',
      shareInGDP: 1,
      ...overrides
    }
  });
}

function cryptoRandom(): string {
  return Math.random().toString(36).substring(2, 9);
}

async function testMultiplePaymentCycles(): Promise<void> {
  const networkId = 'mock-cycle-net';
  const context: GasTokenNetworkContext = {
    adapterType: 'MOCK',
    networkId,
    networkName: 'Mock Cycle Network',
    nativeTokenSymbol: 'MOCK',
    nativeTokenDecimals: 18,
    tokenSymbol: 'MOCK',
    tokenDecimals: 18,
    tokenType: 'NATIVE'
  } as GasTokenNetworkContext;

  const adapter = new PaymentTestMockAdapter([context], {
    balances: { [networkId]: 6 },
    defaultGasCostToken: 0
  });

  const service = new MultiNetworkGasTokenDistributionService(prisma, [adapter]);

  const userA = await createTestUser({ shareInGDP: 1 });
  const userB = await createTestUser({ shareInGDP: 2 });

  const resultCycle1 = await service.processMultiNetworkDistribution();
  const cycle1Records = await prisma.gasTokenDistribution.findMany({
    where: { network: networkId, status: 'SENT' },
    orderBy: { id: 'asc' }
  });

  assert(cycle1Records.length === 2, 'Cycle 1 should have recorded exactly two distributions.');

  const userARecord1 = cycle1Records.find(record => record.userId === userA.id)!;
  const userBRecord1 = cycle1Records.find(record => record.userId === userB.id)!;
  assert(userARecord1, 'User A should have a cycle 1 distribution.');
  assert(userBRecord1, 'User B should have a cycle 1 distribution.');

  assertApproximately(Number(userARecord1.amount), 2, 'Cycle 1: User A amount');
  assertApproximately(Number(userBRecord1.amount), 4, 'Cycle 1: User B amount');
  assertApproximately(resultCycle1.totalDistributedAmount, 6, 'Cycle 1 total distributed matches database sums.');

  const cycle1MaxId = Math.max(...cycle1Records.map(record => record.id));

  adapter.setBalance(networkId, 9);
  const resultCycle2 = await service.processMultiNetworkDistribution();

  const cycle2Records = await prisma.gasTokenDistribution.findMany({
    where: { network: networkId, status: 'SENT', id: { gt: cycle1MaxId } },
    orderBy: { id: 'asc' }
  });

  assert(cycle2Records.length === 2, 'Cycle 2 should add two new distributions.');

  const userARecord2 = cycle2Records.find(record => record.userId === userA.id)!;
  const userBRecord2 = cycle2Records.find(record => record.userId === userB.id)!;
  assert(userARecord2, 'User A should have a cycle 2 distribution.');
  assert(userBRecord2, 'User B should have a cycle 2 distribution.');

  assertApproximately(Number(userARecord2.amount), 3, 'Cycle 2: User A amount matches share ratio.');
  assertApproximately(Number(userBRecord2.amount), 6, 'Cycle 2: User B amount matches share ratio.');
  assertApproximately(resultCycle2.totalDistributedAmount, 9, 'Cycle 2 total distributed matches database sums.');

  assert(adapter.sendLog.length === 4, 'Send method should be invoked for each distribution cycle.');

  console.log('✅ Multiple payment cycle behavior validated.');
}

async function testHighGasCostDefersPayments(): Promise<void> {
  const networkId = 'mock-high-gas';
  const context: GasTokenNetworkContext = {
    adapterType: 'MOCK',
    networkId,
    networkName: 'Mock High Gas Network',
    nativeTokenSymbol: 'MOCK',
    nativeTokenDecimals: 18,
    tokenSymbol: 'MOCK',
    tokenDecimals: 18,
    tokenType: 'NATIVE'
  } as GasTokenNetworkContext;

  const adapter = new PaymentTestMockAdapter([context], {
    balances: { [networkId]: 0.005 },
    defaultGasCostToken: 0
  });
  adapter.setGasCost(networkId, 0.003);

  const service = new MultiNetworkGasTokenDistributionService(prisma, [adapter]);
  const user = await createTestUser({ shareInGDP: 1 });

  const result = await service.processMultiNetworkDistribution();
  assertApproximately(result.totalDistributedAmount, 0, 'No tokens should be distributed when gas cost is prohibitive.');
  assertApproximately(result.totalReservedAmount, 0.002, 'Gas cost reserve should reflect the amount left after covering gas.');

  const deferredRecord = await prisma.gasTokenDistribution.findFirst({
    where: {
      network: networkId,
      status: 'DEFERRED',
      userId: user.id
    }
  });

  assert(deferredRecord, 'A deferred distribution must exist when gas cost exceeds available funds.');
  assertApproximately(Number(deferredRecord!.amount), 0.002, 'Deferred amount equals distributable funds after gas.');
  assert(adapter.sendLog.length === 0, 'No transfer should be executed if the gas cost rule triggers a defer.');

  console.log('✅ High gas cost guardrail yields deferred distribution as expected.');
}

async function runTests(): Promise<void> {
  console.log('🚀 Starting payment cycle test suite...');
  try {
    await cleanupTestState();
    await testMultiplePaymentCycles();
    await cleanupTestState();
    await testHighGasCostDefersPayments();
    console.log('🎉 All payment cycle tests passed.');
  } catch (error) {
    console.error('❌ Payment cycle tests failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
