# OpenAI Integration

This document describes how to use the OpenAI integration in the socialism backend.

## Setup

1. **Install Dependencies**: The OpenAI package is already installed as part of the project dependencies.

2. **Configure API Key**: Add your OpenAI API key to your `.env` file:
   ```bash
   # Copy from env.example if you haven't already
   cp env.example .env
   
   # Edit .env and set your OpenAI API key
   OPENAI_API_KEY=your-actual-openai-api-key-here
   ```

3. **Get an OpenAI API Key**: 
   - Visit [OpenAI Platform](https://platform.openai.com/)
   - Create an account or log in
   - Go to API Keys section
   - Create a new secret key

## Usage

### Service Functions

The OpenAI service (`src/services/openai.ts`) provides several functions:

#### Text Generation
```typescript
import { generateText } from '../services/openai';

const response = await generateText("Write a short poem about coding", {
  maxTokens: 100,
  temperature: 0.8
});
```

#### Chat Completion
```typescript
import { createChatCompletion } from '../services/openai';

const messages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' }
];

const completion = await createChatCompletion(messages);
```

#### Embeddings
```typescript
import { createEmbedding } from '../services/openai';

const embedding = await createEmbedding("Text to embed");
```

#### Content Moderation
```typescript
import { moderateContent } from '../services/openai';

const moderation = await moderateContent("Content to check");
```

### API Endpoints

The following REST API endpoints are available:

#### Health Check
```bash
GET /api/ai/health
```
Tests the OpenAI connection and returns configuration status.

#### Text Generation
```bash
POST /api/ai/generate
Content-Type: application/json

{
  "prompt": "Write a short story about AI",
  "config": {
    "maxTokens": 200,
    "temperature": 0.7
  }
}
```

#### Chat Completion
```bash
POST /api/ai/chat
Content-Type: application/json

{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "config": {
    "maxTokens": 150,
    "temperature": 0.8
  }
}
```

#### Generate Embeddings
```bash
POST /api/ai/embeddings
Content-Type: application/json

{
  "text": "Text to generate embeddings for",
  "model": "text-embedding-ada-002"
}
```

#### Content Moderation
```bash
POST /api/ai/moderate
Content-Type: application/json

{
  "input": "Content to moderate"
}
```

## Configuration Options

The `OpenAIConfig` interface allows you to customize API calls:

```typescript
interface OpenAIConfig {
  model?: string;           // Default: 'gpt-3.5-turbo'
  maxTokens?: number;       // Default: 1000
  temperature?: number;     // Default: 0.7 (0-2, higher = more random)
  topP?: number;           // Default: 1 (nucleus sampling)
  frequencyPenalty?: number; // Default: 0 (-2 to 2)
  presencePenalty?: number;  // Default: 0 (-2 to 2)
}
```

## Available Models

Common OpenAI models you can use:

- **Chat Models**: `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **Embedding Models**: `text-embedding-ada-002`, `text-embedding-3-small`, `text-embedding-3-large`

## Error Handling

All functions include proper error handling and will throw descriptive errors if:
- API key is missing or invalid
- API rate limits are exceeded
- Network issues occur
- Invalid parameters are provided

## Security Notes

- Never commit your actual API key to version control
- Use environment variables for API key storage
- Consider implementing rate limiting for API endpoints
- Monitor API usage and costs in the OpenAI dashboard

## Testing

Test your configuration:

```bash
# Check if OpenAI is working
curl http://localhost:3001/api/ai/health

# Simple text generation test
curl -X POST http://localhost:3001/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Say hello!"}'
```
