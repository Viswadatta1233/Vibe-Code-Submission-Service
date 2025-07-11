import { Worker, Job } from 'bullmq';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import axios from 'axios';

import Submission from '../models/Submission';
import { runJava } from '../executors/javaExecutor';
import { runPython } from '../executors/pythonExecutor';
import { runCpp } from '../executors/cppExecutor';

dotenv.config();

console.log('🚀 [WORKER] Starting Submission Worker...');
console.log('🔧 [WORKER] Environment variables loaded');
console.log('🔧 [WORKER] MONGO_URI:', process.env.MONGO_URI || 'not set');
console.log('🔧 [WORKER] REDIS_HOST:', process.env.REDIS_HOST || 'host.docker.internal');
console.log('🔧 [WORKER] REDIS_PORT:', process.env.REDIS_PORT || 6379);

mongoose.connect(process.env.MONGO_URI || '', {})
  .then(() => console.log('✅ [WORKER] Connected to MongoDB'))
  .catch(err => console.error('❌ cj[WORKER] MongoDB connection error:', err));

const redisOptions = {
  host: process.env.REDIS_HOST || 'host.docker.internal',
  port: Number(process.env.REDIS_PORT) || 6379,
};

console.log('🔗 [WORKER] Redis connection options:', redisOptions);

// Function to send WebSocket updates via HTTP
async function sendWebSocketUpdate(userId: string, submissionId: string, data: any) {
  console.log('📡 [WORKER] Sending WebSocket update:', { userId, submissionId, data });
  try {
    // Use host.docker.internal to connect to the host machine
    const response = await axios.post('http://host.docker.internal:5001/api/websocket/update', {
      userId, submissionId, data
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (response.status === 200) {
      console.log(`✅ [WORKER] WebSocket update sent for user ${userId}, submission ${submissionId}`);
    } else {
      console.error(`❌ [WORKER] Failed to send WebSocket update for user ${userId}:`, response.statusText);
    }
  } catch (error) {
    console.error(`❌ [WORKER] Error sending WebSocket update for user ${userId}:`, error);
  }
}

const submissionWorker = new Worker('submission-queue', async (job: Job) => {
  console.log('🎯 [WORKER] Job received:', job.id);
  console.log('📋 [WORKER] Job data:', JSON.stringify(job.data, null, 2));
  
  const { submissionId, userId, problemId, language, fullCode, testcases } = job.data;
  
  try {
  
  console.log('🔍 Worker Debug - Job Data:');
  console.log('📥 Language:', language);
  console.log('📥 Language type:', typeof language);
  console.log('📥 Language === "CPP":', language === 'CPP');
  console.log('📥 Language === "JAVA":', language === 'JAVA');
  console.log('📥 Language === "PYTHON":', language === 'PYTHON');
  console.log('📥 Full job data:', job.data);
  
  // Debug logging for C++ submissions
  if (language === 'CPP') {
    console.log('🔍 C++ Worker Debug:');
    console.log('📥 Full code received:', fullCode);
    console.log('📥 Test case input:', testcases[0]?.input);
    console.log('🔧 About to call runCpp...');
  }
  
  // Debug logging for Python submissions
  if (language === 'PYTHON') {
    console.log('🔍 Python Worker Debug:');
    console.log('📥 Full code received:', fullCode);
    console.log('📥 Test case input:', testcases[0]?.input);
    console.log('🔧 About to call runPython...');
  }
  
  console.log('🔄 [WORKER] Starting job processing...');
  
  // Send "Running" status update
  await Submission.findByIdAndUpdate(submissionId, { status: 'Running' });
  console.log('✅ [WORKER] Updated submission status to Running');
  await sendWebSocketUpdate(userId, submissionId, { status: 'Running' });
  
  // Add a small delay to make the "Running" state visible
  await new Promise(resolve => setTimeout(resolve, 300));
  
  let status = 'Success';
  let results: any[] = [];
  
  console.log(`🔄 [WORKER] Processing ${testcases.length} test cases...`);
  
  for (let i = 0; i < testcases.length; i++) {
    const testcase = testcases[i];
    console.log(`📝 [WORKER] Processing test case ${i + 1}/${testcases.length}:`, testcase);
    let execResult;
    
    if (language === 'JAVA') {
      // Accept the full method (with signature) as userCode for Java
      console.log('🚀 Calling runJava with:', { fullCode, input: testcase.input });
      try {
        execResult = await runJava(fullCode, testcase.input);
        console.log('✅ runJava completed successfully');
        console.log('📤 runJava result:', execResult);
      } catch (error) {
        console.error('❌ runJava failed with error:', error);
        throw error;
      }
    } else if (language === 'PYTHON') {
      console.log('🚀 Calling runPython with:', { fullCode, input: testcase.input });
      try {
        execResult = await runPython(fullCode, testcase.input);
        console.log('✅ runPython completed successfully');
        console.log('📤 runPython result:', execResult);
      } catch (error) {
        console.error('❌ runPython failed with error:', error);
        throw error;
      }
    } else if (language === 'CPP') {
      console.log('🚀 Calling runCpp with:', { fullCode, input: testcase.input });
      try {
        execResult = await runCpp(fullCode, testcase.input);
        console.log('✅ runCpp completed successfully');
        console.log('📤 runCpp result:', execResult);
      } catch (error) {
        console.error('❌ runCpp failed with error:', error);
        throw error;
      }
    } else {
      status = 'RE';
      break;
    }
    
    const output = execResult.stdout.trim();
    const expected = testcase.output.trim();
    
    if (execResult.stderr) {
      status = 'RE';
      results.push({ testcase, output, error: execResult.stderr });
      
      // Send incremental update with current results
      await sendWebSocketUpdate(userId, submissionId, { 
        status: 'RE', 
        results: results.map(result => ({
          testcase: result.testcase,
          output: result.output,
          passed: result.output === result.testcase.output,
          error: result.error
        }))
      });
      break;
    } else if (output !== expected) {
      status = 'WA';
      results.push({ testcase, output, expected });
      
      // Send incremental update with current results
      await sendWebSocketUpdate(userId, submissionId, { 
        status: 'WA', 
        results: results.map(result => ({
          testcase: result.testcase,
          output: result.output,
          passed: result.output === result.testcase.output,
          error: result.error
        }))
      });
      break;
    } else {
      results.push({ testcase, output });
      
      // Send incremental update after each successful test case
      console.log(`✅ Test case ${i + 1}/${testcases.length} completed successfully`);
      await sendWebSocketUpdate(userId, submissionId, { 
        status: 'Running', 
        results: results.map(result => ({
          testcase: result.testcase,
          output: result.output,
          passed: result.output === result.testcase.output,
          error: result.error
        }))
      });
      
      // Add a small delay to make progress visible (optional)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`✅ [WORKER] All test cases processed. Final status: ${status}`);
  console.log(`📊 [WORKER] Results:`, results);
  
  // Update submission in DB
  await Submission.findByIdAndUpdate(submissionId, { 
    status,
    results: results.map(result => ({
      testcase: result.testcase,
      output: result.output,
      passed: result.output === result.testcase.output,
      error: result.error,
      expected: result.expected
    }))
  });
  console.log('✅ [WORKER] Updated submission in database');
  
  // Send final status update via WebSocket
  await sendWebSocketUpdate(userId, submissionId, { 
    status, 
    results: results.map(result => ({
      testcase: result.testcase,
      output: result.output,
      passed: result.output === result.testcase.output,
      error: result.error,
      expected: result.expected
    }))
  });
  
  return { status, results };
  } catch (error) {
    console.error('❌ Worker job processing failed:', error);
    
    // Update submission status to failed
    await Submission.findByIdAndUpdate(submissionId, { status: 'Failed' });
    
    // Send failure update via WebSocket
    await sendWebSocketUpdate(userId, submissionId, { 
      status: 'Failed', 
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
    
    // Re-throw the error so BullMQ can handle it
    throw error;
  }
}, { connection: redisOptions });

submissionWorker.on('completed', (job) => {
  console.log(`✅ [WORKER] Job ${job.id} completed successfully`);
});

submissionWorker.on('failed', async (job, err) => {
  console.error(`❌ [WORKER] Job ${job?.id} failed:`, err);
  
  if (job) {
    const { submissionId, userId } = job.data;
    
    // Update submission status to failed
    await Submission.findByIdAndUpdate(submissionId, { status: 'Failed' });
    
    // Send failure update via WebSocket
    await sendWebSocketUpdate(userId, submissionId, { 
      status: 'Failed', 
      error: err.message 
    });
  }
});

submissionWorker.on('active', (job) => {
  console.log(`🚀 [WORKER] Job ${job.id} started processing`);
});

submissionWorker.on('ready', () => {
  console.log('✅ [WORKER] Worker is ready and listening for jobs');
});

submissionWorker.on('error', (err) => {
  console.error('❌ [WORKER] Worker error:', err);
});

submissionWorker.on('closed', () => {
  console.log('🔌 [WORKER] Worker connection closed');
});

export default submissionWorker;