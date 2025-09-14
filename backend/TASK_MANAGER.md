# TaskManager Service

The `TaskManager` service provides comprehensive task management functionality with dependency-aware execution and cleanup capabilities.

## Features

### 1. Dependency-Aware Task Execution
- **`runTaskWithDependencies(taskId: number)`**: Runs a task only if all its dependencies are COMPLETED
- Validates task status and dependencies before execution
- Automatically updates task status to INITIATED during execution
- Marks tasks as COMPLETED or CANCELLED based on execution results

### 2. Batch Task Processing
- **`runAllPendingTasks()`**: Attempts to run all NOT_STARTED tasks in the system
- Returns detailed execution summary (executed, failed, skipped counts)
- Processes tasks in creation order for predictable execution

### 3. Orphaned Dependency Cleanup
- **`deleteOrphanedDependencies()`**: Removes tasks that are only dependencies of COMPLETED tasks
- Helps maintain a clean task graph by removing unnecessary intermediate tasks
- Returns count of deleted tasks

### 4. Task Information and Monitoring
- **`getTaskSummary()`**: Provides overview of task counts by status
- **`getTasksWithDependencies()`**: Retrieves tasks with full dependency information

## Usage Examples

### Basic Usage

```typescript
import { PrismaClient } from '@prisma/client';
import { TaskManager } from './services/TaskManager';

const prisma = new PrismaClient();
const taskManager = new TaskManager(prisma);

// Run a specific task if dependencies are met
const success = await taskManager.runTaskWithDependencies(123);

// Run all pending tasks
const results = await taskManager.runAllPendingTasks();
console.log(`Executed: ${results.executed}, Failed: ${results.failed}, Skipped: ${results.skipped}`);

// Clean up orphaned dependencies
const deletedCount = await taskManager.deleteOrphanedDependencies();
console.log(`Deleted ${deletedCount} orphaned tasks`);
```

### Task Dependency Chain Example

```typescript
// Create tasks with dependencies
const task1 = await prisma.task.create({
  data: {
    status: 'NOT_STARTED',
    runnerClassName: 'ExampleRunner',
    runnerData: JSON.stringify({ message: 'First task' }),
  },
});

const task2 = await prisma.task.create({
  data: {
    status: 'NOT_STARTED',
    runnerClassName: 'ExampleRunner',
    runnerData: JSON.stringify({ message: 'Second task' }),
  },
});

// Create dependency: Task2 depends on Task1
await prisma.taskDependency.create({
  data: {
    taskId: task2.id,
    dependencyId: task1.id,
  },
});

// Run all pending tasks - only task1 will run initially
await taskManager.runAllPendingTasks();
```

## Task Status Flow

1. **NOT_STARTED**: Task is waiting to be executed
2. **INITIATED**: Task is currently being executed
3. **COMPLETED**: Task has finished successfully
4. **CANCELLED**: Task failed or was cancelled

## Dependency Management

- Tasks can have multiple dependencies
- A task can only run when ALL its dependencies are COMPLETED
- Dependencies are enforced at execution time
- Orphaned dependencies (only referenced by COMPLETED tasks) can be automatically cleaned up

## Error Handling

- Failed task executions are marked as CANCELLED
- Dependency validation prevents invalid task execution
- Comprehensive error logging for debugging
- Graceful handling of database errors

## Integration with Existing Services

The TaskManager integrates with:
- **TaskRunnerRegistry**: For executing task runners
- **Prisma**: For database operations
- **TaskStatus enum**: For type-safe status management

## Example Files

- `src/examples/task-manager-example.ts`: Comprehensive usage examples
- `src/examples/complete-task-example.ts`: Complete task execution workflow

## Best Practices

1. **Always check dependencies**: Use `runTaskWithDependencies()` for single tasks
2. **Batch processing**: Use `runAllPendingTasks()` for processing multiple tasks
3. **Regular cleanup**: Periodically call `deleteOrphanedDependencies()` to maintain clean task graph
4. **Monitor execution**: Use `getTaskSummary()` to monitor system health
5. **Error handling**: Always handle the boolean return values from execution methods
