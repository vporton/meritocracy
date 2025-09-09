import OpenAI from 'openai';
import dotenv from 'dotenv';
import { FlexibleBatchClearer, FlexibleBatchStore, FlexibleNonBatchStore, FlexibleOpenAIBatch, FlexibleBatchStoreCache, FlexibleOpenAINonBatch, FlexibleOpenAIBatchOutput, FlexibleOpenAINonBatchOutput, FlexibleStore } from 'flexible-batches';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { assert } from 'console';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * OpenAI Service Configuration
 */
export interface OpenAIConfig { // TODO: more options?
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

/**
 * Default configuration for OpenAI API calls
 */
const DEFAULT_CONFIG: OpenAIConfig = { // TODO
  model: process.env.OPENAI_MODEL!,
  maxTokens: 2000,
  temperature: 0.7,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

abstract class OurClearer implements FlexibleStore {
  constructor(protected readonly prisma: PrismaClient) {}
  async init(): Promise<void> {}
  abstract getStoreId(): string;
  async clear(): Promise<void> {
    // Delete both batch and non-batch data, as necessary if the server switches between batch and non-batch modes.
    await this.prisma.batches.delete({where: {id: BigInt(this.getStoreId())}});
    await this.prisma.nonBatches.delete({where: {id: BigInt(this.getStoreId())}});
  }
}

class OurBatchStore extends OurClearer implements FlexibleBatchStore {
  constructor(prisma: PrismaClient, private batchesId: string | undefined) {
    super(prisma);
  }
  async init(): Promise<void> {
    assert(this.batchesId === undefined, "cannot initialize batchesId second time");
    const batches = await this.prisma.batches.create({data: {}});
    this.batchesId = batches.id.toString();
  }
  getStoreId(): string {
    return this.batchesId!;
  }
  async getClearingId(): Promise<string> {
    return this.batchesId!;
  }
  async storeBatchIdByCustomId(props: { customId: string; batchId: string; }): Promise<void> {
    await this.prisma.batchMapping.create({
      data: {
        customId: props.customId,
        batchId: BigInt(props.batchId),
      },
    });
  }
  async getBatchIdByCustomId(customId: string): Promise<string | undefined> {
    const mapping = await this.prisma.batchMapping.findUnique({
      where: { customId },
    });
    return mapping?.batchId?.toString();
  }
}

class OurNonBatchStore extends OurClearer implements FlexibleNonBatchStore {
  constructor(prisma: PrismaClient, private storeId: string | undefined) {
    super(prisma);
    this.storeId = uuidv4();
  }
  async init(): Promise<void> {
    assert(this.storeId === undefined, "cannot initialize storeId second time");
    const batches = await this.prisma.batches.create({data: {}});
    this.storeId = batches.id.toString();
  }
  getStoreId(): string {
    return this.storeId!;
  }
  async storeResponseByCustomId(props: {
    customId: string; response: OpenAI.Responses.Response;
  }): Promise<void> {
    await this.prisma.nonBatchMapping.create({
      data: {
        customId: props.customId,
        response: JSON.stringify(props.response),
        nonBatchId: BigInt(this.storeId!),
      },
    });
  }
  async getResponseByCustomId(customId: string): Promise<OpenAI.Responses.Response | undefined> {
    const response = await this.prisma.nonBatchMapping.findUnique({
      where: { customId },
    });
    return response?.response ? JSON.parse(response.response) : undefined; // TODO: Make it throw instead of returning undefined?
  }
}

const openAIFlexMode = process.env.OPENAI_FLEX_MODE as 'batch' | 'nonbatch';

/// Centralized code. Probably, should be refactored.
export async function createAIBatchStore(storeId: string | undefined) {
  const store = openAIFlexMode === 'batch' ? new OurBatchStore(prisma, storeId) : new OurNonBatchStore(prisma, storeId);
  await store.init();
  return store;
}

export async function createAIRunner(store: FlexibleBatchStore | FlexibleNonBatchStore) {
  const result = openAIFlexMode === 'batch' ?
    new FlexibleOpenAIBatch(openai, "/v1/responses", new FlexibleBatchStoreCache(store as FlexibleBatchStore)) :
    new FlexibleOpenAINonBatch(openai, "/v1/responses", store as FlexibleNonBatchStore);
  await result.init();
  return result;
}

export async function createAIOutputter(store: FlexibleBatchStore | FlexibleNonBatchStore) {
  const result = openAIFlexMode === 'batch' ?
    new FlexibleOpenAIBatchOutput(openai, store as FlexibleBatchStore) : 
    new FlexibleOpenAINonBatchOutput(store as FlexibleNonBatchStore);
  await result.init();
  return result;
};

/**
 * Utility function to check if OpenAI is properly configured
 * @returns boolean indicating if API key is set
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// TODO
/**
 * Health check function to test OpenAI connection
 * @returns Promise with test result
 */
// export async function testOpenAIConnection(): Promise<{ success: boolean; message: string }> {
//   try {
//     if (!isOpenAIConfigured()) {
//       return {
//         success: false,
//         message: 'OpenAI API key not configured'
//       };
//     }

//     // Simple test call
//     const response = await generateText('Say "Hello" to test the connection.', {
//       maxTokens: 10,
//       temperature: 0
//     });

//     return {
//       success: true,
//       message: `Connection successful. Response: ${response.trim()}`
//     };
//   } catch (error) {
//     return {
//       success: false,
//       message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
//     };
//   }
// }

// Export the OpenAI client instance for advanced usage
export { openai };
