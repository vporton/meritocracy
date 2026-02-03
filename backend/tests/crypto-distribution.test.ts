import { PrismaClient } from '@prisma/client';
import { MultiNetworkGasTokenDistributionService } from '../src/services/MultiNetworkGasTokenDistributionService.js';
import { describe, it, beforeEach, after } from 'mocha';
import {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from '../src/services/gas-networks/types.js';
import { User } from '@prisma/client';

class MockAdapter implements GasTokenNetworkAdapter {
    readonly type = 'MOCK';

    constructor(
        public balances: Record<string, number> = {},
        public shouldFailEstimate: boolean = false,
        public shouldFailSend: boolean = false
    ) { }

    async getNetworkContexts(options: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
        return [
            {
                nativeTokenSymbol: 'MOCK',
                nativeTokenDecimals: 18,
                networkId: 'mock-network',
                networkName: 'Mock Network',
                adapterType: 'MOCK',
                tokenSymbol: 'MOCK',
                tokenType: 'NATIVE',
                tokenDecimals: 18,
                walletAddress: '0x123',
                // isDefault: true
            }
        ];
    }

    async getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
        return this.balances[context.networkId] ?? 0;
    }

    async estimateTransfer(context: GasTokenNetworkContext, recipient: string, amount: number): Promise<GasTransferEstimate> {
        if (this.shouldFailEstimate) {
            throw new Error('Estimate failed');
        }
        return {
            gasCostToken: 0.001,
            // isPossible: true
        };
    }

    async sendTransfer(context: GasTokenNetworkContext, recipient: string, amount: number): Promise<GasTransferResult> {
        if (this.shouldFailSend) {
            throw new Error('Send failed');
        }
        return {
            transactionHash: '0xhash'
        };
    }

    getRecipientAddress(user: User): string | null {
        return user.ethereumAddress;
    }

    async deriveAddress(privateKey: string): Promise<string> {
        return '0xderived';
    }

    formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
        return amountToken.toLocaleString('en-US', {
            useGrouping: false,
            maximumFractionDigits: context.tokenDecimals
        });
    }
}

describe('Crypto Distribution Service (integration)', function (this: Mocha.Suite) {
    this.timeout(120_000);

    const prisma = new PrismaClient();

    beforeEach(async () => {
        await prisma.gasTokenDistribution.deleteMany({});
        await prisma.gasTokenReserve.deleteMany({});
        await prisma.user.deleteMany({ where: { email: { startsWith: 'test-' } } });
        await prisma.systemSecret.deleteMany({ where: { name: { contains: 'COUNTRY' } } });
    });

    after(async () => {
        await prisma.$disconnect();
    });

    it('distributes global vs country-funded users and handles backlog', async () => {
        console.log('🚀 Starting Integration Tests for Crypto Distribution Service\n');

        console.log('👥 Creating test users...');
        const userGlobal = await prisma.user.create({
            data: {
                email: 'test-global@example.com',
                ethereumAddress: '0xGlobalUser',
                onboarded: true,
                shareInGDP: 10,
                kycStatus: 'APPROVED'
            }
        });

        const userCountry = await prisma.user.create({
            data: {
                email: 'test-country@example.com',
                ethereumAddress: '0xCountryUser',
                onboarded: true,
                shareInGDP: 20,
                residenceCountry: 'TESTLAND',
                kycStatus: 'APPROVED'
            }
        });

        // Setup Country Secret for TESTLAND (to be "funded country account")
        await prisma.systemSecret.create({
            data: {
                name: 'EVM_PRIVATE_KEY_COUNTRY_TESTLAND',
                value: '0x498f92f453e96102660bcac5ef14fe4672f210b1a74cb95e87644c9e9be03597' // vanity key for 0xB61897FCc8E0f61ab9CF27c5463697542aF0742F
            }
        });

        const mockAdapter = new MockAdapter({
            'mock-network': 100,
            'mock-network-TESTLAND': 50
        });

        const service = new MultiNetworkGasTokenDistributionService(prisma, [mockAdapter]);
        service.overrideEligibleUsers([userGlobal, userCountry]);

        console.log('\n🧪 TEST 1: Distribution for global vs country-funded users');
        await service.processMultiNetworkDistribution();

        // userGlobal: should receive from global network only
        const distGlobal = await prisma.gasTokenDistribution.findMany({
            where: { userId: userGlobal.id, status: 'SENT' }
        });
        console.log(`✅ Global user received ${distGlobal.length} distributions`);
        if (distGlobal.length !== 1) throw new Error('Global user should receive 1 distribution');

        // userCountry: may receive from global and country
        const distCountry = await prisma.gasTokenDistribution.findMany({
            where: { userId: userCountry.id, status: 'SENT' }
        });
        console.log(`✅ Country user received ${distCountry.length} distributions`);
        if (distCountry.length < 1) throw new Error('Country user should receive at least 1 distribution');

        console.log('\n🧪 TEST 2: Backlog Amount');
        await prisma.gasTokenDistribution.create({
            data: {
                userId: userGlobal.id,
                network: 'mock-network',
                amount: 5,
                amountUsd: 0,
                status: 'DEFERRED',
                errorMessage: 'MOCK_DEFER',
                tokenSymbol: 'MOCK'
            }
        });

        await service.processMultiNetworkDistribution();

        const distGlobalAfterBacklog = await prisma.gasTokenDistribution.findFirst({
            where: { userId: userGlobal.id, status: 'SENT', backlogAmount: { gt: 0 } }
        });

        if (!distGlobalAfterBacklog) {
            const deferredWithBacklog = await prisma.gasTokenDistribution.findFirst({
                where: { userId: userGlobal.id, status: 'DEFERRED', backlogAmount: { gt: 0 } }
            });
            if (!deferredWithBacklog) {
                throw new Error('Backlog was not processed');
            }
        }
    });
});
