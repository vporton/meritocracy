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

export default router;
