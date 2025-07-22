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
    await sendWebSocketUpdate(userId, submissionId, { status: 'Running' });
    
    // Add a small delay to make the "Running" state visible
    await new Promise(resolve => setTimeout(resolve, 300));
    
    let status = 'Success';
    let results: any[] = [];
    
    console.log(`🔄 [WORKER] Processing ${testcases.length} test cases with ${language} executor...`);
    
    // Use the appropriate executor based on language
    try {
      let execResult;
      
      switch (language) {
        case 'JAVA':
          execResult = await runJava(problem, userCode);
          break;
        case 'PYTHON':
          execResult = await runPython(problem, userCode);
          break;
        case 'CPP':
          execResult = await runCpp(problem, userCode);
          break;
        default:
          throw new Error(`Unsupported language: ${language}`);
      }
      
      console.log('✅ [WORKER] Execution completed');
      console.log('📤 [WORKER] Execution result:', execResult);
      
      // Parse the output to extract test results
      const outputLines = execResult.output.trim().split('\n');
      const testResults = [];
      
      for (let i = 0; i < testcases.length; i++) {
        const testcase = testcases[i];
        const outputLine = outputLines[i];
        
        if (!outputLine) {
          // Missing output line
          testResults.push({ 
            testcase, 
            output: '', 
            passed: false, 
            error: 'No output received' 
          });
          status = 'WA';
          continue;
        }
        
        // Parse output line format: "TEST_1:result"
        const match = outputLine.match(/TEST_\d+:(.+)/);
        if (!match) {
          testResults.push({ 
            testcase, 
            output: outputLine, 
            passed: false, 
            error: 'Invalid output format' 
          });
          status = 'WA';
          continue;
        }
        
        const actualOutput = match[1].trim();
        const expectedOutput = testcase.output.trim();
        const passed = actualOutput === expectedOutput;
        
        testResults.push({ 
          testcase, 
          output: actualOutput, 
          passed 
        });
        
        if (!passed) {
          status = 'WA';
        }
        
        // Send incremental update after each test case
        console.log(`✅ Test case ${i + 1}/${testcases.length} completed: ${passed ? 'PASSED' : 'FAILED'}`);
        await sendWebSocketUpdate(userId, submissionId, { 
          status: status === 'WA' ? 'WA' : 'Running', 
          results: testResults.map(result => ({
            testcase: result.testcase,
            output: result.output,
            passed: result.passed,
            error: result.error
          }))
        });
        
        // Add a small delay to make progress visible
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      results = testResults;
      
    } catch (execError: any) {
      console.error('❌ [WORKER] Execution failed:', execError);
      status = 'RE';
      results = testcases.map((testcase: any) => ({ 
        testcase, 
        output: '', 
        error: execError.message || 'Execution failed' 
      }));
      
      // Send error update
      await sendWebSocketUpdate(userId, submissionId, { 
        status: 'RE', 
        results: results.map(result => ({
          testcase: result.testcase,
          output: result.output,
          passed: false,
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