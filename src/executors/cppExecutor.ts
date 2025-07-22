import Docker from 'dockerode';
import { Problem, ExecutionResponse } from '../types';

const CPP_IMAGE = 'gcc:latest';

// Helper function to demultiplex Docker logs
function demultiplexDockerLogs(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  
  for (let i = 0; i < buffer.length; i += 8) {
    if (i + 8 > buffer.length) break;
    
    const header = buffer.slice(i, i + 8);
    const streamType = header[0];
    const payloadLength = header.readUInt32BE(4);
    
    if (i + 8 + payloadLength > buffer.length) break;
    
    const payload = buffer.slice(i + 8, i + 8 + payloadLength);
    const text = payload.toString('utf8');
    
    if (streamType === 1) {
      stdout += text;
    } else if (streamType === 2) {
      stderr += text;
    }
    
    i += payloadLength - 8; // Adjust for the payload we just processed
  }
  
  return { stdout, stderr };
}

// Helper function to pull Docker image
async function pullImage(docker: any, image: string): Promise<void> {
  try {
    await docker.pull(image);
    console.log(`✅ [CPP] Image ${image} pulled successfully`);
  } catch (error) {
    console.error(`❌ [CPP] Failed to pull image ${image}:`, error);
    throw error;
  }
}

// Helper function to create container
async function createContainer(docker: any, image: string, cmd: string[]): Promise<any> {
  try {
    const container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      HostConfig: {
        Memory: 512 * 1024 * 1024, // 512MB
        MemorySwap: 0,
        CpuPeriod: 100000,
        CpuQuota: 50000, // 50% CPU
        NetworkMode: 'none',
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: true,
        Binds: []
      }
    });
    console.log(`✅ [CPP] Container created: ${container.id}`);
    return container;
  } catch (error) {
    console.error(`❌ [CPP] Failed to create container:`, error);
    throw error;
  }
}

// Helper function to fetch decoded stream with timeout
function fetchDecodedStream(loggerStream: NodeJS.ReadableStream, rawLogBuffer: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log('⏰ [CPP] Timer called - TLE');
      reject(new Error('TLE'));
    }, 4000);

    loggerStream.on('end', () => {
      clearTimeout(timer);
      console.log('📝 [CPP] Stream ended, processing logs...');
      
      // Concatenate all collected log chunks into one complete buffer
      const completeStreamData = Buffer.concat(rawLogBuffer);
      
      // Decode the complete log stream
      const decodedStream = demultiplexDockerLogs(completeStreamData);
      
      console.log('🔍 [CPP] Decoded stream:', {
        stdoutLength: decodedStream.stdout.length,
        stderrLength: decodedStream.stderr.length,
        stdout: decodedStream.stdout.substring(0, 200) + '...',
        stderr: decodedStream.stderr.substring(0, 200) + '...'
      });
      
      if (decodedStream.stderr) {
        reject(new Error(decodedStream.stderr));
      } else {
        resolve(decodedStream.stdout);
      }
    });
  });
}

export async function runCpp(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('🚀 [CPP] Starting C++ execution...');
  
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  let container: any = null;
  
  try {
    // Extract the Solution class content from user code
    let solutionContent = userCode;
    
    // If user provided full class, extract just the content
    if (userCode.includes('class Solution')) {
      const classMatch = userCode.match(/class Solution\s*\{([\s\S]*)\}/);
      if (classMatch) {
        solutionContent = classMatch[1].trim();
      }
    }
    
    // Build the complete C++ program
    const fullCode = `#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <stack>
#include <map>
#include <set>
#include <cmath>
#include <climits>
#include <cstring>
#include <sstream>
#include <fstream>
#include <iomanip>
#include <numeric>
#include <functional>
#include <bitset>
#include <deque>
#include <list>
#include <array>
#include <tuple>
#include <utility>
#include <memory>
#include <chrono>
#include <random>
#include <cassert>
#include <cctype>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <cwchar>
#include <cwctype>

using namespace std;

class Solution {
    ${solutionContent}
};

int main() {
    // Read input from stdin
    string input;
    getline(cin, input);
    
    // Create solution instance
    Solution solution;
    
    // Execute and print result
    try {
        string result = solution.solve(input);
        cout << result << endl;
    } catch (const exception& e) {
        cerr << "Error: " << e.what() << endl;
    }
    
    return 0;
}`;

    console.log('📝 [CPP] Generated code length:', fullCode.length);
    
    // Prepare test cases
    const testCases = problem.testcases || [];
    console.log(`🧪 [CPP] Processing ${testCases.length} test cases`);
    
    let allOutputs = '';
    let passedTests = 0;
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`🧪 [CPP] Running test case ${i + 1}/${testCases.length}`);
      
      const input = testCase.input;
      const expectedOutput = testCase.output;
      
      // Create the run command
      const runCommand = `echo '${fullCode.replace(/'/g, '\\"')}' > main.cpp && g++ -std=c++17 -O2 -o main main.cpp && echo '${input.replace(/'/g, '\\"')}' | ./main`;
      
      console.log('🔧 [CPP] Run command length:', runCommand.length);
      
      // Pull image if needed
      await pullImage(docker, CPP_IMAGE);
      
      // Create and start container
      container = await createContainer(docker, CPP_IMAGE, ['/bin/sh', '-c', runCommand]);
      await container.start();
      
      // Set up log collection
      const rawLogBuffer: Buffer[] = [];
      const loggerStream = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: false,
        follow: true
      });
      
      loggerStream.on('data', (chunks: Buffer) => {
        rawLogBuffer.push(chunks);
      });
      
      try {
        const codeResponse = await fetchDecodedStream(loggerStream, rawLogBuffer);
        const trimmedResponse = codeResponse.trim();
        const trimmedExpected = expectedOutput.trim();
        
        console.log(`📊 [CPP] Test ${i + 1} - Expected: "${trimmedExpected}", Got: "${trimmedResponse}"`);
        
        if (trimmedResponse === trimmedExpected) {
          passedTests++;
          allOutputs += `TEST_${i + 1}:PASS\n`;
        } else {
          allOutputs += `TEST_${i + 1}:FAIL\n`;
        }
        
      } catch (error) {
        if (error instanceof Error) {
          console.log(`❌ [CPP] Test ${i + 1} error:`, error.message);
          if (error.message === 'TLE') {
            await container.kill();
          }
          allOutputs += `TEST_${i + 1}:ERROR\n`;
        } else {
          allOutputs += `TEST_${i + 1}:ERROR\n`;
        }
      } finally {
        // Remove container
        if (container) {
          await container.remove();
          container = null;
        }
      }
    }
    
    // Determine final status
    const status = passedTests === testCases.length ? 'SUCCESS' : 'WA';
    console.log(`✅ [CPP] Execution completed: ${passedTests}/${testCases.length} tests passed`);
    
    return { output: allOutputs, status };
    
  } catch (error) {
    console.error('❌ [CPP] Execution error:', error);
    if (error instanceof Error) {
      return { output: error.message, status: 'ERROR' };
    } else {
      return { output: String(error), status: 'ERROR' };
    }
  } finally {
    // Ensure container is removed
    if (container) {
      try {
        await container.remove();
      } catch (error) {
        console.error('❌ [CPP] Failed to remove container:', error);
      }
    }
  }
}