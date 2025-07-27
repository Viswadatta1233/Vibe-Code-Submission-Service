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
  console.log('📡 [WORKER] Broadcasting WebSocket update to all containers:', { userId, submissionId, data });
  
  const containers = ['5001', '5002', '5003'];
  const broadcastPromises = containers.map(async (port) => {
    try {
      const response = await axios.post(`http://host.docker.internal:${port}/api/websocket/update`, {
        userId, submissionId, data
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 3000
      });
      
      if (response.status === 200) {
        console.log(`✅ [WORKER] WebSocket update sent successfully to container ${port} for user ${userId}, submission ${submissionId}`);
        return { port, success: true };
      } else {
        console.error(`❌ [WORKER] Failed to send WebSocket update to container ${port} for user ${userId}:`, response.statusText);
        return { port, success: false, error: response.statusText };
      }
    } catch (error: any) {
      console.error(`❌ [WORKER] Error sending WebSocket update to container ${port} for user ${userId}:`, error.message);
      return { port, success: false, error: error.message };
    }
  });
  
  // Wait for all broadcast attempts to complete
  const results = await Promise.allSettled(broadcastPromises);
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - successful;
  
  console.log(`📊 [WORKER] Broadcast complete for user ${userId}, submission ${submissionId}: ${successful}/${containers.length} containers reached`);
  
  if (failed > 0) {
    console.log(`⚠️ [WORKER] ${failed} containers failed to receive the update`);
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
        
        // Check if execution failed with an error
        if (execResult.status === 'error' && execResult.error) {
          console.log(`❌ [WORKER] Test case ${i + 1} failed with error:`, execResult.error);
          const testResult = {
            testcase: currentTestcase,
            output: '',
            passed: false,
            error: execResult.error
          };
          results.push(testResult);
          
          // Set status to RE (Runtime Error) and fill remaining test cases with the same error
          status = 'RE';
          
          // Fill remaining test cases with the same error
          while (results.length < testcases.length) {
            results.push({
              testcase: testcases[results.length],
              output: '',
              passed: false,
              error: execResult.error
            });
          }
          
          // Send error update immediately
          const passedCount = results.filter(result => result.passed).length;
          const totalCount = results.length;
          const percentage = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
          
          await sendWebSocketUpdate(userId, submissionId, { 
            status: 'RE',
            progress: { completed: testcases.length, total: testcases.length },
            percentage: percentage,
            passedCount: passedCount,
            totalCount: totalCount,
            results: results.map(result => ({
              testcase: result.testcase,
              output: result.output,
              passed: result.passed,
              error: result.error
            }))
          });
          
          // Update submission in DB and return early
          await Submission.findByIdAndUpdate(submissionId, { 
            status: 'RE',
            results: results.map(result => ({
              testcase: result.testcase,
              output: result.output,
              passed: result.passed,
              error: result.error
            })),
            percentage: percentage,
            passedCount: passedCount,
            totalCount: totalCount
          });
          
          console.log(`✅ [WORKER] Job completed with error: ${submissionId}`);
          return;
        }
        
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
        
        // Calculate current percentage
        const currentPassedCount = results.filter(result => result.passed).length;
        const currentPercentage = results.length > 0 ? Math.round((currentPassedCount / testcases.length) * 100) : 0;
        
        await sendWebSocketUpdate(userId, submissionId, { 
          status: status === 'WA' && i === testcases.length - 1 ? 'WA' : 'Running',
          progress: { completed: i + 1, total: testcases.length },
          percentage: currentPercentage,
          passedCount: currentPassedCount,
          totalCount: testcases.length,
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
      console.error('❌ [WORKER] Error details:', {
        message: execError.message,
        stack: execError.stack,
        stderr: execError.stderr
      });
      status = 'RE';
      
      // Extract the actual error message from the executor
      let errorMessage = 'Execution failed';
      if (execError.message && execError.message !== 'Execution failed with non-zero exit code') {
        errorMessage = execError.message;
      } else if (execError.stderr) {
        errorMessage = execError.stderr;
      } else if (execError.message) {
        errorMessage = execError.message;
      }
      
      // Fill remaining test cases with errors
      while (results.length < testcases.length) {
        results.push({
          testcase: testcases[results.length],
          output: '',
          passed: false,
          error: errorMessage
        });
      }
      
      // Calculate percentage for error case
      const passedCount = results.filter(result => result.passed).length;
      const totalCount = results.length;
      const percentage = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
      
      // Send error update
      await sendWebSocketUpdate(userId, submissionId, { 
        status: 'RE',
        progress: { completed: testcases.length, total: testcases.length },
        percentage: percentage,
        passedCount: passedCount,
        totalCount: totalCount,
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
    
    // Calculate overall percentage based on passed test cases
    const passedCount = results.filter(result => result.passed).length;
    const totalCount = results.length;
    const percentage = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
    
    console.log(`📊 [WORKER] Test Results Summary: ${passedCount}/${totalCount} passed (${percentage}%)`);
    
    // Update submission in DB
    await Submission.findByIdAndUpdate(submissionId, { 
      status,
      results: results.map(result => ({
        testcase: result.testcase,
        output: result.output,
        passed: result.passed,
        error: result.error
      })),
      percentage: percentage,
      passedCount: passedCount,
      totalCount: totalCount
    });
    
    // Send final status update
    await sendWebSocketUpdate(userId, submissionId, { 
      status,
      progress: { completed: testcases.length, total: testcases.length },
      percentage: percentage,
      passedCount: passedCount,
      totalCount: totalCount,
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
      results: [],
      percentage: 0,
      passedCount: 0,
      totalCount: testcases.length
    });
    
    // Send error update
    await sendWebSocketUpdate(userId, submissionId, { 
      status: 'Failed',
      progress: { completed: 0, total: testcases.length },
      percentage: 0,
      passedCount: 0,
      totalCount: testcases.length,
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