import express from 'express';
import { 
  generateText, 
  createChatCompletion, 
  createEmbedding, 
  moderateContent, 
  testOpenAIConnection,
  isOpenAIConfigured,
  OpenAIConfig 
} from '../services/openai';

const router = express.Router();

/**
 * GET /api/ai/health
 * Test OpenAI connection and configuration
 */
router.get('/health', async (req, res) => {
  try {
    const result = await testOpenAIConnection();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/ai/generate
 * Generate text using OpenAI
 * Body: { prompt: string, config?: OpenAIConfig }
 */
router.post('/generate', async (req, res) => {
  try {
    if (!isOpenAIConfigured()) {
      return res.status(500).json({
        error: 'OpenAI not configured',
        message: 'OpenAI API key is not set in environment variables'
      });
    }

    const { prompt, config } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Prompt is required and must be a string'
      });
    }

    const response = await generateText(prompt, config);

    res.json({
      success: true,
      response,
      prompt,
      config: config || 'default'
    });
  } catch (error) {
    console.error('Text generation error:', error);
    res.status(500).json({
      error: 'Text generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/ai/chat
 * Chat completion using OpenAI
 * Body: { messages: Array, config?: OpenAIConfig }
 */
router.post('/chat', async (req, res) => {
  try {
    if (!isOpenAIConfigured()) {
      return res.status(500).json({
        error: 'OpenAI not configured',
        message: 'OpenAI API key is not set in environment variables'
      });
    }

    const { messages, config } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Messages array is required and must not be empty'
      });
    }

    const completion = await createChatCompletion(messages, config);

    res.json({
      success: true,
      completion,
      usage: completion.usage
    });
  } catch (error) {
    console.error('Chat completion error:', error);
    res.status(500).json({
      error: 'Chat completion failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/ai/embeddings
 * Generate embeddings for text
 * Body: { text: string, model?: string }
 */
router.post('/embeddings', async (req, res) => {
  try {
    if (!isOpenAIConfigured()) {
      return res.status(500).json({
        error: 'OpenAI not configured',
        message: 'OpenAI API key is not set in environment variables'
      });
    }

    const { text, model } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Text is required and must be a string'
      });
    }

    const embedding = await createEmbedding(text, model);

    res.json({
      success: true,
      embedding,
      dimensions: embedding.length,
      text: text.substring(0, 100) + (text.length > 100 ? '...' : '')
    });
  } catch (error) {
    console.error('Embedding generation error:', error);
    res.status(500).json({
      error: 'Embedding generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/ai/moderate
 * Moderate content using OpenAI
 * Body: { input: string }
 */
router.post('/moderate', async (req, res) => {
  try {
    if (!isOpenAIConfigured()) {
      return res.status(500).json({
        error: 'OpenAI not configured',
        message: 'OpenAI API key is not set in environment variables'
      });
    }

    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Input is required and must be a string'
      });
    }

    const moderation = await moderateContent(input);

    res.json({
      success: true,
      moderation,
      flagged: moderation.results[0]?.flagged || false
    });
  } catch (error) {
    console.error('Content moderation error:', error);
    res.status(500).json({
      error: 'Content moderation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
