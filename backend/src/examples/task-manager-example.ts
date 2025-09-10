import { PrismaClient } from '@prisma/client';
import { TaskManager } from '../services/TaskManager';
import { TaskStatus } from '../types/task';

/**
 * Example demonstrating the TaskManager functionality
 */
async function taskManagerExample() {
  const prisma = new PrismaClient();
  const taskManager = new TaskManager(prisma);

  try {
    console.log('🚀 TaskManager Example Starting...\n');

    // 1. Get current task summary
    console.log('📊 Current Task Summary:');
    const summary = await taskManager.getTaskSummary();
    console.log(`   Pending: ${summary.pending}`);
    console.log(`   In Progress: ${summary.inProgress}`);
    console.log(`   Completed: ${summary.completed}`);
    console.log(`   Cancelled: ${summary.cancelled}`);
    console.log(`   Total: ${summary.total}\n`);

    // 2. Try to run all pending tasks
    console.log('🔄 Running all pending tasks...');
    const runResults = await taskManager.runAllPendingTasks();
    console.log(`   Executed: ${runResults.executed}`);
    console.log(`   Failed: ${runResults.failed}`);
    console.log(`   Skipped: ${runResults.skipped}\n`);

    // 3. Get updated task summary
    console.log('📊 Updated Task Summary:');
    const updatedSummary = await taskManager.getTaskSummary();
    console.log(`   Pending: ${updatedSummary.pending}`);
    console.log(`   In Progress: ${updatedSummary.inProgress}`);
    console.log(`   Completed: ${updatedSummary.completed}`);
    console.log(`   Cancelled: ${updatedSummary.cancelled}`);
    console.log(`   Total: ${updatedSummary.total}\n`);

    // 4. Clean up orphaned dependencies
    console.log('🧹 Cleaning up orphaned dependencies...');
    const deletedCount = await taskManager.deleteOrphanedDependencies();
    console.log(`   Deleted ${deletedCount} orphaned dependency tasks\n`);

    // 5. Show tasks with dependencies
    console.log('📋 Tasks with Dependencies:');
    const tasksWithDeps = await taskManager.getTasksWithDependencies();
    
    for (const task of tasksWithDeps) {
      console.log(`   Task ${task.id} (${task.status}):`);
      console.log(`     Runner: ${task.runnerClassName}`);
      console.log(`     Dependencies: ${task.dependencies.length}`);
      if (task.dependencies.length > 0) {
        task.dependencies.forEach(dep => {
          console.log(`       - Task ${dep.dependency.id} (${dep.dependency.status})`);
        });
      }
      console.log(`     Dependents: ${task.dependents.length}`);
      if (task.dependents.length > 0) {
        task.dependents.forEach(dep => {
          console.log(`       - Task ${dep.task.id} (${dep.task.status})`);
        });
      }
      console.log('');
    }

    // 6. Example of running a specific task
    if (tasksWithDeps.length > 0) {
      const firstTask = tasksWithDeps[0];
      console.log(`🎯 Attempting to run specific task ${firstTask.id}...`);
      const success = await taskManager.runTaskWithDependencies(firstTask.id);
      console.log(`   Result: ${success ? 'Success' : 'Failed/Skipped'}\n`);
    }

    console.log('✅ TaskManager Example Completed!');

  } catch (error) {
    console.error('❌ Error in TaskManager example:', error);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Example of creating a task dependency chain
 */
async function createTaskDependencyExample() {
  const prisma = new PrismaClient();
  const taskManager = new TaskManager(prisma);

  try {
    console.log('🔗 Creating Task Dependency Chain Example...\n');

    // Create three tasks in a chain: Task1 -> Task2 -> Task3
    const task1 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'ExampleRunner',
        runnerData: JSON.stringify({ message: 'First task' }),
      },
    });

    const task2 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'ExampleRunner',
        runnerData: JSON.stringify({ message: 'Second task' }),
      },
    });

    const task3 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'ExampleRunner',
        runnerData: JSON.stringify({ message: 'Third task' }),
      },
    });

    // Create dependencies: Task2 depends on Task1, Task3 depends on Task2
    await prisma.taskDependency.create({
      data: {
        taskId: task2.id,
        dependencyId: task1.id,
      },
    });

    await prisma.taskDependency.create({
      data: {
        taskId: task3.id,
        dependencyId: task2.id,
      },
    });

    console.log(`Created task chain: ${task1.id} -> ${task2.id} -> ${task3.id}\n`);

    // Try to run all pending tasks (should only run task1 initially)
    console.log('🔄 Running all pending tasks...');
    const results = await taskManager.runAllPendingTasks();
    console.log(`   Executed: ${results.executed}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Skipped: ${results.skipped}\n`);

    // Show current status
    const tasks = await taskManager.getTasksWithDependencies();
    console.log('📋 Current Task Status:');
    tasks.forEach(task => {
      console.log(`   Task ${task.id}: ${task.status}`);
    });

  } catch (error) {
    console.error('❌ Error creating task dependency example:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Export functions for use in other files
export { taskManagerExample, createTaskDependencyExample };

// Run examples if this file is executed directly
if (require.main === module) {
  taskManagerExample()
    .then(() => createTaskDependencyExample())
    .catch(console.error);
}
