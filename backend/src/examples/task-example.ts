import { PrismaClient } from '@prisma/client';
import { TaskStatus } from '../types/task';
import { registerExampleRunners } from '../runners/ExampleRunners';
import { TaskExecutor } from '../services/TaskExecutor';
import { TaskRunnerService } from '../services/TaskRunnerService';
import { TaskRunnerDataService } from '../services/TaskRunnerDataService';

const prisma = new PrismaClient();

async function taskExample() {
  try {
    // Register example TaskRunners in memory (for class instantiation)
    registerExampleRunners();

    // Initialize TaskRunnerService and register runners in database
    const taskRunnerService = new TaskRunnerService(prisma);
    await taskRunnerService.initializeDefaultRunners();

    // Initialize TaskRunnerDataService and create default data configurations
    const taskRunnerDataService = new TaskRunnerDataService(prisma);
    await taskRunnerDataService.initializeDefaultRunnerData();

    // Get the registered runners from database
    const emailRunner = await taskRunnerService.getRunner('EmailRunner');
    const fileRunner = await taskRunnerService.getRunner('FileProcessorRunner');
    const apiRunner = await taskRunnerService.getRunner('ApiCallRunner');
    const dbRunner = await taskRunnerService.getRunner('DatabaseRunner');

    if (!emailRunner || !fileRunner || !apiRunner || !dbRunner) {
      throw new Error('Failed to get TaskRunners from database');
    }

    // Get the runner data configurations from database
    const welcomeEmailData = await taskRunnerDataService.getRunnerDataByName('Welcome Email Data');
    const fileCompressionData = await taskRunnerDataService.getRunnerDataByName('File Compression Data');
    const apiWebhookData = await taskRunnerDataService.getRunnerDataByName('API Webhook Data');
    const dbBackupData = await taskRunnerDataService.getRunnerDataByName('Database Backup Data');

    if (!welcomeEmailData || !fileCompressionData || !apiWebhookData || !dbBackupData) {
      throw new Error('Failed to get TaskRunnerData from database');
    }

    // Create tasks with TaskRunner and TaskRunnerData references
    const task1 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerId: emailRunner.id,
        runnerDataId: welcomeEmailData.id,
      },
    });

    const task2 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerId: fileRunner.id,
        runnerDataId: fileCompressionData.id,
      },
    });

    const task3 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerId: apiRunner.id,
        runnerDataId: apiWebhookData.id,
      },
    });

    const task4 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerId: dbRunner.id,
        runnerDataId: dbBackupData.id,
      },
    });

    // Create dependencies: task2 depends on task1, task3 depends on task2
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

    // Query tasks with their dependencies, runners, and runner data
    const tasksWithDependencies = await prisma.task.findMany({
      include: {
        runner: true,
        runnerData: true,
        dependencies: {
          include: {
            dependency: true,
          },
        },
        dependents: {
          include: {
            task: true,
          },
        },
      },
    });

    console.log('Tasks with dependencies, runners, and data:');
    tasksWithDependencies.forEach((task: any, index: number) => {
      console.log(`\nTask ${index + 1} (ID: ${task.id}):`);
      console.log(`Status: ${task.status}`);
      console.log(`Runner: ${task.runner?.name || 'None'} (${task.runner?.className || 'N/A'})`);
      console.log(`Data: ${task.runnerData?.name || 'None'}`);
      console.log(`Dependencies: ${task.dependencies.map((dep: any) => `Task ${dep.dependency.id}`).join(', ') || 'None'}`);
      console.log(`Dependents: ${task.dependents.map((dep: any) => `Task ${dep.task.id}`).join(', ') || 'None'}`);
    });

    // Execute tasks using TaskExecutor
    console.log('\n🚀 Starting task execution...');
    const taskExecutor = new TaskExecutor(prisma);
    
    // Execute all ready tasks
    const executedCount = await taskExecutor.executeReadyTasks();
    console.log(`\n✅ Executed ${executedCount} tasks successfully`);

    // Show final task statuses
    const finalTasks = await prisma.task.findMany({
      include: { runner: true, runnerData: true },
      orderBy: { id: 'asc' },
    });

    console.log('\nFinal task statuses:');
    finalTasks.forEach((task: any) => {
      console.log(`- Task ${task.id}: ${task.status} (Runner: ${task.runner?.name || 'None'}, Data: ${task.runnerData?.name || 'None'})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the example
taskExample();
