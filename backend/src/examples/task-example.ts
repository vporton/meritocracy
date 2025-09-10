import { PrismaClient } from '@prisma/client';
import { TaskStatus } from '../types/task';
import { registerExampleRunners } from '../runners/ExampleRunners';
import { TaskExecutor } from '../services/TaskExecutor';

const prisma = new PrismaClient();

async function taskExample() {
  try {
    // Register example TaskRunners in memory (for class instantiation)
    registerExampleRunners();

    // Note: This example now uses embedded runner data instead of separate models

    // Create tasks with embedded runner information and data
    const task1 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'EmailRunner',
        runnerData: JSON.stringify({
          to: 'user@example.com',
          subject: 'Welcome to our service!',
          body: 'Thank you for signing up. We are excited to have you on board!'
        }),
      },
    });

    const task2 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'FileProcessorRunner',
        runnerData: JSON.stringify({
          filePath: '/uploads/document.pdf',
          operation: 'compress'
        }),
      },
    });

    const task3 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'ApiCallRunner',
        runnerData: JSON.stringify({
          url: 'https://api.example.com/webhook',
          method: 'POST',
          payload: { event: 'task_completed', taskId: 2 }
        }),
      },
    });

    const task4 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'DatabaseRunner',
        runnerData: JSON.stringify({
          operation: 'backup',
          table: 'users',
          query: 'SELECT * FROM users WHERE created_at > NOW() - INTERVAL 1 DAY'
        }),
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

    // Query tasks with their dependencies
    const tasksWithDependencies = await prisma.task.findMany({
      include: {
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

    console.log('Tasks with dependencies:');
    tasksWithDependencies.forEach((task: any, index: number) => {
      console.log(`\nTask ${index + 1} (ID: ${task.id}):`);
      console.log(`Status: ${task.status}`);
      console.log(`Runner: ${task.runnerClassName || 'None'}`);
      console.log(`Data: ${task.runnerData || 'None'}`);
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
      orderBy: { id: 'asc' },
    });

    console.log('\nFinal task statuses:');
    finalTasks.forEach((task: any) => {
      console.log(`- Task ${task.id}: ${task.status} (Runner: ${task.runnerClassName || 'None'})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the example
taskExample();
