import { PrismaClient } from '@prisma/client';
import { TaskRunnerRegistry, TaskStatus } from '../types/task.js';

/**
 * Example demonstrating how to use the TaskRunnerRegistry.completeTask function
 */
async function completeTaskExample() {
  const prisma = new PrismaClient();

  try {
    console.log('🧪 Testing TaskRunnerRegistry.completeTask function...\n');

    // First, let's create a test task
    console.log('1. Creating a test task...');
    const testTask = await prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'TestRunner',
        runnerData: JSON.stringify({ test: true })
      }
    });

    console.log(`✅ Created test task with ID: ${testTask.id}`);
    console.log(`   Status: ${testTask.status}`);
    console.log(`   Created at: ${testTask.createdAt}\n`);

    // Now let's complete the task using our new function
    console.log('2. Completing the task using TaskRunnerRegistry.completeTask...');
    const success = await TaskRunnerRegistry.completeTask(prisma, testTask.id);

    if (success) {
      console.log('✅ Task completion was successful!\n');

      // Verify the task was actually updated
      console.log('3. Verifying task was updated...');
      const updatedTask = await prisma.task.findUnique({
        where: { id: testTask.id }
      });

      if (updatedTask) {
        console.log(`✅ Task verification successful:`);
        console.log(`   ID: ${updatedTask.id}`);
        console.log(`   Status: ${updatedTask.status}`);
        console.log(`   Completed at: ${updatedTask.completedAt}`);
        console.log(`   Updated at: ${updatedTask.updatedAt}`);
      } else {
        console.log('❌ Task not found after completion');
      }
    } else {
      console.log('❌ Task completion failed');
    }

  } catch (error) {
    console.error('❌ Error in completeTaskExample:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  completeTaskExample();
}

export { completeTaskExample };
