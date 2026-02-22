import { generatePrivateKey } from 'viem/accounts';
import { Keypair as SolanaKeypair } from '@solana/web3.js';
import { Keypair as StellarKeypair } from '@stellar/stellar-sdk';
import { mnemonicGenerate, cryptoWaitReady } from '@polkadot/util-crypto';
import { ECPairFactory } from 'ecpair';
import * as tinysecp from 'tiny-secp256k1';
import bs58 from 'bs58';
import { createPrivateKey, generateKeyPairSync, webcrypto } from 'node:crypto';
import process from 'process';
import dotenv from 'dotenv';
import fs from 'fs';

import { prisma } from '../lib/prisma.js';
const ECPair = ECPairFactory(tinysecp as any);

export class SystemSecretService {
    private static instance: SystemSecretService;
    private initialized = false;

    private constructor() { }

    public static getInstance(): SystemSecretService {
        if (!SystemSecretService.instance) {
            SystemSecretService.instance = new SystemSecretService();
        }
        return SystemSecretService.instance;
    }

    /**
     * Initialize secrets from .secret files if they are not already in the DB.
     * This handles migration for existing setups.
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        await cryptoWaitReady();

        // Ensure essential secrets exist (generate if missing)
        const essentialSecrets = [
            'ETHEREUM_PRIVATE_KEY',
            'SOLANA_SECRET_KEY_BASE58',
            'STELLAR_SECRET_KEY',
            'POLKADOT_SECRET_URI',
            'BITCOIN_WIF',
            'COSMOS_MNEMONIC',
            'ICP_IDENTITY_PEM'
        ];

        for (const name of essentialSecrets) {
            await this.ensureSecret(name);
        }

        // Load all secrets from DB into process.env for backward compatibility
        const allSecrets = await (prisma as any).systemSecret.findMany();
        for (const secret of allSecrets) {
            if (!process.env[secret.name]) {
                process.env[secret.name] = secret.value;
            }
        }

        this.initialized = true;
        console.log('✅ SystemSecretService initialized');
    }

    public async getSecret(name: string): Promise<string | null> {
        const secret = await prisma.systemSecret.findUnique({
            where: { name },
        });

        if (secret) {
            return secret.value;
        }

        // fallback to process.env if not in DB (for transition)
        return process.env[name] || null; // FIXME@P3: nonsense
    }

    public async ensureSecret(name: string, defaultValue?: string): Promise<string> {
        const existing = await this.getSecret(name);
        if (existing) return existing;

        const value = defaultValue || this.generateSecretForName(name);

        await (prisma as any).systemSecret.upsert({
            where: { name },
            update: { value },
            create: { name, value }
        });

        return value;
    }

    public async ensureSecretInDb(name: string, defaultValue?: string): Promise<string> {
        const existing = await prisma.systemSecret.findUnique({
            where: { name },
        });
        if (existing?.value?.trim()) {
            return existing.value;
        }

        const value = defaultValue || this.generateSecretForName(name);
        await (prisma as any).systemSecret.upsert({
            where: { name },
            update: { value },
            create: { name, value }
        });

        return value;
    }

    private generateSecretForName(name: string): string {
        if (name === 'ETHEREUM_PRIVATE_KEY') {
            return generatePrivateKey();
        }
        if (name === 'SOLANA_SECRET_KEY_BASE58') {
            const keypair = SolanaKeypair.generate();
            return bs58.encode(Buffer.from(keypair.secretKey));
        }
        if (name === 'STELLAR_SECRET_KEY') {
            const keypair = StellarKeypair.random();
            return keypair.secret();
        }
        if (name === 'POLKADOT_SECRET_URI') {
            return mnemonicGenerate();
        }
        if (name === 'BITCOIN_WIF') {
            const keyPair = ECPair.makeRandom();
            return keyPair.toWIF();
        }
        if (name === 'COSMOS_MNEMONIC') {
            return mnemonicGenerate();
        }
        if (name === 'ICP_IDENTITY_PEM') {
            const { privateKey } = generateKeyPairSync('ed25519');
            return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
        }

        // Generic fallback: random hex
        return Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('hex');
    }

    private isValidIcpIdentityPem(value: string): boolean {
        const trimmed = value.trim();
        if (!trimmed.startsWith('-----BEGIN')) {
            return false;
        }
        try {
            createPrivateKey({ key: trimmed, format: 'pem' });
            return true;
        } catch {
            return false;
        }
    }

    public async setSecret(name: string, value: string): Promise<void> {
        await (prisma as any).systemSecret.upsert({
            where: { name },
            update: { value },
            create: { name, value }
        });
    }
    private getSecretNameForCountry(network: string, country: string): string {
        const n = network.toUpperCase();
        const c = country.toUpperCase();

        let family = 'EVM';
        if (n.includes('BITCOIN')) family = 'BITCOIN';
        else if (n.includes('SOLANA')) family = 'SOLANA';
        else if (n.includes('STELLAR')) family = 'STELLAR';
        else if (n.includes('POLKADOT')) family = 'POLKADOT';
        else if (n.includes('COSMOS')) family = 'COSMOS';
        else if (n.includes('ICP')) family = 'ICP';

        return `${family}_PRIVATE_KEY_COUNTRY_${c}`;
    }

    public async getCountrySecret(network: string, country: string): Promise<string | null> {
        const name = this.getSecretNameForCountry(network, country);
        return await this.getSecret(name);
    }

    public async ensureCountrySecret(network: string, country: string): Promise<string> {
        const name = this.getSecretNameForCountry(network, country);
        const existing = await this.getSecret(name);
        if (existing) {
            if (!name.startsWith('ICP') || this.isValidIcpIdentityPem(existing)) {
                return existing;
            }
            console.warn(`⚠️ Invalid ICP country secret format for ${name}, regenerating.`);
        }

        let value: string;
        // Generate appropriate key format based on network prefix
        if (name.startsWith('BITCOIN')) {
            value = this.generateSecretForName('BITCOIN_WIF');
        } else if (name.startsWith('SOLANA')) {
            value = this.generateSecretForName('SOLANA_SECRET_KEY_BASE58');
        } else if (name.startsWith('STELLAR')) {
            value = this.generateSecretForName('STELLAR_SECRET_KEY');
        } else if (name.startsWith('POLKADOT')) {
            value = this.generateSecretForName('POLKADOT_SECRET_URI');
        } else if (name.startsWith('COSMOS')) {
            value = this.generateSecretForName('COSMOS_MNEMONIC');
        } else if (name.startsWith('ICP')) {
            value = this.generateSecretForName('ICP_IDENTITY_PEM');
        } else {
            // Default to EVM style (Ethereum) for others
            value = this.generateSecretForName('ETHEREUM_PRIVATE_KEY');
        }

        await (prisma as any).systemSecret.upsert({
            where: { name },
            update: { value },
            create: { name, value }
        });

        return value;
    }
}

export const systemSecretService = SystemSecretService.getInstance();
