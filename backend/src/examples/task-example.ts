import { PrismaClient } from '@prisma/client';
import { TaskStatus } from '../types/task';

const prisma = new PrismaClient();

async function taskExample() {
  try {
    // Create some tasks
    const task1 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
      },
    });

    const task2 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
      },
    });

    const task3 = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
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
      console.log(`Dependencies: ${task.dependencies.map((dep: any) => `Task ${dep.dependency.id}`).join(', ') || 'None'}`);
      console.log(`Dependents: ${task.dependents.map((dep: any) => `Task ${dep.task.id}`).join(', ') || 'None'}`);
    });

    // Mark task1 as completed
    await prisma.task.update({
      where: { id: task1.id },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    // Query tasks that are now ready to start (all dependencies completed)
    const readyTasks = await prisma.task.findMany({
      where: {
        status: TaskStatus.PENDING,
        dependencies: {
          every: {
            dependency: {
              status: TaskStatus.COMPLETED,
            },
          },
        },
      },
    });

    console.log('\nTasks ready to start:');
    readyTasks.forEach((task: any) => {
      console.log(`- Task ${task.id} (Status: ${task.status})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the example
taskExample();
