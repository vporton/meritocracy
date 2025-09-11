import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Ethereum configuration from secret file
function loadEthereumConfig(): { privateKey: string; mnemonic?: string; network: string; rpcUrl?: string } {
    const configPath = path.join(__dirname, '../../ethereum-keys.secret');
    
    if (!fs.existsSync(configPath)) {
        throw new Error('Ethereum configuration file not found. Please create ethereum-keys.secret file.');
    }
    
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config: any = {};
    
    // Parse the config file
    const lines = configContent.split('\n');
    for (const line of lines) {
        if (line.trim() && !line.trim().startsWith('#')) {
            const [key, value] = line.split('=');
            if (key && value) {
                config[key.trim()] = value.trim();
            }
        }
    }
    
    return {
        privateKey: config.ETHEREUM_PRIVATE_KEY,
        mnemonic: config.ETHEREUM_MNEMONIC,
        network: config.ETHEREUM_NETWORK || 'mainnet',
        rpcUrl: process.env.ETHEREUM_RPC_URL
    };
}

class EthereumService {
    private provider!: ethers.Provider;
    private signer!: ethers.Wallet | ethers.HDNodeWallet;
    private config: ReturnType<typeof loadEthereumConfig>;

    constructor() {
        this.config = loadEthereumConfig();
        this.initializeProvider();
        this.initializeSigner();
    }

    private initializeProvider(): void {
        // Initialize provider based on network
        if (this.config.rpcUrl) {
            // Use custom RPC URL if provided
            this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
        } else {
            // Use default providers for common networks
            switch (this.config.network) {
                case 'mainnet':
                    this.provider = ethers.getDefaultProvider('mainnet');
                    break;
                case 'goerli':
                    this.provider = ethers.getDefaultProvider('goerli');
                    break;
                case 'sepolia':
                    this.provider = ethers.getDefaultProvider('sepolia');
                    break;
                case 'polygon':
                    this.provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
                    break;
                case 'localhost':
                    this.provider = new ethers.JsonRpcProvider('http://localhost:8545');
                    break;
                default:
                    this.provider = ethers.getDefaultProvider('mainnet');
            }
        }
    }

    private initializeSigner(): void {
        if (this.config.mnemonic) {
            // Create wallet from mnemonic
            const wallet = ethers.Wallet.fromPhrase(this.config.mnemonic);
            this.signer = wallet.connect(this.provider);
        } else if (this.config.privateKey) {
            // Create wallet from private key
            this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
        } else {
            throw new Error('No private key or mnemonic found in configuration');
        }
    }

    // Getter methods
    public getProvider(): ethers.Provider {
        return this.provider;
    }

    public getSigner(): ethers.Wallet | ethers.HDNodeWallet {
        return this.signer;
    }

    public getAddress(): string {
        return this.signer.address;
    }

    // Utility methods
    public async getBalance(): Promise<bigint> {
        return await this.provider.getBalance(this.signer.address);
    }

    public async getNetwork(): Promise<ethers.Network> {
        return await this.provider.getNetwork();
    }

    public async sendTransaction(to: string, value: string, data?: string): Promise<ethers.TransactionResponse> {
        const tx = {
            to,
            value: ethers.parseEther(value),
            data: data || '0x'
        };

        return await this.signer.sendTransaction(tx);
    }

    // Contract interaction helper
    public getContract(address: string, abi: ethers.InterfaceAbi): ethers.Contract {
        return new ethers.Contract(address, abi, this.signer);
    }

    // Sign message
    public async signMessage(message: string): Promise<string> {
        return await this.signer.signMessage(message);
    }

    // Verify signature
    public verifyMessage(message: string, signature: string): string {
        return ethers.verifyMessage(message, signature);
    }
}

// Export singleton instance
export const ethereumService = new EthereumService();
export default EthereumService;
