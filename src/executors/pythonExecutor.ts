import Docker from 'dockerode';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { Problem, ExecutionResponse } from '../types';

const docker = new Docker();

export async function runPython(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('🐍 [PYTHON] Starting Python execution...');
  console.log('📊 [PYTHON] Input validation:');
  console.log('  - Problem title:', problem.title);
  console.log('  - User code length:', userCode.length);
  console.log('  - Test cases count:', problem.testcases.length);
  console.log('  - Available code stubs:', problem.codeStubs.map(s => s.language));
  
  let tempFile: string | null = null;
  
  try {
    // Find Python code stub
    console.log('📋 [PYTHON] Looking for Python code stub...');
    const stub = problem.codeStubs.find(s => s.language === 'PYTHON');
    if (!stub) {
      console.error('❌ [PYTHON] Python code stub not found in problem');
      console.error('❌ [PYTHON] Available stubs:', problem.codeStubs.map(s => s.language));
      throw new Error('Python code stub not found');
    }
    console.log('📋 [PYTHON] Found Python stub');
    console.log('📋 [PYTHON] Stub details:');
    console.log('  - Start snippet length:', stub.startSnippet?.length || 0);
    console.log('  - End snippet length:', stub.endSnippet?.length || 0);
    console.log('  - User snippet length:', stub.userSnippet?.length || 0);

    // Extract function name from userSnippet
    console.log('🔍 [PYTHON] Extracting function name from userSnippet...');
    console.log('🔍 [PYTHON] UserSnippet:', stub.userSnippet);
    const functionName = extractFunctionName(stub.userSnippet);
    console.log('🔍 [PYTHON] Extracted function name:', functionName);

    // Generate complete code with test runner
    console.log('📝 [PYTHON] Generating complete code...');
    console.log('📝 [PYTHON] Input for code generation:');
    console.log('  - User code length:', userCode.length);
    console.log('  - Test cases count:', problem.testcases.length);
    console.log('  - Function name:', functionName);
    
    const completeCode = generatePythonCode(stub, userCode, problem.testcases, functionName);
    console.log('📝 [PYTHON] Generated complete code');
    console.log('📝 [PYTHON] Code preview (first 500 chars):', completeCode.substring(0, 500));
    console.log('📝 [PYTHON] Code preview (last 500 chars):', completeCode.substring(completeCode.length - 500));
    console.log('📝 [PYTHON] Total code length:', completeCode.length, 'characters');
    console.log('📝 [PYTHON] Number of lines:', completeCode.split('\n').length);
    
    // Log code structure
    const lines = completeCode.split('\n');
    console.log('📝 [PYTHON] Code structure:');
    console.log('  - Lines 1-5 (imports):', lines.slice(0, 5).join(' | '));
    console.log('  - Class declaration:', lines.find(line => line.includes('class Solution')));
    console.log('  - Method declaration:', lines.find(line => line.includes(`def ${functionName}`)));
    console.log('  - Main section:', lines.find(line => line.includes('if __name__')));
    console.log('  - Test cases count:', lines.filter(line => line.includes('TEST_')).length);
    
    // Validate generated code
    console.log('🔍 [PYTHON] Validating generated code...');
    if (!completeCode.includes('class Solution')) {
      console.error('❌ [PYTHON] Generated code missing Solution class');
      throw new Error('Generated code missing Solution class');
    }
    if (!completeCode.includes(`def ${functionName}(`)) {
      console.error(`❌ [PYTHON] Generated code missing ${functionName} method`);
      throw new Error(`Generated code missing ${functionName} method`);
    }
    if (!completeCode.includes('if __name__ == "__main__"')) {
      console.error('❌ [PYTHON] Generated code missing main section');
      throw new Error('Generated code missing main section');
    }
    console.log('✅ [PYTHON] Code validation passed');

    // Create temporary file
    console.log('💾 [PYTHON] Creating temporary file...');
    const tempFile = join(tmpdir(), `solution_${uuidv4()}.py`);
    console.log('💾 [PYTHON] Temp file path:', tempFile);
    
    try {
      await writeFile(tempFile, completeCode, 'utf8');
      console.log('💾 [PYTHON] File written successfully');
    } catch (writeError) {
      console.error('❌ [PYTHON] Failed to write temp file:', writeError);
      throw new Error(`Failed to write temp file: ${writeError}`);
    }
    
    console.log('💾 [PYTHON] File size:', completeCode.length, 'bytes');
    console.log('💾 [PYTHON] File exists:', require('fs').existsSync(tempFile));
    
    // Verify file content
    try {
      const writtenContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('💾 [PYTHON] Written file size:', writtenContent.length, 'bytes');
      console.log('💾 [PYTHON] Content matches:', writtenContent === completeCode);
    } catch (readError) {
      console.error('❌ [PYTHON] Failed to read temp file for verification:', readError);
    }

    // Execute in Docker container
    console.log('🐳 [PYTHON] Starting Docker execution...');
    console.log('🐳 [PYTHON] Test cases count:', problem.testcases.length);
    const result = await executePythonInDocker(tempFile, problem.testcases.length);
    console.log('✅ [PYTHON] Execution completed');
    console.log('✅ [PYTHON] Result status:', result.status);
    console.log('✅ [PYTHON] Result output length:', result.output.length);

    // Clean up temp file
    console.log('🧹 [PYTHON] Cleaning up temp file...');
    try {
      await unlink(tempFile);
      console.log('🧹 [PYTHON] Temp file cleaned up successfully');
    } catch (cleanupError) {
      console.warn('⚠️ [PYTHON] Failed to cleanup temp file:', cleanupError);
      console.warn('⚠️ [PYTHON] Temp file path:', tempFile);
    }

    console.log('✅ [PYTHON] Python execution completed successfully');
    return result;
  } catch (error: any) {
    console.error('❌ [PYTHON] Execution failed with error:', error);
    console.error('❌ [PYTHON] Error type:', typeof error);
    console.error('❌ [PYTHON] Error message:', error.message);
    console.error('❌ [PYTHON] Error stack:', error.stack);
    
    // Clean up temp file on error
    if (tempFile) {
      try {
        console.log('🧹 [PYTHON] Cleaning up temp file after error...');
        await unlink(tempFile);
        console.log('🧹 [PYTHON] Temp file cleaned up after error');
      } catch (cleanupError) {
        console.warn('⚠️ [PYTHON] Failed to cleanup temp file after error:', cleanupError);
      }
    }
    
    throw error;
  }
}

function extractFunctionName(userSnippet: string): string {
  console.log('🔍 [PYTHON-EXTRACT] Extracting function name from:', userSnippet);
  
  // Extract function name from patterns like:
  // "def isValid(self, s):" -> "isValid"
  // "def maxSubArray(self, nums):" -> "maxSubArray"
  const functionMatch = userSnippet.match(/def\s+(\w+)\s*\(/);
  if (!functionMatch) {
    console.error('❌ [PYTHON-EXTRACT] Could not extract function name from userSnippet');
    console.error('❌ [PYTHON-EXTRACT] UserSnippet:', userSnippet);
    throw new Error('Could not extract function name from userSnippet');
  }
  
  const functionName = functionMatch[1];
  console.log('✅ [PYTHON-EXTRACT] Extracted function name:', functionName);
  return functionName;
}

function generatePythonCode(stub: any, userCode: string, testcases: any[], functionName: string): string {
  console.log('📝 [PYTHON-GENERATE] Generating Python code...');
  console.log('📝 [PYTHON-GENERATE] Input parameters:');
  console.log('  - Start snippet length:', stub.startSnippet?.length || 0);
  console.log('  - User code length:', userCode.length);
  console.log('  - End snippet length:', stub.endSnippet?.length || 0);
  console.log('  - Test cases count:', testcases.length);
  console.log('  - Function name:', functionName);
  
  const startSnippet = stub.startSnippet || '';
  const endSnippet = stub.endSnippet || '';
  
  // Add necessary imports
  const imports = `import json
import re
import sys
import math
import collections
from collections import defaultdict, deque, Counter
from typing import List, Optional, Union, Dict, Tuple, Set
from functools import lru_cache
from itertools import combinations, permutations
from heapq import heappush, heappop, heapify

`;
  
  // Generate test runner
  console.log('📝 [PYTHON-GENERATE] Generating test runner...');
  const testRunner = generatePythonTestRunner(testcases, functionName, userCode);
  console.log('📝 [PYTHON-GENERATE] Test runner length:', testRunner.length);
  
  // Check if user code already contains class structure
  const userCodeContainsClass = userCode.includes('class Solution');
  
  // Combine the code with test runner
  let completeCode;
  if (userCodeContainsClass) {
    // User code already has class structure, just add our imports and test runner
    completeCode = `${imports}${userCode}

${testRunner}`;
  } else {
    // User code needs to be properly indented inside the class
    // Add 4 spaces to each line of user code for proper indentation
    const indentedUserCode = userCode.split('\n').map(line => {
      // Don't indent empty lines
      if (line.trim() === '') return line;
      // Add 4 spaces for class indentation
      return '    ' + line;
    }).join('\n');
    
    // Use database snippets with properly indented user code
    completeCode = `${imports}${startSnippet}${indentedUserCode}
${endSnippet}

${testRunner}`;
  }
  
  console.log('📝 [PYTHON-GENERATE] Complete code length:', completeCode.length);
  console.log('✅ [PYTHON-GENERATE] Code generation completed');
  
  return completeCode;
}

function generatePythonTestRunner(testcases: any[], functionName: string, userCode: string): string {
  // Extract parameter type from method signature
  const parameterType = extractParameterType(userCode, functionName);
  console.log('🔍 [PYTHON-TESTGEN] Detected parameter type:', parameterType);
  
  let testRunner = `if __name__ == "__main__":
    solution = Solution()
    
`;

  // Add individual test cases
  testcases.forEach((testcase, index) => {
    const input = testcase.input;
    const expectedOutput = testcase.output;
    
    testRunner += `    # Test case ${index + 1}
    try:
        raw_input_${index + 1} = "${input.replace(/"/g, '\\"')}"
        expected_${index + 1} = "${expectedOutput}"
        result_${index + 1} = None
        
`;

    // Generate different input parsing based on parameter type
    if (parameterType === 'str') {
      testRunner += `        # String parameter
        clean_input = raw_input_${index + 1}.strip('"')
        result_${index + 1} = solution.${functionName}(clean_input)
`;
    } else if (parameterType === 'int') {
      testRunner += `        # Integer parameter
        int_input = int(raw_input_${index + 1})
        result_${index + 1} = solution.${functionName}(int_input)
`;
    } else if (parameterType === 'List[int]') {
      testRunner += `        # Integer list parameter
        if raw_input_${index + 1} == "[]":
            list_input = []
        else:
            # Parse array format: "[1,2,3]" -> [1,2,3]
            array_str = raw_input_${index + 1}.strip('[]')
            if array_str.strip():
                list_input = [int(x.strip()) for x in array_str.split(',')]
            else:
                list_input = []
        result_${index + 1} = solution.${functionName}(list_input)
`;
    } else {
      // Fallback to string
      testRunner += `        # Fallback to string parameter
        clean_input = raw_input_${index + 1}.strip('"')
        result_${index + 1} = solution.${functionName}(clean_input)
`;
    }

    testRunner += `        
        # Convert result to string for comparison
        result_str = str(result_${index + 1}).lower()
        expected_str = expected_${index + 1}.lower()
        
        print(f"TEST_${index + 1}:{result_str}")
        
    except Exception as e:
        print(f"TEST_${index + 1}:ERROR:{str(e)}")
    
`;
  });

  return testRunner;
}

function extractParameterType(userCode: string, functionName: string): string {
  console.log('🔍 [PYTHON-EXTRACT] Extracting parameter type for function:', functionName);
  console.log('🔍 [PYTHON-EXTRACT] User code snippet:', userCode.substring(0, 200) + '...');
  
  // Look for the method signature pattern
  const methodPattern = new RegExp(`def\\s+${functionName}\\s*\\(([^)]+)\\)`, 'i');
  const match = userCode.match(methodPattern);
  
  if (match && match[1]) {
    const parameters = match[1].trim();
    console.log('🔍 [PYTHON-EXTRACT] Found parameters:', parameters);
    
    // Split parameters and analyze the second parameter (first is usually 'self')
    const paramList = parameters.split(',').map(p => p.trim());
    console.log('🔍 [PYTHON-EXTRACT] Parameter list:', paramList);
    
    if (paramList.length > 1) {
      const mainParam = paramList[1]; // Skip 'self', get the actual parameter
      console.log('🔍 [PYTHON-EXTRACT] Main parameter:', mainParam);
      
      // Analyze parameter name patterns dynamically
      if (mainParam.includes('nums') || mainParam.includes('arr') || mainParam.includes('array') ||
          mainParam.includes('list') || mainParam.includes('List')) {
        console.log('🔍 [PYTHON-EXTRACT] Detected type: List[int] (array-like parameter)');
        return 'List[int]';
      } else if (mainParam.length === 1 && /^[a-z]$/.test(mainParam) && mainParam !== 's') {
        // Single letter parameter (except 's') usually indicates integer (x, n, k, etc.)
        console.log('🔍 [PYTHON-EXTRACT] Detected type: int (single letter parameter)');
        return 'int';
      } else if (mainParam === 's' || mainParam.includes('str') || mainParam.includes('string')) {
        console.log('🔍 [PYTHON-EXTRACT] Detected type: str (string parameter)');
        return 'str';
      }
    }
  }
  
  console.log('🔍 [PYTHON-EXTRACT] No clear pattern found, defaulting to str');
  return 'str';
}

async function executePythonInDocker(tempFile: string, testCaseCount: number): Promise<ExecutionResponse> {
  console.log('🐳 [PYTHON-DOCKER] Starting Docker execution...');
  console.log('🐳 [PYTHON-DOCKER] Input parameters:');
  console.log('  - Temp file:', tempFile);
  console.log('  - Test case count:', testCaseCount);
  console.log('  - Temp file exists:', require('fs').existsSync(tempFile));
  
  return new Promise(async (resolve, reject) => {
    let container: any = null;
    
    try {
      // Pull Python Docker image if not exists
      console.log('🐳 [PYTHON-DOCKER] Pulling Docker image...');
      await pullDockerImage('python:3.9-slim');
      console.log('✅ [PYTHON-DOCKER] Docker image ready');
      
      // Use STDIN/pipe approach - much simpler and more reliable
      console.log('📁 [PYTHON-DOCKER] Using STDIN/pipe approach...');
      
      console.log('📁 [PYTHON-DOCKER] Source file:', tempFile);
      console.log('📁 [PYTHON-DOCKER] Source file exists:', require('fs').existsSync(tempFile));
      
      // Create container with STDIN enabled
      console.log('🐳 [PYTHON-DOCKER] Creating container with STDIN...');
      const container = await docker.createContainer({
        Image: 'python:3.9-slim',
        Cmd: [
          'sh', '-c', 
          'echo "=== Receiving file via STDIN ===" && ' +
          'cat > /app/solution.py && ' +
          'echo "=== File received ===" && ' +
          'echo "=== Listing /app ===" && ls -la /app && ' +
          'echo "=== File content ===" && cat /app/solution.py && ' +
          'echo "=== Running ===" && cd /app && python solution.py'
        ],
        HostConfig: {
          Memory: 512 * 1024 * 1024, // 512MB memory limit
          MemorySwap: 0,
          CpuPeriod: 100000,
          CpuQuota: 50000, // 50% CPU limit
          NetworkMode: 'none', // No network access
          SecurityOpt: ['no-new-privileges']
        },
        WorkingDir: '/app',
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: true
      });
      
      console.log('🐳 [PYTHON-DOCKER] Created container with STDIN:', container.id);
      
      // Start the container
      await container.start();
      console.log('🚀 [PYTHON-DOCKER] Container started with STDIN');
      
      // Attach to container and send file content via STDIN
      console.log('📁 [PYTHON-DOCKER] Attaching to container...');
      const attachStream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true
      });
      
      // Send file content via STDIN
      console.log('📁 [PYTHON-DOCKER] Sending file content via STDIN...');
      const pythonSourceContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('📁 [PYTHON-DOCKER] File content length:', pythonSourceContent.length, 'characters');
      
      attachStream.write(pythonSourceContent);
      attachStream.end();
      console.log('✅ [PYTHON-DOCKER] File content sent via STDIN');
      
      // Log the file content that was copied
      console.log('📁 [PYTHON-DOCKER] File content that was copied:');
      const fileContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('📁 [PYTHON-DOCKER] File size:', fileContent.length, 'bytes');
      console.log('📁 [PYTHON-DOCKER] First 10 lines:');
      fileContent.split('\n').slice(0, 10).forEach((line, i) => {
        console.log(`    ${i + 1}: ${line}`);
      });

      // Get output stream
      console.log('📤 [PYTHON-DOCKER] Getting container logs stream...');
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 100
      });
      console.log('📤 [PYTHON-DOCKER] Log stream obtained');

      let stdout = '';
      let stderr = '';
      let hasOutput = false;

      // Set timeout for execution
      console.log('⏰ [PYTHON-DOCKER] Setting execution timeout (10 seconds)...');
      const timeout = setTimeout(async () => {
        console.log('⏰ [PYTHON-DOCKER] Execution timeout, killing container');
        try {
          await container.kill();
          console.log('⏰ [PYTHON-DOCKER] Container killed due to timeout');
        } catch (killError) {
          console.warn('⚠️ [PYTHON-DOCKER] Failed to kill container:', killError);
        }
        resolve({
          output: '',
          status: 'error',
          error: 'Execution timeout (10 seconds)'
        });
      }, 10000);

      // Process output stream
      console.log('📤 [PYTHON-DOCKER] Processing output stream...');
      if (stream && typeof stream.on === 'function') {
        console.log('📤 [PYTHON-DOCKER] Stream is valid, setting up event handlers');
        
        stream.on('data', (chunk: Buffer) => {
          hasOutput = true;
          console.log('📤 [PYTHON-DOCKER] Received chunk:', chunk.length, 'bytes');
          
          // Parse Docker log format properly
          const cleanData = parseDockerLogChunk(chunk);
          
          if (cleanData) {
            stdout += cleanData;
            console.log('📤 [PYTHON-DOCKER] Clean data added to stdout');
          } else {
            console.log('📤 [PYTHON-DOCKER] No clean data from chunk');
          }
        });

        stream.on('end', async () => {
          console.log('📤 [PYTHON-DOCKER] Stream ended');
          clearTimeout(timeout);
          
          try {
            // Get container info
            console.log('📊 [PYTHON-DOCKER] Getting container info...');
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [PYTHON-DOCKER] Container exit code:', exitCode);
            console.log('📤 [PYTHON-DOCKER] Stdout length:', stdout.length);
            console.log('📤 [PYTHON-DOCKER] Stdout:', stdout);
            console.log('📤 [PYTHON-DOCKER] Stderr length:', stderr.length);
            console.log('📤 [PYTHON-DOCKER] Stderr:', stderr);

            // Clean up container
            console.log('🧹 [PYTHON-DOCKER] Removing container...');
            await container.remove();
            console.log('🧹 [PYTHON-DOCKER] Container removed');

            if (exitCode === 0) {
              console.log('✅ [PYTHON-DOCKER] Container exited successfully');
              // Parse test results
              console.log('🔍 [PYTHON-DOCKER] Parsing test results...');
              const results = parsePythonOutput(stdout, testCaseCount);
              console.log('🔍 [PYTHON-DOCKER] Parsed results:', results);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              console.log('❌ [PYTHON-DOCKER] Container exited with error code:', exitCode);
              // Handle compilation or execution errors
              const errorMessage = stderr || 'Execution failed with non-zero exit code';
              console.log('❌ [PYTHON-DOCKER] Error message:', errorMessage);
              resolve({
                output: '',
                status: 'error',
                error: errorMessage
              });
            }
          } catch (cleanupError) {
            console.error('❌ [PYTHON-DOCKER] Cleanup error:', cleanupError);
            console.error('❌ [PYTHON-DOCKER] Cleanup error details:', {
              message: cleanupError.message,
              stack: cleanupError.stack
            });
            reject(cleanupError);
          }
        });

        stream.on('error', (error) => {
          clearTimeout(timeout);
          console.error('❌ [PYTHON-DOCKER] Stream error:', error);
          console.error('❌ [PYTHON-DOCKER] Stream error details:', {
            message: error.message,
            stack: error.stack
          });
          reject(error);
        });
      } else {
        console.log('⚠️ [PYTHON-DOCKER] Invalid stream, using fallback method...');
        // Fallback: wait for container to finish and get logs
        setTimeout(async () => {
          clearTimeout(timeout);
          try {
            console.log('📤 [PYTHON-DOCKER] Fallback: Getting container logs...');
            const logs = await container.logs({ stdout: true, stderr: true });
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [PYTHON-DOCKER] Fallback: Container exit code:', exitCode);
            console.log('📤 [PYTHON-DOCKER] Fallback: Logs length:', logs.length);
            console.log('📤 [PYTHON-DOCKER] Fallback: Logs:', logs.toString());

            await container.remove();
            console.log('🧹 [PYTHON-DOCKER] Fallback: Container removed');

            if (exitCode === 0) {
              console.log('✅ [PYTHON-DOCKER] Fallback: Container exited successfully');
              const results = parsePythonOutput(logs.toString(), testCaseCount);
              console.log('🔍 [PYTHON-DOCKER] Fallback: Parsed results:', results);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              console.log('❌ [PYTHON-DOCKER] Fallback: Container exited with error');
              resolve({
                output: '',
                status: 'error',
                error: 'Execution failed with non-zero exit code'
              });
            }
          } catch (error) {
            console.error('❌ [PYTHON-DOCKER] Fallback error:', error);
            console.error('❌ [PYTHON-DOCKER] Fallback error details:', {
              message: error.message,
              stack: error.stack
            });
            reject(error);
          }
        }, 5000);
      }

    } catch (error) {
      console.error('❌ [PYTHON-DOCKER] Docker execution error:', error);
      console.error('❌ [PYTHON-DOCKER] Error details:', {
        message: error.message,
        stack: error.stack,
        tempFile: tempFile,
        testCaseCount: testCaseCount
      });
      
      // Clean up container on error
      if (container) {
        try {
          console.log('🧹 [PYTHON-DOCKER] Cleaning up container after error...');
          await container.remove();
          console.log('🧹 [PYTHON-DOCKER] Container cleaned up after error');
        } catch (cleanupError) {
          console.warn('⚠️ [PYTHON-DOCKER] Failed to cleanup container after error:', cleanupError);
        }
      }
      
      reject(error);
    }
  });
}

function parseDockerLogChunk(chunk: Buffer): string {
  let result = '';
  let offset = 0;
  
  while (offset < chunk.length) {
    // Docker log format: [stream_type(1)][padding(3)][size(4)][payload(size)]
    if (offset + 8 > chunk.length) {
      // Not enough bytes for header, treat remaining as raw data
      result += chunk.slice(offset).toString('utf8');
      break;
    }
    
    // Read the header
    const streamType = chunk.readUInt8(offset);     // 1 byte: stream type (1=stdout, 2=stderr)
    const size = chunk.readUInt32BE(offset + 4);    // 4 bytes: payload size (big-endian)
    
    // Skip header (8 bytes)
    offset += 8;
    
    // Check if we have enough bytes for the payload
    if (offset + size > chunk.length) {
      // Not enough bytes for full payload, take what we have
      const availableSize = chunk.length - offset;
      result += chunk.slice(offset, offset + availableSize).toString('utf8');
      break;
    }
    
    // Extract payload
    const payload = chunk.slice(offset, offset + size).toString('utf8');
    result += payload;
    
    // Move to next frame
    offset += size;
  }
  
  return result;
}

function parsePythonOutput(output: string, expectedTestCount: number): string[] {
  console.log('🔍 [PYTHON-PARSE] Parsing output for', expectedTestCount, 'test cases');
  console.log('🔍 [PYTHON-PARSE] Output length:', output.length);
  console.log('🔍 [PYTHON-PARSE] Output preview:', output.substring(output.length - 500));
  
  // Find and log the execution section
  const runningIndex = output.indexOf('=== Running ===');
  if (runningIndex !== -1) {
    const executionOutput = output.substring(runningIndex);
    console.log('🔍 [PYTHON-PARSE] Execution section:', executionOutput.substring(0, 200));
    const executionLines = executionOutput.split('\n');
    console.log('🔍 [PYTHON-PARSE] Execution lines:', executionLines.slice(0, 10));
  }
  
  const lines = output.trim().split('\n');
  const results: string[] = [];
  
  // Search for TEST_X patterns that are actual execution results (not source code)
  for (let i = 1; i <= expectedTestCount; i++) {
    const testPattern = `TEST_${i}:`;
    let found = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      // Look for lines that start with TEST_X: and don't contain Python code patterns
      if (trimmedLine.startsWith(testPattern) && 
          !trimmedLine.includes('print(f"') && 
          !trimmedLine.includes('result_str') &&
          !trimmedLine.includes('{result_str}')) {
        const result = trimmedLine.substring(testPattern.length);
        results.push(result);
        console.log(`🔍 [PYTHON-PARSE] Found execution result: ${testPattern}${result}`);
        found = true;
        break;
      }
    }
    
    if (!found) {
      console.log(`❌ [PYTHON-PARSE] Missing execution result for ${testPattern}`);
      // Try to find it in a different way - look for the pattern after "=== Running ==="
      const runningIndex = output.indexOf('=== Running ===');
      if (runningIndex !== -1) {
        const executionOutput = output.substring(runningIndex);
        const executionLines = executionOutput.split('\n');
        console.log(`🔍 [PYTHON-PARSE] Searching execution lines for ${testPattern}:`, executionLines);
        for (const execLine of executionLines) {
          const trimmedExecLine = execLine.trim();
          if (trimmedExecLine.startsWith(testPattern)) {
            const result = trimmedExecLine.substring(testPattern.length);
            results.push(result);
            console.log(`🔍 [PYTHON-PARSE] Found in execution section: ${testPattern}${result}`);
            found = true;
            break;
          }
        }
      }
      
      // Last resort: check if there's a standalone value that could be the result
      if (!found && i === expectedTestCount) {
        const runningIndex = output.indexOf('=== Running ===');
        if (runningIndex !== -1) {
          const executionOutput = output.substring(runningIndex);
          const lines = executionOutput.split('\n');
          // Look for the last non-empty line that could be a result
          for (let j = lines.length - 1; j >= 0; j--) {
            const line = lines[j].trim();
            if (line && /^(true|false|\d+)$/i.test(line)) {
              console.log(`🔍 [PYTHON-PARSE] Found standalone result for ${testPattern}: ${line}`);
              results.push(line);
              found = true;
              break;
            }
          }
        }
      }
      
      if (!found) {
        results.push('');
      }
    }
  }
  
  console.log('🔍 [PYTHON-PARSE] Final parsed results:', results);
  return results;
}

async function pullDockerImage(imageName: string): Promise<void> {
  try {
    const image = docker.getImage(imageName);
    await image.inspect();
    console.log('✅ [PYTHON] Docker image already exists:', imageName);
  } catch (error) {
    console.log('📥 [PYTHON] Pulling Docker image:', imageName);
    return new Promise((resolve, reject) => {
      docker.pull(imageName, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        
        docker.modem.followProgress(stream, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log('✅ [PYTHON] Docker image pulled successfully:', imageName);
            resolve();
          }
        });
      });
    });
  }
}
