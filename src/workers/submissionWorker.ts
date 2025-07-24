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
  .catch(err => console.error('❌ [WORKER] MongoDB connection errors:', err));

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
  
  const { submissionId, userId, problemId, language, userCode, problem, testcases } = job.data;
  
  try {
    console.log('🔍 [WORKER] Starting execution...');
    console.log('📥 Language:', language);
    console.log('📥 Problem:', problem.title);
    console.log('📥 User code length:', userCode.length);
    
    // Send "Running" status update
    await Submission.findByIdAndUpdate(submissionId, { status: 'Running' });
    console.log('✅ [WORKER] Updated submission status to Running');
    await sendWebSocketUpdate(userId, submissionId, { 
      status: 'Running',
      progress: { completed: 0, total: testcases.length }
    });
    
    // Add a small delay to make the "Running" state visible
    await new Promise(resolve => setTimeout(resolve, 300));
    
    let status = 'Success';
    let results: any[] = [];
    
    console.log(`🔄 [WORKER] Processing ${testcases.length} test cases with ${language} executor...`);
    
    // Process test cases one by one for incremental progress
    try {
      for (let i = 0; i < testcases.length; i++) {
        const currentTestcase = testcases[i];
        console.log(`🧪 [WORKER] Processing test case ${i + 1}/${testcases.length}...`);
        
        // Create a temporary problem with only the current test case
        const singleTestProblem = {
          ...problem,
          testcases: [currentTestcase]
        };
        
        let execResult;
        
        switch (language) {
          case 'JAVA':
            execResult = await runJava(singleTestProblem, userCode);
            break;
          case 'PYTHON':
            execResult = await runPython(singleTestProblem, userCode);
            break;
          case 'CPP':
            execResult = await runCpp(singleTestProblem, userCode);
            break;
          default:
            throw new Error(`Unsupported language: ${language}`);
        }
        
        console.log(`📤 [WORKER] Test case ${i + 1} execution result:`, execResult);
        
        // Parse the output for this single test case
        const outputLines = execResult.output.trim().split('\n');
        let actualOutput = '';
        
        // Find the test result line
        for (const line of outputLines) {
          if (line.includes('TEST_1:') || (!line.includes('TEST_') && line.trim() !== '')) {
            if (line.includes('TEST_1:')) {
              const match = line.match(/TEST_1:(.+)/);
              actualOutput = match ? match[1].trim() : '';
            } else {
              actualOutput = line.trim();
            }
            break;
          }
        }
        
        const expectedOutput = currentTestcase.output.trim();
        const passed = actualOutput === expectedOutput;
        
        const testResult = {
          testcase: currentTestcase,
          output: actualOutput,
          passed,
          error: actualOutput === '' ? 'No output received' : undefined
        };
        
        results.push(testResult);
        
        if (!passed) {
          status = 'WA';
        }
        
        // Send incremental progress update
        console.log(`✅ [WORKER] Test case ${i + 1}/${testcases.length} completed: ${passed ? 'PASSED' : 'FAILED'}`);
        
        await sendWebSocketUpdate(userId, submissionId, { 
          status: status === 'WA' && i === testcases.length - 1 ? 'WA' : 'Running',
          progress: { completed: i + 1, total: testcases.length },
          results: results.map(result => ({
            testcase: result.testcase,
            output: result.output,
            passed: result.passed,
            error: result.error
          }))
        });
        
        // Add a small delay to make progress visible
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
    } catch (execError: any) {
      console.error('❌ [WORKER] Execution failed:', execError);
      status = 'RE';
      
      // Fill remaining test cases with errors
      while (results.length < testcases.length) {
        results.push({
          testcase: testcases[results.length],
          output: '',
          passed: false,
          error: execError.message || 'Execution failed'
        });
      }
      
      // Send error update
      await sendWebSocketUpdate(userId, submissionId, { 
        status: 'RE',
        progress: { completed: testcases.length, total: testcases.length },
        results: results.map(result => ({
          testcase: result.testcase,
          output: result.output,
          passed: result.passed,
          error: result.error
        }))
      });
    }
    
    console.log(`✅ [WORKER] All test cases processed. Final status: ${status}`);
    console.log(`📊 [WORKER] Results:`, results);
    
    // Update submission in DB
    await Submission.findByIdAndUpdate(submissionId, { 
      status,
      results: results.map(result => ({
        testcase: result.testcase,
        output: result.output,
        passed: result.passed,
        error: result.error
      }))
    });
    
    // Send final status update
    await sendWebSocketUpdate(userId, submissionId, { 
      status,
      progress: { completed: testcases.length, total: testcases.length },
      results: results.map(result => ({
        testcase: result.testcase,
        output: result.output,
        passed: result.passed,
        error: result.error
      }))
    });
    
    console.log(`✅ [WORKER] Job completed successfully: ${submissionId}`);
    
  } catch (error: any) {
    console.error('❌ [WORKER] Job processing error:', error);
    
    // Update submission status to failed
    await Submission.findByIdAndUpdate(submissionId, { 
      status: 'Failed',
      results: []
    });
    
    // Send error update
    await sendWebSocketUpdate(userId, submissionId, { 
      status: 'Failed',
      progress: { completed: 0, total: testcases.length },
      error: error.message || 'Unknown error occurred'
    });
  }
}, {
  connection: redisOptions,
  concurrency: 1
});

submissionWorker.on('completed', (job) => {
  console.log(`✅ [WORKER] Job ${job.id} completed successfully`);
});

submissionWorker.on('failed', (job, err) => {
  console.error(`❌ [WORKER] Job ${job?.id} failed:`, err);
});

console.log('✅ [WORKER] Submission worker started and listening for jobs...');