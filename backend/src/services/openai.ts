import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * OpenAI Service Configuration
 */
export interface OpenAIConfig {
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
const DEFAULT_CONFIG: OpenAIConfig = {
  model: process.env.OPENAI_MODEL!,
  maxTokens: 1000,
  temperature: 0.7,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

// FIXME: The below code allows hackers to spend out OpenAI credits.

/**
 * Chat completion function
 * @param messages - Array of chat messages
 * @param config - Optional configuration overrides
 * @returns Promise with OpenAI chat completion response
 */
export async function createChatCompletion(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  config: OpenAIConfig = {}
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  try {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    
    const completion = await openai.chat.completions.create({
      model: finalConfig.model!,
      messages,
      max_tokens: finalConfig.maxTokens,
      temperature: finalConfig.temperature,
      top_p: finalConfig.topP,
      frequency_penalty: finalConfig.frequencyPenalty,
      presence_penalty: finalConfig.presencePenalty,
    });

    return completion;
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw new Error(`OpenAI API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Simple text completion function for easier use
 * @param prompt - The text prompt to send
 * @param config - Optional configuration overrides
 * @returns Promise with the generated text response
 */
export async function generateText(
  prompt: string,
  config: OpenAIConfig = {}
): Promise<string> {
  try {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt }
    ];

    const completion = await createChatCompletion(messages, config);
    
    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response content received from OpenAI');
    }

    return response;
  } catch (error) {
    console.error('Text generation error:', error);
    throw error;
  }
}

/**
 * Function to generate embeddings for text
 * @param text - Text to generate embeddings for
 * @param model - Embedding model to use (default: text-embedding-ada-002)
 * @returns Promise with embedding vector
 */
export async function createEmbedding(
  text: string,
  model: string = 'text-embedding-ada-002'
): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model,
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Embedding generation error:', error);
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Function to moderate content
 * @param input - Text to moderate
 * @returns Promise with moderation results
 */
export async function moderateContent(input: string): Promise<OpenAI.Moderations.ModerationCreateResponse> {
  try {
    const moderation = await openai.moderations.create({
      input,
    });

    return moderation;
  } catch (error) {
    console.error('Content moderation error:', error);
    throw new Error(`Content moderation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

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
