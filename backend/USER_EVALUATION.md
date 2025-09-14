# User Evaluation System

This document describes the user evaluation system that implements the flow graph described in the requirements. The system uses OpenAI API with response schema to evaluate users based on their scientific and FOSS contributions.

## Overview

The user evaluation system creates a flow graph of tasks that:

1. **Scientist Check**: Determines if a user is an active scientist or FOSS developer
2. **Worth Assessment**: Calculates the user's worth as a fraction of world GDP
3. **Conditional Logic**: If worth > 1e-11, performs additional checks
4. **Prompt Injection Detection**: Checks for prompt injection attempts (3 times, with optimization)
5. **Additional Worth Assessments**: Performs 2 more worth assessments if threshold is met
6. **Median Calculation**: Calculates the median from all completed worth assessments
7. **Security Response**: Immediately bans users and cancels remaining tasks if injection is detected

**Key Features:**
- **Partial Execution**: Tasks can be cancelled early based on conditions
- **Optimization**: Skips redundant checks when injection is already detected
- **Security First**: Immediate user banning when injection is detected
- **Resource Efficiency**: Prevents unnecessary AI calls when conditions aren't met

## Architecture

### Asynchronous Task Execution

The system uses an asynchronous task execution model:

- **TaskRunners only initiate requests** - they don't wait for OpenAI responses
- **Dependency validation** - Tasks only run when all dependencies are COMPLETED
- **Result retrieval** - Tasks that depend on others retrieve results from completed dependencies
- **Flexible-batch integration** - Uses `createAIBatchStore()` and `createAIOutputter()` for efficient OpenAI API usage

### TaskRunners

The system implements several TaskRunner classes:

- **`ScientistOnboardingRunner`**: Uses OpenAI to check if user is an active scientist/FOSS dev
- **`RandomizePromptRunner`**: Uses OpenAI to randomize prompts while preserving meaning (can be conditionally cancelled based on worth threshold)
- **`WorthAssessmentRunner`**: Uses OpenAI to assess user worth with randomized prompts (depends on RandomizePromptRunner, returns undefined if parent injection detected)
- **`PromptInjectionRunner`**: Uses OpenAI to detect prompt injection attempts (bans user and marks as CANCELLED if injection detected)
- **`WorthThresholdCheckRunner`**: Checks if worth exceeds 1e-11 threshold (depends on WorthAssessmentRunner)
- **`MedianRunner`**: Calculates median from dependency results (depends on WorthAssessmentRunners, **EXCEPTION**: not cancelled if dependencies are cancelled)

**Note**: `BanUserRunner` has been removed - user banning is now handled directly by `PromptInjectionRunner` when injection is detected.

### Flow Graph

```
                    ┌─────────────────┐
                    │  Scientist      │
                    │  Check          │
                    └─────────┬───────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Randomize      │
                    │  Prompt         │
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
            │ CANCELLED   │    │  Check (3x)     │
            └─────────────┘    └─────────┬───────┘
                                         │
                               ┌─────────┴─────────┐
                               │                   │
                               ▼                   ▼
                       ┌─────────────┐    ┌─────────────────┐
                       │  Ban User   │    │  Randomize      │
                       │ (1 year)    │    │  Prompt #2      │
                       │ CANCELLED   │    │ CANCELLED       │
                       └─────────────┘    └─────────┬───────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │  Worth          │
                                           │  Assessment #2  │
                                           │ CANCELLED       │
                                           └─────────┬───────┘
                                                     │
                                                     ▼
                                           ┌─────────────────┐
                                           │  Randomize      │
                                           │  Prompt #3      │
                                           │ CANCELLED       │
                                           └─────────┬───────┘
                                                     │
                                                     ▼
                                           ┌─────────────────┐
                                           │  Worth          │
                                           │  Assessment #3  │
                                           │ CANCELLED       │
                                           └─────────┬───────┘
                                                     │
                                                     ▼
                                           ┌─────────────────┐
                                           │   Median        │
                                           │ (3 values)      │
                                           │ CANCELLED       │
                                           └─────────────────┘
```

**Legend:**
- `COMPLETED` - Task finished successfully
- `CANCELLED` - Task stopped early due to conditions or dependencies
- Tasks marked as `CANCELLED` prevent their dependents from running
- **EXCEPTION**: `MedianRunner` runs even if some dependencies are cancelled

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
- **`status`**: Task status (NOT_STARTED, INITIATED, COMPLETED, CANCELLED)
- **`dependencies`**: Task dependencies via `TaskDependency` table

## Task Status: CANCELLED

### How CANCELLED Works

The `CANCELLED` status is a critical mechanism for implementing **partial execution** of the evaluation diagram. It allows the system to:

1. **Stop execution early** when certain conditions are met
2. **Prevent unnecessary work** by cancelling dependent tasks
3. **Maintain data integrity** by clearly marking incomplete evaluations

### When Tasks Are CANCELLED

Tasks are marked as `CANCELLED` in the following scenarios:

#### 1. **Dependency Cancellation Cascade**
```typescript
// If any dependency is CANCELLED, the dependent task is also CANCELLED
if (this.areAnyDependenciesCancelled(task)) {
  await this.markTaskAsCancelled(task, 'Dependency was cancelled');
  return;
}
```

#### 2. **Prompt Injection Detection**
```typescript
// When PromptInjectionRunner detects injection, it:
// 1. Bans the user immediately
// 2. Marks itself as CANCELLED (not COMPLETED)
// 3. All dependent tasks become CANCELLED due to cascade
```

#### 3. **Worth Threshold Not Met**
```typescript
// WorthThresholdCheckRunner marks itself as CANCELLED when threshold not exceeded
if (!exceedsThreshold) {
  await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, task.id, 'Worth threshold not exceeded');
  return;
}
```

#### 4. **Task Execution Failure**
```typescript
// If a task fails to execute, it's marked as CANCELLED
await this.prisma.task.update({
  where: { id: taskId },
  data: { status: TaskStatus.CANCELLED }
});
```

#### 5. **MedianRunner Exception**
```typescript
// MedianRunner overrides the base run method to bypass cancellation checks
// It processes available data even if some dependencies are cancelled
async run(taskId: number): Promise<void> {
  // Bypasses areAnyDependenciesCancelled() check
  // Only checks if dependencies are COMPLETED, not if they're CANCELLED
}
```

### CANCELLED vs COMPLETED

| Status | Meaning | Data Integrity | Dependencies |
|--------|---------|----------------|--------------|
| `COMPLETED` | Task finished successfully | Full results available | Can be used by dependents |
| `CANCELLED` | Task stopped early | Partial/no results | Cannot be used by dependents |

### Partial Execution Scenarios

#### Scenario 1: Low Worth User (≤ 1e-11)
```
Scientist Check → COMPLETED
Randomize Prompt → COMPLETED  
Worth Assessment #1 → COMPLETED
Worth Threshold Check → CANCELLED (threshold not exceeded)
├─ Prompt Injection Randomize → CANCELLED (threshold not met)
├─ Prompt Injection Check #1 → CANCELLED (dependency cancelled)
├─ Prompt Injection Check #2 → CANCELLED (dependency cancelled)  
├─ Prompt Injection Check #3 → CANCELLED (dependency cancelled)
├─ Worth Assessment #2 → CANCELLED (dependency cancelled)
├─ Worth Assessment #3 → CANCELLED (dependency cancelled)
└─ Final Median → COMPLETED (1 value) [EXCEPTION: runs despite cancelled dependencies]
```

**Result**: Basic worth assessment completed, median calculated from single value.

#### Scenario 2: High Worth User with Injection Detection
```
Scientist Check → COMPLETED
Randomize Prompt → COMPLETED
Worth Assessment #1 → COMPLETED  
Worth Threshold Check → COMPLETED (threshold exceeded)
├─ Prompt Injection Randomize → COMPLETED
├─ Prompt Injection Check #1 → CANCELLED (injection detected, user banned)
├─ Prompt Injection Check #2 → CANCELLED (dependency cancelled)
├─ Prompt Injection Check #3 → CANCELLED (dependency cancelled)
├─ Worth Assessment #2 → CANCELLED (dependency cancelled)
├─ Worth Assessment #3 → CANCELLED (dependency cancelled)
└─ Final Median → COMPLETED (1 value) [EXCEPTION: runs despite cancelled dependencies]
```

**Result**: User banned, evaluation stopped early, median calculated from single available value.

#### Scenario 3: High Worth User, No Injection
```
Scientist Check → COMPLETED
Randomize Prompt → COMPLETED
Worth Assessment #1 → COMPLETED
Worth Threshold Check → COMPLETED (threshold exceeded)
├─ Prompt Injection Randomize → COMPLETED
├─ Prompt Injection Check #1 → COMPLETED (no injection)
├─ Prompt Injection Check #2 → COMPLETED (no injection)
├─ Prompt Injection Check #3 → COMPLETED (no injection)
├─ Worth Assessment #2 → COMPLETED
├─ Worth Assessment #3 → COMPLETED
└─ Final Median → COMPLETED (3 values)
```

**Result**: Full evaluation completed with median calculation.

### Why CANCELLED is the Correct Approach

#### ✅ **Advantages**

1. **Resource Efficiency**: Prevents unnecessary AI API calls when conditions aren't met
2. **Security First**: Immediately bans users when injection is detected
3. **Clear State Management**: Explicitly distinguishes between "completed" and "stopped early"
4. **Dependency Integrity**: Ensures dependent tasks can't run with incomplete data
5. **Audit Trail**: Maintains clear record of why tasks were stopped

#### ⚠️ **Considerations**

1. **Data Completeness**: Some evaluations may have incomplete data
2. **Median Calculation**: Requires sufficient completed worth assessments
3. **Monitoring Complexity**: Need to track both completed and cancelled tasks

### MedianRunner Exception: Why It Bypasses Cancellation

The `MedianRunner` is a **special exception** to the cancellation cascade rule for the following reasons:

#### **1. Data Aggregation Purpose**
- MedianRunner's job is to aggregate available data, not to perform new evaluations
- It can work with partial data as long as it has at least one valid worth assessment
- The median of 1 value is still a valid result (the value itself)

#### **2. Graceful Degradation**
- Even if some worth assessments are cancelled, the system can still provide a result
- This ensures users always get some evaluation outcome, even in partial scenarios
- Better user experience than complete failure

#### **3. Statistical Validity**
- A median calculated from available data is still statistically meaningful
- The system logs how many values were used, providing transparency
- Users can understand the confidence level based on the number of source values

#### **4. Implementation Details**
```typescript
// MedianRunner overrides the base run method
async run(taskId: number): Promise<void> {
  // Bypasses areAnyDependenciesCancelled() check
  // Only processes COMPLETED dependencies, skips CANCELLED ones
  // Calculates median from whatever valid data is available
}
```

#### **5. Result Quality**
- **1 value**: Median = that value (basic assessment)
- **2 values**: Median = average of two values (good assessment)  
- **3 values**: Median = middle value (comprehensive assessment)
- **0 values**: Throws error (insufficient data)

### Handling CANCELLED Tasks in Results

```typescript
// When retrieving evaluation results, check for sufficient data
const completedWorthTasks = tasks.filter(task => 
  task.runnerClassName === 'WorthAssessmentRunner' && 
  task.status === 'COMPLETED' &&
  task.runnerData && 
  JSON.parse(task.runnerData).worthAsFractionOfGDP !== undefined
);

if (completedWorthTasks.length < 2) {
  return { error: 'Insufficient worth assessments for median calculation' };
}
```

### Monitoring CANCELLED Tasks

Use the status endpoint to monitor cancellation patterns:

```http
GET /api/evaluation/status/1
```

This will show:
- Which tasks were cancelled and why
- Dependency chains that led to cancellations
- Whether the evaluation can produce a valid result

### Optimization Benefits

The CANCELLED status enables significant optimizations:

#### **Resource Savings**
- **Low Worth Users**: Saves 6 AI API calls (no injection checks, no additional worth assessments)
- **Injection Detected**: Saves 4 AI API calls (remaining injection checks + worth assessments)
- **Total Potential Savings**: Up to 67% reduction in AI API calls
- **MedianRunner Exception**: Still provides results even with partial data, ensuring no complete failures

#### **Security Improvements**
- **Immediate Response**: Users are banned as soon as injection is detected
- **No Data Leakage**: Prevents further evaluation of malicious users
- **Audit Trail**: Clear record of security violations

#### **Performance Benefits**
- **Faster Execution**: Early termination reduces total evaluation time
- **Reduced Costs**: Fewer OpenAI API calls mean lower operational costs
- **Better UX**: Quicker responses for legitimate users

### Best Practices

1. **Always check task status** before using results
2. **Handle partial evaluations gracefully** in the UI
3. **Log cancellation reasons** for debugging
4. **Consider retry logic** for transient failures
5. **Validate data completeness** before final calculations
6. **Monitor cancellation patterns** to identify system issues
7. **Implement proper error handling** for cancelled dependencies

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
