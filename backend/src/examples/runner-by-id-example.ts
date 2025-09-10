import { PrismaClient } from '@prisma/client';
import { TaskRunnerRegistry } from '../types/task';
import { registerExampleRunners } from '../runners/ExampleRunners';
// import { TaskRunnerService } from '../services/TaskRunnerService';
// import { TaskRunnerDataService } from '../services/TaskRunnerDataService';

const prisma = new PrismaClient();

async function runnerByIdExample() {
  try {
    console.log('⚠️  This example is disabled because it uses non-existent models and methods.');
    console.log('The current schema uses embedded runner data instead of separate models.');
    console.log('Use the task-example.ts or consolidated-task-example.ts instead.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the example
runnerByIdExample();
