import { 
    createPublicClient, 
    createWalletClient, 
    http, 
    parseEther, 
    formatEther,
    getContract,
    type PublicClient,
    type WalletClient,
    type Address,
    type Hash,
    type Chain
} from 'viem';
import { mainnet, sepolia, polygon, arbitrum, optimism, base, localhost } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();
dotenv.config({ path: 'ethereum-keys.secret' });

export interface NetworkConfig {
    name: string;
    chain: Chain;
    rpcUrl?: string;
    enabled: boolean;
    gasReserve: number; // ETH amount to keep as gas reserve
    minimumDistributionUsd: number; // Minimum USD amount to distribute
}

export interface NetworkClient {
    publicClient: PublicClient;
    walletClient: WalletClient;
    account: ReturnType<typeof privateKeyToAccount>;
    config: NetworkConfig;
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
        const networkConfigs: NetworkConfig[] = [
            {
                name: 'mainnet',
                chain: mainnet,
                rpcUrl: process.env.ETHEREUM_MAINNET_RPC_URL,
                enabled: process.env.ETHEREUM_MAINNET_ENABLED === 'true',
                gasReserve: 0.01,
                minimumDistributionUsd: 20
            },
            {
                name: 'polygon',
                chain: polygon,
                rpcUrl: process.env.ETHEREUM_POLYGON_RPC_URL,
                enabled: process.env.ETHEREUM_POLYGON_ENABLED === 'true',
                gasReserve: 0.1, // Higher reserve for Polygon due to lower gas costs
                minimumDistributionUsd: 5 // Lower threshold for Polygon
            },
            {
                name: 'arbitrum',
                chain: arbitrum,
                rpcUrl: process.env.ETHEREUM_ARBITRUM_RPC_URL,
                enabled: process.env.ETHEREUM_ARBITRUM_ENABLED === 'true',
                gasReserve: 0.005,
                minimumDistributionUsd: 10
            },
            {
                name: 'optimism',
                chain: optimism,
                rpcUrl: process.env.ETHEREUM_OPTIMISM_RPC_URL,
                enabled: process.env.ETHEREUM_OPTIMISM_ENABLED === 'true',
                gasReserve: 0.005,
                minimumDistributionUsd: 10
            },
            {
                name: 'base',
                chain: base,
                rpcUrl: process.env.ETHEREUM_BASE_RPC_URL,
                enabled: process.env.ETHEREUM_BASE_ENABLED === 'true',
                gasReserve: 0.005,
                minimumDistributionUsd: 10
            },
            {
                name: 'sepolia',
                chain: sepolia,
                rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC_URL,
                enabled: process.env.ETHEREUM_SEPOLIA_ENABLED === 'true',
                gasReserve: 0.01,
                minimumDistributionUsd: 0.1 // Very low for testnet
            },
            {
                name: 'localhost',
                chain: localhost,
                rpcUrl: process.env.ETHEREUM_LOCALHOST_RPC_URL || 'http://localhost:8545',
                enabled: process.env.ETHEREUM_LOCALHOST_ENABLED === 'true',
                gasReserve: 0.01,
                minimumDistributionUsd: 0.1
            }
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
    public formatEther(wei: bigint): string {
        return formatEther(wei);
    }

    public parseEther(ether: string): bigint {
        return parseEther(ether);
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
