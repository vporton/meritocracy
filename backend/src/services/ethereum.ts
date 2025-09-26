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
import { mainnet, sepolia, polygon, localhost } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// TODO@P3: duplicate code
dotenv.config();
dotenv.config({ path: 'ethereum-keys.secret' });

// Get __dirname equivalent for ES modules
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// Load Ethereum configuration from secret file
function loadEthereumConfig(): { privateKey?: string; mnemonic?: string; network: string; rpcUrl?: string } {
    return {
        privateKey: process.env.ETHEREUM_PRIVATE_KEY,
        mnemonic: process.env.ETHEREUM_MNEMONIC,
        network: process.env.ETHEREUM_NETWORK || 'mainnet',
        rpcUrl: process.env.ETHEREUM_RPC_URL
    };
}

class EthereumService {
    private publicClient!: PublicClient;
    private walletClient!: WalletClient;
    private account!: ReturnType<typeof privateKeyToAccount>;
    private config: ReturnType<typeof loadEthereumConfig>;

    constructor() {
        this.config = loadEthereumConfig();
        this.initializeClients();
        this.initializeAccount();
    }

    private getChain(): Chain {
        // Return appropriate chain based on network
        switch (this.config.network) {
            case 'mainnet':
                return mainnet;
            case 'sepolia':
                return sepolia;
            case 'localhost':
                return localhost;
            default:
                return mainnet;
        }
    }

    private initializeClients(): void {
        const chain = this.getChain();
        
        // Initialize public client for read operations
        this.publicClient = createPublicClient({
            chain,
            transport: this.config.rpcUrl ? http(this.config.rpcUrl) : http()
        });

        // Initialize wallet client for write operations
        this.walletClient = createWalletClient({
            chain,
            transport: this.config.rpcUrl ? http(this.config.rpcUrl) : http()
        });
    }

    private initializeAccount(): void {
        if (this.config.privateKey) {
            // Create account from private key
            this.account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
        } else if (this.config.mnemonic) {
            // Note: Viem doesn't have built-in mnemonic support like ethers
            // You would need to use a library like @scure/bip39 to derive the private key
            // For now, we'll throw an error and suggest using private key
            throw new Error('Mnemonic support not implemented. Please use ETHEREUM_PRIVATE_KEY instead.');
        } else {
            throw new Error('No private key or mnemonic found in configuration');
        }
    }

    // Getter methods
    public getPublicClient(): PublicClient {
        return this.publicClient;
    }

    public getWalletClient(): WalletClient {
        return this.walletClient;
    }

    public getAccount(): ReturnType<typeof privateKeyToAccount> {
        return this.account;
    }

    public getAddress(): Address {
        return this.account.address;
    }

    // Utility methods
    public async getBalance(): Promise<bigint> {
        return await this.publicClient.getBalance({ address: this.account.address });
    }

    public async getNetwork(): Promise<Chain> {
        return this.publicClient.chain!;
    }

    public async sendTransaction(to: Address, value: string, data?: `0x${string}`): Promise<Hash> {
        return await this.walletClient.sendTransaction({
            account: this.account,
            to,
            value: parseEther(value),
            data: data || '0x',
            chain: this.publicClient.chain
        });
    }

    // Contract interaction helper
    public getContract(address: Address, abi: any) {
        return getContract({
            address,
            abi,
            client: {
                public: this.publicClient,
                wallet: this.walletClient
            }
        });
    }

    // Sign message
    public async signMessage(message: string): Promise<`0x${string}`> {
        return await this.walletClient.signMessage({
            account: this.account,
            message
        });
    }

    // Verify signature
    public async verifyMessage(message: string, signature: `0x${string}`): Promise<boolean> {
        return await this.publicClient.verifyMessage({
            address: this.account.address,
            message,
            signature
        });
    }

    // Additional utility methods
    public formatEther(wei: bigint): string {
        return formatEther(wei);
    }

    public parseEther(ether: string): bigint {
        return parseEther(ether);
    }
}

// Export singleton instance
export const ethereumService = new EthereumService();
export default EthereumService;
