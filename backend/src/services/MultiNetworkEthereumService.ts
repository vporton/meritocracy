import { 
    createPublicClient, 
    createWalletClient, 
    formatEther,
    formatUnits,
    http, 
    parseEther, 
    parseUnits,
    type PublicClient,
    type WalletClient,
    type Address,
    type Hash,
    type Chain,
    defineChain
} from 'viem';
import { mainnet, sepolia, polygon, arbitrum, optimism, base, localhost, celo } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import { TokenDescriptor } from '../types/token.js';

// Load environment variables
dotenv.config();
dotenv.config({ path: 'ethereum-keys.secret' });
dotenv.config({ path: 'solana-keys.secret' });
dotenv.config({ path: 'bitcoin-keys.secret' });
dotenv.config({ path: 'polkadot-keys.secret' });

const ERC20_ABI = [
    {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256', internalType: 'uint256' }]
    },
    {
        type: 'function',
        name: 'transfer',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'to', type: 'address', internalType: 'address' },
            { name: 'amount', type: 'uint256', internalType: 'uint256' }
        ],
        outputs: [{ name: 'success', type: 'bool', internalType: 'bool' }]
    }
] as const;


export const mezoChainConfig = {
    blockTime: 1_000,
    // contracts,
    // formatters,
    // serializers,
    // fees,
} as const;

export const mezoTestnetChainConfig = {
    blockTime: 1_000,
    // contracts,
    // formatters,
    // serializers,
    // fees,
} as const;

export const mezoTestnet = /*#__PURE__*/ defineChain({
    ...mezoTestnetChainConfig,
    id: 31611,
    name: 'Mezo Testnet',
    nativeCurrency: {
      decimals: 8,
      name: 'Bitcoin',
      symbol: 'BTC',
    },
    rpcUrls: {
      default: { http: ['https://mezo-node-0.test.mezo.org'] },
    },
    blockExplorers: {
      default: {
        name: 'Block explorer app',
        url: 'https://explorer.test.mezo.org',
        apiUrl: undefined,
      },
    },
    contracts: {
    },
    testnet: true,
});

export const mezo = /*#__PURE__*/ defineChain({
    ...mezoChainConfig,
    id: 31612,
    name: 'Mezo',
    nativeCurrency: {
      decimals: 8,
      name: 'Bitcoin',
      symbol: 'BTC',
    },
    rpcUrls: {
      default: { http: ['https://rpc-internal.mezo.org'] },
    },
    blockExplorers: {
      default: {
        name: 'Block explorer app',
        url: 'https://explorer.mezo.org',
        apiUrl: undefined,
      },
    },
    contracts: {
    },
    testnet: false,
});

export interface NetworkConfig {
    name: string;
    chain: Chain;
    rpcUrl?: string;
    enabled: boolean;
    nativeTokenSymbol?: string;
    nativeTokenDecimals?: number;
    nativeTokenCoingeckoId?: string;
}

export interface NetworkClient {
    publicClient: PublicClient;
    walletClient: WalletClient;
    account: ReturnType<typeof privateKeyToAccount>;
    config: NetworkConfig;
}

export interface TokenTransferRequest {
    networkName: string;
    token: TokenDescriptor;
    to: Address;
    amount: string;
}

export interface TokenTransferCostEstimate extends TokenTransferRequest {
    gasEstimate: bigint;
    gasPrice: bigint;
    gasCostWei: bigint;
}

export class MultiNetworkEthereumService {
    private networks: Map<string, NetworkClient> = new Map();
    private config: { privateKey?: string; mnemonic?: string };

    constructor() {
        this.config = {
            privateKey: process.env.ETHEREUM_PRIVATE_KEY,
            mnemonic: process.env.ETHEREUM_MNEMONIC
        };
        
        this.initializeNetworks();
    }

    private initializeNetworks(): void {
        // TODO@P2: Set sensible values.
        const networkConfigs: NetworkConfig[] = [
            {
                name: 'mainnet',
                chain: mainnet,
                rpcUrl: process.env.ETHEREUM_MAINNET_RPC_URL,
                enabled: process.env.ETHEREUM_MAINNET_ENABLED === 'true',
                nativeTokenSymbol: mainnet.nativeCurrency.symbol,
                nativeTokenDecimals: mainnet.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'ethereum'
            },
            {
                name: 'celo',
                chain: celo,
                rpcUrl: process.env.ETHEREUM_CELO_RPC_URL,
                enabled: process.env.ETHEREUM_CELO_ENABLED === 'true',
                nativeTokenSymbol: celo.nativeCurrency.symbol,
                nativeTokenDecimals: celo.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'celo'
            },
            {
                name: 'polygon',
                chain: polygon,
                rpcUrl: process.env.ETHEREUM_POLYGON_RPC_URL,
                enabled: process.env.ETHEREUM_POLYGON_ENABLED === 'true',
                nativeTokenSymbol: polygon.nativeCurrency.symbol,
                nativeTokenDecimals: polygon.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'matic-network'
            },
            {
                name: 'arbitrum',
                chain: arbitrum,
                rpcUrl: process.env.ETHEREUM_ARBITRUM_RPC_URL,
                enabled: process.env.ETHEREUM_ARBITRUM_ENABLED === 'true',
                nativeTokenSymbol: arbitrum.nativeCurrency.symbol,
                nativeTokenDecimals: arbitrum.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'ethereum'
            },
            {
                name: 'optimism',
                chain: optimism,
                rpcUrl: process.env.ETHEREUM_OPTIMISM_RPC_URL,
                enabled: process.env.ETHEREUM_OPTIMISM_ENABLED === 'true',
                nativeTokenSymbol: optimism.nativeCurrency.symbol,
                nativeTokenDecimals: optimism.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'ethereum'
            },
            {
                name: 'base',
                chain: base,
                rpcUrl: process.env.ETHEREUM_BASE_RPC_URL,
                enabled: process.env.ETHEREUM_BASE_ENABLED === 'true',
                nativeTokenSymbol: base.nativeCurrency.symbol,
                nativeTokenDecimals: base.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'ethereum'
            },
            {
                name: 'mezo',
                chain: mezo,
                rpcUrl: process.env.MEZORPC_URL,
                enabled: process.env.MEZO_ENABLED === 'true',
                nativeTokenSymbol: mezo.nativeCurrency.symbol,
                nativeTokenDecimals: mezo.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'bitcoin'
            },
            {
                name: 'sepolia',
                chain: sepolia,
                rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC_URL,
                enabled: process.env.ETHEREUM_SEPOLIA_ENABLED === 'true',
                nativeTokenSymbol: sepolia.nativeCurrency.symbol,
                nativeTokenDecimals: sepolia.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'ethereum'
            },
            {
                name: 'mezoTestnet',
                chain: mezoTestnet,
                rpcUrl: process.env.MEZO_TESTNET_RPC_URL,
                enabled: process.env.MEZO_TESTNET_ENABLED === 'true',
                nativeTokenSymbol: mezoTestnet.nativeCurrency.symbol,
                nativeTokenDecimals: mezoTestnet.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'bitcoin'
            },
            {
                name: 'localhost',
                chain: localhost,
                rpcUrl: process.env.ETHEREUM_LOCALHOST_RPC_URL || 'http://localhost:8545',
                enabled: process.env.ETHEREUM_LOCALHOST_ENABLED === 'true',
                nativeTokenSymbol: localhost.nativeCurrency.symbol,
                nativeTokenDecimals: localhost.nativeCurrency.decimals,
                nativeTokenCoingeckoId: 'ethereum'
            },
        ];

        for (const networkConfig of networkConfigs) {
            if (networkConfig.enabled) {
                this.initializeNetwork(networkConfig);
            }
        }
    }

    private initializeNetwork(networkConfig: NetworkConfig): void {
        try {
            // Initialize account
            let account: ReturnType<typeof privateKeyToAccount>;
            if (this.config.privateKey) {
                account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
            } else if (this.config.mnemonic) {
                throw new Error('Mnemonic support not implemented. Please use ETHEREUM_PRIVATE_KEY instead.');
            } else {
                throw new Error('No private key or mnemonic found in configuration');
            }

            // Initialize public client
            const publicClient = createPublicClient({
                chain: networkConfig.chain,
                transport: networkConfig.rpcUrl ? http(networkConfig.rpcUrl) : http()
            });

            // Initialize wallet client
            const walletClient = createWalletClient({
                chain: networkConfig.chain,
                transport: networkConfig.rpcUrl ? http(networkConfig.rpcUrl) : http()
            });

            const networkClient: NetworkClient = {
                publicClient,
                walletClient,
                account,
                config: networkConfig
            };

            this.networks.set(networkConfig.name, networkClient);
            console.log(`✅ Initialized ${networkConfig.name} network client`);
        } catch (error) {
            console.error(`❌ Failed to initialize ${networkConfig.name} network:`, error);
        }
    }

    /**
     * Get all enabled networks
     */
    public getEnabledNetworks(): string[] {
        return Array.from(this.networks.keys());
    }

    /**
     * Get network client for a specific network
     */
    public getNetworkClient(networkName: string): NetworkClient | undefined {
        return this.networks.get(networkName);
    }

    /**
     * Get network configuration for a specific network
     */
    public getNetworkConfig(networkName: string): NetworkConfig | undefined {
        return this.networks.get(networkName)?.config;
    }

    /**
     * Get balance for a specific network
     */
    public async getBalance(networkName: string): Promise<bigint> {
        const client = this.networks.get(networkName);
        if (!client) {
            throw new Error(`Network ${networkName} not found or not enabled`);
        }
        return await client.publicClient.getBalance({ address: client.account.address });
    }

    /**
     * Get balance for native or ERC-20 token on a specific network
     */
    public async getTokenBalance(networkName: string, token: TokenDescriptor): Promise<bigint> {
        if (token.tokenType === 'NATIVE') {
            return await this.getBalance(networkName);
        }

        if (!token.tokenAddress) {
            throw new Error(`Token address is required to fetch ERC-20 balance for ${token.tokenSymbol}`);
        }

        const client = this.networks.get(networkName);
        if (!client) {
            throw new Error(`Network ${networkName} not found or not enabled`);
        }

        return await client.publicClient.readContract({
            address: token.tokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [client.account.address]
        });
    }

    /**
     * Estimate gas usage and cost for transferring a token
     */
    public async estimateTokenTransferCost(request: TokenTransferRequest): Promise<TokenTransferCostEstimate> {
        const client = this.networks.get(request.networkName);
        if (!client) {
            throw new Error(`Network ${request.networkName} not found or not enabled`);
        }

        const decimals = request.token.tokenDecimals ?? client.config.nativeTokenDecimals ?? client.config.chain.nativeCurrency.decimals;
        const amountRaw = parseUnits(request.amount, decimals);

        let gasEstimate: bigint;
        if (request.token.tokenType === 'ERC20') {
            if (!request.token.tokenAddress) {
                throw new Error(`Token address is required to estimate ERC-20 transfer for ${request.token.tokenSymbol}`);
            }
            gasEstimate = await client.publicClient.estimateContractGas({
                address: request.token.tokenAddress,
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [request.to, amountRaw],
                account: client.account.address
            });
        } else {
            gasEstimate = await client.publicClient.estimateGas({
                account: client.account.address,
                to: request.to,
                value: amountRaw
            });
        }

        const gasPrice = await this.getGasPrice(request.networkName);
        return {
            ...request,
            gasEstimate,
            gasPrice,
            gasCostWei: gasEstimate * gasPrice
        };
    }

    /**
     * Send native or ERC-20 token transfer on a specific network
     */
    public async sendTokenTransfer(request: TokenTransferRequest): Promise<Hash> {
        const client = this.networks.get(request.networkName);
        if (!client) {
            throw new Error(`Network ${request.networkName} not found or not enabled`);
        }

        const decimals = request.token.tokenDecimals ?? client.config.nativeTokenDecimals ?? client.config.chain.nativeCurrency.decimals;
        const amountRaw = parseUnits(request.amount, decimals);

        if (request.token.tokenType === 'ERC20') {
            if (!request.token.tokenAddress) {
                throw new Error(`Token address is required to send ERC-20 transfer for ${request.token.tokenSymbol}`);
            }

            return await client.walletClient.writeContract({
                account: client.account,
                address: request.token.tokenAddress,
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [request.to, amountRaw],
                chain: client.publicClient.chain
            });
        }

        return await client.walletClient.sendTransaction({
            account: client.account,
            to: request.to,
            value: amountRaw,
            chain: client.publicClient.chain
        });
    }

    /**
     * Get balance for all networks
     */
    public async getAllBalances(): Promise<Map<string, bigint>> {
        const balances = new Map<string, bigint>();
        
        const balancePromises = Array.from(this.networks.keys()).map(async (networkName) => {
            try {
                const balance = await this.getBalance(networkName);
                balances.set(networkName, balance);
            } catch (error) {
                console.error(`Failed to get balance for ${networkName}:`, error);
                balances.set(networkName, 0n);
            }
        });

        await Promise.all(balancePromises);
        return balances;
    }

    /**
     * Send transaction on a specific network
     */
    public async sendTransaction(
        networkName: string, 
        to: Address, 
        value: string, 
        data?: `0x${string}`
    ): Promise<Hash> {
        const client = this.networks.get(networkName);
        if (!client) {
            throw new Error(`Network ${networkName} not found or not enabled`);
        }

        return await client.walletClient.sendTransaction({
            account: client.account,
            to,
            value: parseEther(value),
            data: data || '0x',
            chain: client.publicClient.chain
        });
    }

    /**
     * Send transactions on multiple networks in parallel
     */
    public async sendTransactionsOnMultipleNetworks(
        transactions: Array<{
            networkName: string;
            to: Address;
            value: string;
            data?: `0x${string}`;
        }>
    ): Promise<Map<string, { success: boolean; hash?: Hash; error?: string }>> {
        const results = new Map<string, { success: boolean; hash?: Hash; error?: string }>();

        const transactionPromises = transactions.map(async (tx) => {
            try {
                const hash = await this.sendTransaction(tx.networkName, tx.to, tx.value, tx.data);
                results.set(tx.networkName, { success: true, hash });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                results.set(tx.networkName, { success: false, error: errorMessage });
            }
        });

        await Promise.all(transactionPromises);
        return results;
    }

    /**
     * Get gas price for a specific network
     */
    public async getGasPrice(networkName: string): Promise<bigint> {
        const client = this.networks.get(networkName);
        if (!client) {
            throw new Error(`Network ${networkName} not found or not enabled`);
        }

        try {
            const gasPrice = await client.publicClient.getGasPrice();
            return gasPrice;
        } catch (error) {
            console.error(`Failed to get gas price for ${networkName}:`, error);
            return 0n;
        }
    }

    /**
     * Get network information for a specific network
     */
    public async getNetworkInfo(networkName: string): Promise<{
        name: string;
        chainId: number;
        gasPrice: bigint;
        balance: bigint;
        address: Address;
    }> {
        const client = this.networks.get(networkName);
        if (!client) {
            throw new Error(`Network ${networkName} not found or not enabled`);
        }

        const [gasPrice, balance] = await Promise.all([
            this.getGasPrice(networkName),
            this.getBalance(networkName)
        ]);

        return {
            name: networkName,
            chainId: client.config.chain.id,
            gasPrice,
            balance,
            address: client.account.address
        };
    }

    /**
     * Get network information for all networks
     */
    public async getAllNetworkInfo(): Promise<Map<string, {
        name: string;
        chainId: number;
        gasPrice: bigint;
        balance: bigint;
        address: Address;
    }>> {
        const networkInfo = new Map();
        
        const infoPromises = Array.from(this.networks.keys()).map(async (networkName) => {
            try {
                const info = await this.getNetworkInfo(networkName);
                networkInfo.set(networkName, info);
            } catch (error) {
                console.error(`Failed to get network info for ${networkName}:`, error);
            }
        });

        await Promise.all(infoPromises);
        return networkInfo;
    }

    /**
     * Utility methods
     */
    public getNativeTokenMetadata(networkName: string): {
        symbol: string;
        decimals: number;
        coingeckoId?: string;
    } {
        const client = this.networks.get(networkName);
        if (!client) {
            throw new Error(`Network ${networkName} not found or not enabled`);
        }

        return {
            symbol: client.config.nativeTokenSymbol ?? client.config.chain.nativeCurrency.symbol,
            decimals: client.config.nativeTokenDecimals ?? client.config.chain.nativeCurrency.decimals,
            coingeckoId: client.config.nativeTokenCoingeckoId
        };
    }

    public formatEther(wei: bigint): string {
        return formatEther(wei);
    }

    public parseEther(ether: string): bigint {
        return parseEther(ether);
    }

    public formatUnits(value: bigint, decimals: number): string {
        return formatUnits(value, decimals);
    }

    public parseUnits(value: string, decimals: number): bigint {
        return parseUnits(value, decimals);
    }

    /**
     * Get the same address across all networks (since we use the same private key)
     */
    public getAddress(): Address {
        const firstNetwork = Array.from(this.networks.values())[0];
        if (!firstNetwork) {
            throw new Error('No networks initialized');
        }
        return firstNetwork.account.address;
    }
}

// Export singleton instance
export const multiNetworkEthereumService = new MultiNetworkEthereumService();
export default MultiNetworkEthereumService;
