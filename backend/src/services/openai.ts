import OpenAI from 'openai';
import dotenv from 'dotenv';
import { FlexibleBatchClearer, FlexibleBatchStore, FlexibleNonBatchStore, FlexibleOpenAIBatch, FlexibleNonBatchClearer, FlexibleBatchStoreCache, FlexibleOpenAINonBatch, FlexibleOpenAIBatchOutput, FlexibleOpenAINonBatchOutput } from 'flexible-batches';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

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

class OurBatchStore implements FlexibleBatchStore {
  private batchesId: string | undefined;

  constructor(private readonly prisma: PrismaClient) {}

  async init(): Promise<void> {
    const batches = await this.prisma.batches.create({data: {}});
    this.batchesId = batches.id.toString();
  }

  async getStoreId(): Promise<string> {
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

class OurNonBatchStore implements FlexibleNonBatchStore {
  private store: string;
  constructor(private readonly prisma: PrismaClient) {
    this.store = uuidv4();
  }
  async getStoreId(): Promise<string> {
    return this.store;
  }
  async storeResponseByCustomId(props: {
    customId: string; response: OpenAI.Responses.Response;
  }): Promise<void> {
    await this.prisma.nonBatchMapping.create({
      data: {
        customId: props.customId,
        response: JSON.stringify(props.response),
        nonBatchId: BigInt(this.store),
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

class OurClearer implements FlexibleBatchClearer, FlexibleNonBatchClearer {
  constructor(private readonly prisma: PrismaClient) {}

  async clear(storeId: string): Promise<void> {
    // Delete both batch and non-batch data, as necessary if the server switches between batch and non-batch modes.
    await this.prisma.batches.delete({where: {id: BigInt(storeId)}});
    await this.prisma.nonBatches.delete({where: {id: BigInt(storeId)}});
  }
}

const openAIFlexMode = process.env.OPENAI_FLEX_MODE as 'batch' | 'nonbatch';

/// Centralized code. Probably, should be refactored.
async function createOpenAISession() {
  let result;
  if (openAIFlexMode === 'batch') {
    const store = new OurBatchStore(prisma);
    result = {
      runner: new FlexibleOpenAIBatch(openai, "/v1/responses", new FlexibleBatchStoreCache(store)),
      outputter: new FlexibleOpenAIBatchOutput(openai, store),
      clearer: new OurClearer(prisma),
    }
  } else if (openAIFlexMode === 'nonbatch') {
    const store = new OurNonBatchStore(prisma);
    result = {
      runner: new FlexibleOpenAINonBatch(openai, "/v1/responses", store),
      outputter: new FlexibleOpenAINonBatchOutput(store),
      clearer: new OurClearer(prisma),
    }
  }
  await result!.runner.init();
  return result;
};

/**
 * Utility function to check if OpenAI is properly configured
 * @returns boolean indicating if API key is set
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Health check function to test OpenAI connection
 * @returns Promise with test result
 */
export async function testOpenAIConnection(): Promise<{ success: boolean; message: string }> {
  try {
    if (!isOpenAIConfigured()) {
      return {
        success: false,
        message: 'OpenAI API key not configured'
      };
    }

    // Simple test call
    const response = await generateText('Say "Hello" to test the connection.', {
      maxTokens: 10,
      temperature: 0
    });

    return {
      success: true,
      message: `Connection successful. Response: ${response.trim()}`
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Export the OpenAI client instance for advanced usage
export { openai };
