# User Evaluation System

This document describes the user evaluation system that implements the flow graph described in the requirements. The system uses OpenAI API with response schema to evaluate users based on their scientific and FOSS contributions.

## Overview

The user evaluation system creates a flow graph of tasks that:

1. **Scientist Check**: Determines if a user is an active scientist or FOSS developer
2. **Worth Assessment**: Calculates the user's worth as a fraction of world GDP
3. **Conditional Logic**: If worth > 1e-11, performs additional checks
4. **Prompt Injection Detection**: Checks for prompt injection attempts (3 times)
5. **Additional Worth Assessments**: Performs 2 more worth assessments if threshold is met
6. **Median Calculation**: Calculates the median salary from all worth assessments
7. **Ban Logic**: Bans users for 1 year if prompt injection is detected

## Architecture

### TaskRunners

The system implements several TaskRunner classes:

- **`ScientistCheckRunner`**: Uses OpenAI to check if user is an active scientist/FOSS dev
- **`WorthAssessmentRunner`**: Uses OpenAI to assess user worth with randomized prompts
- **`PromptInjectionRunner`**: Uses OpenAI to detect prompt injection attempts
- **`WorthThresholdCheckRunner`**: Checks if worth exceeds 1e-11 threshold
- **`MedianRunner`**: Calculates median from dependency results
- **`BanUserRunner`**: Bans users when prompt injection is detected

### Flow Graph

```
                    ┌─────────────────┐
                    │  Scientist      │
                    │  Check          │
                    └─────────┬───────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Worth          │
                    │  Assessment #1  │
                    └─────────┬───────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Worth > 1e-11? │
                    └─────────┬───────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
            ┌─────────────┐    ┌─────────────────┐
            │   Median    │    │  Prompt         │
            │ (1 value)   │    │  Injection      │
            └─────────────┘    │  Check (3x)     │
                               └─────────┬───────┘
                                         │
                               ┌─────────┴─────────┐
                               │                   │
                               ▼                   ▼
                       ┌─────────────┐    ┌─────────────────┐
                       │  Ban User   │    │  Worth          │
                       │ (1 year)    │    │  Assessment #2  │
                       └─────────────┘    └─────────┬───────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │  Worth          │
                                           │  Assessment #3  │
                                           └─────────┬───────┘
                                                     │
                                                     ▼
                                           ┌─────────────────┐
                                           │   Median        │
                                           │ (3 values)      │
                                           └─────────────────┘
```

## Usage

### API Endpoints

#### Start Evaluation
```http
POST /api/evaluation/start
Content-Type: application/json

{
  "userId": 1,
  "userData": {
    "orcidId": "0000-0000-0000-0000",
    "githubHandle": "username",
    "bitbucketHandle": "username",
    "gitlabHandle": "username"
  }
}
```

#### Execute Tasks
```http
POST /api/evaluation/execute
```

#### Get Result
```http
GET /api/evaluation/result/:userId
```

#### Get Status
```http
GET /api/evaluation/status/:userId
```

#### Complete Evaluation (Start + Execute)
```http
POST /api/evaluation/complete
Content-Type: application/json

{
  "userId": 1,
  "userData": {
    "orcidId": "0000-0000-0000-0000",
    "githubHandle": "username"
  }
}
```

### Programmatic Usage

```typescript
import { evaluateUser } from './examples/user-evaluation-example';

const result = await evaluateUser(1, {
  orcidId: "0000-0000-0000-0000",
  githubHandle: "username",
  githubHandle: "username"
});

if (result.success) {
  console.log('Median Worth:', result.result.medianWorth);
  console.log('Source Values:', result.result.sourceValues);
}
```

## Configuration

### Environment Variables

Make sure these environment variables are set:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
OPENAI_FLEX_MODE=batch  # or 'nonbatch'
DATABASE_URL=file:./dev.db
```

### Prompts

The system uses prompts defined in `src/prompts.ts`:

- **`onboardingPrompt`**: Checks if user is active scientist/FOSS dev
- **`worthPrompt`**: Assesses user worth as fraction of GDP
- **`injectionPrompt`**: Detects prompt injection attempts
- **`randomizePrompt`**: Randomizes prompts while preserving meaning

## Response Schemas

The system uses structured JSON responses from OpenAI:

### Scientist Check Response
```json
{
  "isActiveScientistOrFOSSDev": true,
  "why": "Explanation of decision"
}
```

### Worth Assessment Response
```json
{
  "worthAsFractionOfGDP": 0.0001,
  "why": "Explanation of assessment"
}
```

### Prompt Injection Response
```json
{
  "hasPromptInjection": false,
  "why": "Explanation of detection result"
}
```

## Database Storage

Results are stored in the `tasks` table with the following structure:

- **`runnerData`**: JSON containing AI results and metadata
- **`status`**: Task status (PENDING, IN_PROGRESS, COMPLETED, CANCELLED)
- **`dependencies`**: Task dependencies via `TaskDependency` table

## Error Handling

The system includes comprehensive error handling:

- OpenAI API failures are caught and logged
- Invalid user data is validated
- Task dependencies are checked before execution
- Database errors are handled gracefully

## Monitoring

Use the status endpoint to monitor evaluation progress:

```http
GET /api/evaluation/status/1
```

This returns:
- Total number of tasks
- Tasks grouped by type
- Individual task status and dependencies
- Completion timestamps

## Examples

See `src/examples/user-evaluation-example.ts` for a complete example of how to use the system.

## Dependencies

- **flexible-batches**: For OpenAI API batching
- **openai**: OpenAI API client
- **@prisma/client**: Database ORM
- **uuid**: For generating unique IDs

## Notes

- The system uses `gpt-4o-mini` instead of `gpt-5-nano` (not available)
- Temperature is set to 0 for consistent results
- All AI responses include a "why" field for transparency
- The system supports both batch and non-batch OpenAI modes
- Task execution is asynchronous and can be monitored via API
