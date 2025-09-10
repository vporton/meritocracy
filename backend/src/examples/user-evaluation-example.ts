import { PrismaClient } from '@prisma/client';
import { UserEvaluationFlow } from '../services/UserEvaluationFlow';
import { registerOpenAIRunners } from '../runners/OpenAIRunners';
import { TaskExecutor } from '../services/TaskExecutor';

/**
 * Example of how to use the User Evaluation Flow
 */
async function runUserEvaluationExample() {
  // Initialize Prisma
  const prisma = new PrismaClient();
  
  try {
    // Register all TaskRunners
    registerOpenAIRunners();
    
    // Create the evaluation flow service
    const evaluationFlow = new UserEvaluationFlow(prisma);
    const taskExecutor = new TaskExecutor(prisma);
    
    // Example user data
    const userEvaluationData = {
      userId: 1, // Replace with actual user ID
      userData: {
        orcidId: "0000-0000-0000-0000", // Replace with actual ORCID
        githubHandle: "example-user", // Replace with actual GitHub handle
        bitbucketHandle: "example-user", // Replace with actual Bitbucket handle
        gitlabHandle: "example-user", // Replace with actual GitLab handle
        // Add any other relevant data
      }
    };
    
    console.log("🚀 Starting user evaluation flow...");
    
    // Create the evaluation flow
    const rootTaskId = await evaluationFlow.createEvaluationFlow(userEvaluationData);
    console.log(`📋 Created evaluation flow with root task ID: ${rootTaskId}`);
    
    // Execute the flow
    console.log("⚡ Executing evaluation flow...");
    let executedCount = 0;
    let maxIterations = 50; // Prevent infinite loops
    let iteration = 0;
    
    while (iteration < maxIterations) {
      const count = await taskExecutor.executeReadyTasks();
      executedCount += count;
      
      if (count === 0) {
        console.log("✅ No more ready tasks to execute");
        break;
      }
      
      console.log(`📊 Executed ${count} tasks in iteration ${iteration + 1}`);
      iteration++;
      
      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`🎉 Evaluation flow completed! Total tasks executed: ${executedCount}`);
    
    // Get the final result
    const result = await evaluationFlow.getEvaluationResult(userEvaluationData.userId);
    if (result) {
      console.log("📈 Final evaluation result:");
      console.log(`   Median Worth: ${result.medianWorth}`);
      console.log(`   Source Values: ${result.sourceValues.join(', ')}`);
      console.log(`   Completed At: ${result.completedAt}`);
    } else {
      console.log("❌ No evaluation result found");
    }
    
  } catch (error) {
    console.error("❌ Error in user evaluation example:", error);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Example of how to evaluate a specific user
 */
export async function evaluateUser(
  userId: number,
  userData: {
    orcidId?: string;
    githubHandle?: string;
    bitbucketHandle?: string;
    gitlabHandle?: string;
    [key: string]: any;
  }
): Promise<{
  success: boolean;
  result?: any;
  error?: string;
}> {
  const prisma = new PrismaClient();
  
  try {
    // Register all TaskRunners
    registerOpenAIRunners();
    
    // Create the evaluation flow service
    const evaluationFlow = new UserEvaluationFlow(prisma);
    const taskExecutor = new TaskExecutor(prisma);
    
    const userEvaluationData = {
      userId,
      userData
    };
    
    // Create the evaluation flow
    const rootTaskId = await evaluationFlow.createEvaluationFlow(userEvaluationData);
    
    // Execute the flow
    let executedCount = 0;
    let maxIterations = 50;
    let iteration = 0;
    
    while (iteration < maxIterations) {
      const count = await taskExecutor.executeReadyTasks();
      executedCount += count;
      
      if (count === 0) {
        break;
      }
      
      iteration++;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Get the final result
    const result = await evaluationFlow.getEvaluationResult(userId);
    
    return {
      success: true,
      result
    };
    
  } catch (error) {
    console.error("Error evaluating user:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    await prisma.$disconnect();
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  runUserEvaluationExample();
}
