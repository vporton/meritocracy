// Simple test script to verify the user evaluation system
const { evaluateUser } = require('./dist/examples/user-evaluation-example');

async function testEvaluation() {
  console.log('🧪 Testing User Evaluation System...');
  
  try {
    const result = await evaluateUser(1, {
      orcidId: "0000-0000-0000-0000",
      githubHandle: "test-user",
      bitbucketHandle: "test-user",
      gitlabHandle: "test-user"
    });
    
    if (result.success) {
      console.log('✅ Evaluation completed successfully!');
      console.log('📊 Result:', result.result);
    } else {
      console.log('❌ Evaluation failed:', result.error);
    }
  } catch (error) {
    console.error('💥 Test failed with error:', error);
  }
}

// Run the test
testEvaluation();
