import { PrismaClient } from '@prisma/client';
import { TaskRunnerRegistry } from '../types/task';
import { registerExampleRunners } from '../runners/ExampleRunners';
import { TaskRunnerService } from '../services/TaskRunnerService';
import { TaskRunnerDataService } from '../services/TaskRunnerDataService';

const prisma = new PrismaClient();

async function runnerByIdExample() {
  try {
    // Register example TaskRunners in memory (for class instantiation)
    registerExampleRunners();

    // Initialize services
    const taskRunnerService = new TaskRunnerService(prisma);
    const taskRunnerDataService = new TaskRunnerDataService(prisma);

    // Initialize default runners and data
    await taskRunnerService.initializeDefaultRunners();
    await taskRunnerDataService.initializeDefaultRunnerData();

    // Get some runners and data from database
    const emailRunner = await taskRunnerService.getRunner('EmailRunner');
    const fileRunner = await taskRunnerService.getRunner('FileProcessorRunner');
    const welcomeEmailData = await taskRunnerDataService.getRunnerDataByName('Welcome Email Data');
    const fileCompressionData = await taskRunnerDataService.getRunnerDataByName('File Compression Data');

    if (!emailRunner || !fileRunner || !welcomeEmailData || !fileCompressionData) {
      throw new Error('Failed to get runners or data from database');
    }

    console.log('📋 Available runners and data:');
    console.log(`- EmailRunner (ID: ${emailRunner.id})`);
    console.log(`- FileProcessorRunner (ID: ${fileRunner.id})`);
    console.log(`- Welcome Email Data (ID: ${welcomeEmailData.id})`);
    console.log(`- File Compression Data (ID: ${fileCompressionData.id})`);

    // Test running EmailRunner with data
    console.log('\n🚀 Testing EmailRunner with data...');
    const emailSuccess = await TaskRunnerRegistry.runByRunnerId(
      prisma, 
      emailRunner.id, 
      welcomeEmailData.id
    );
    console.log(`EmailRunner result: ${emailSuccess ? 'SUCCESS' : 'FAILED'}`);

    // Test running FileProcessorRunner with data
    console.log('\n🚀 Testing FileProcessorRunner with data...');
    const fileSuccess = await TaskRunnerRegistry.runByRunnerId(
      prisma, 
      fileRunner.id, 
      fileCompressionData.id
    );
    console.log(`FileProcessorRunner result: ${fileSuccess ? 'SUCCESS' : 'FAILED'}`);

    // Test running EmailRunner without data
    console.log('\n🚀 Testing EmailRunner without data...');
    const emailNoDataSuccess = await TaskRunnerRegistry.runByRunnerId(
      prisma, 
      emailRunner.id
    );
    console.log(`EmailRunner (no data) result: ${emailNoDataSuccess ? 'SUCCESS' : 'FAILED'}`);

    // Test running with invalid runner ID
    console.log('\n🚀 Testing with invalid runner ID...');
    const invalidSuccess = await TaskRunnerRegistry.runByRunnerId(
      prisma, 
      99999, 
      welcomeEmailData.id
    );
    console.log(`Invalid runner ID result: ${invalidSuccess ? 'SUCCESS' : 'FAILED'}`);

    // Test running with invalid data ID
    console.log('\n🚀 Testing with invalid data ID...');
    const invalidDataSuccess = await TaskRunnerRegistry.runByRunnerId(
      prisma, 
      emailRunner.id, 
      99999
    );
    console.log(`Invalid data ID result: ${invalidDataSuccess ? 'SUCCESS' : 'FAILED'}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the example
runnerByIdExample();
