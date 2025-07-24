import Docker from 'dockerode';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { Problem, ExecutionResponse } from '../types';

const docker = new Docker();

export async function runCpp(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('⚡ [CPP] Starting C++ execution...');
  console.log('📊 [CPP] Input validation:');
  console.log('  - Problem title:', problem.title);
  console.log('  - User code length:', userCode.length);
  console.log('  - Test cases count:', problem.testcases.length);
  console.log('  - Available code stubs:', problem.codeStubs.map(s => s.language));
  
  let tempFile: string | null = null;
  
  try {
    // Find C++ code stub
    console.log('📋 [CPP] Looking for C++ code stub...');
    const stub = problem.codeStubs.find(s => s.language === 'CPP');
    if (!stub) {
      console.error('❌ [CPP] C++ code stub not found in problem');
      console.error('❌ [CPP] Available stubs:', problem.codeStubs.map(s => s.language));
      throw new Error('C++ code stub not found');
    }
    console.log('📋 [CPP] Found C++ stub');
    console.log('📋 [CPP] Stub details:');
    console.log('  - Start snippet length:', stub.startSnippet?.length || 0);
    console.log('  - End snippet length:', stub.endSnippet?.length || 0);
    console.log('  - User snippet length:', stub.userSnippet?.length || 0);

    // Extract function name from userSnippet
    console.log('🔍 [CPP] Extracting function name from userSnippet...');
    console.log('🔍 [CPP] UserSnippet:', stub.userSnippet);
    const functionName = extractFunctionName(stub.userSnippet);
    console.log('🔍 [CPP] Extracted function name:', functionName);

    // Generate complete code with test runner
    console.log('📝 [CPP] Generating complete code...');
    console.log('📝 [CPP] Input for code generation:');
    console.log('  - User code length:', userCode.length);
    console.log('  - Test cases count:', problem.testcases.length);
    console.log('  - Function name:', functionName);
    
    const completeCode = generateCppCode(stub, userCode, problem.testcases, functionName);
    console.log('📝 [CPP] Generated complete code');
    console.log('📝 [CPP] Code preview (first 500 chars):', completeCode.substring(0, 500));
    console.log('📝 [CPP] Code preview (last 500 chars):', completeCode.substring(completeCode.length - 500));
    console.log('📝 [CPP] Total code length:', completeCode.length, 'characters');
    console.log('📝 [CPP] Number of lines:', completeCode.split('\n').length);
    
    // Log code structure
    const lines = completeCode.split('\n');
    console.log('📝 [CPP] Code structure:');
    console.log('  - Lines 1-5 (includes):', lines.slice(0, 5).join(' | '));
    console.log('  - Class declaration:', lines.find(line => line.includes('class Solution')));
    console.log('  - Method declaration:', lines.find(line => line.includes(functionName)));
    console.log('  - Main function:', lines.find(line => line.includes('int main')));
    console.log('  - Test cases count:', lines.filter(line => line.includes('TEST_')).length);
    
    // Validate generated code
    console.log('🔍 [CPP] Validating generated code...');
    if (!completeCode.includes('class Solution')) {
      console.error('❌ [CPP] Generated code missing Solution class');
      throw new Error('Generated code missing Solution class');
    }
    if (!completeCode.includes(functionName)) {
      console.error(`❌ [CPP] Generated code missing ${functionName} method`);
      throw new Error(`Generated code missing ${functionName} method`);
    }
    if (!completeCode.includes('int main(')) {
      console.error('❌ [CPP] Generated code missing main function');
      throw new Error('Generated code missing main function');
    }
    console.log('✅ [CPP] Code validation passed');

    // Create temporary file
    console.log('💾 [CPP] Creating temporary file...');
    const tempFile = join(tmpdir(), `solution_${uuidv4()}.cpp`);
    console.log('💾 [CPP] Temp file path:', tempFile);
    
    try {
      await writeFile(tempFile, completeCode, 'utf8');
      console.log('💾 [CPP] File written successfully');
    } catch (writeError) {
      console.error('❌ [CPP] Failed to write temp file:', writeError);
      throw new Error(`Failed to write temp file: ${writeError}`);
    }
    
    console.log('💾 [CPP] File size:', completeCode.length, 'bytes');
    console.log('💾 [CPP] File exists:', require('fs').existsSync(tempFile));
    
    // Verify file content
    try {
      const writtenContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('💾 [CPP] Written file size:', writtenContent.length, 'bytes');
      console.log('💾 [CPP] Content matches:', writtenContent === completeCode);
    } catch (readError) {
      console.error('❌ [CPP] Failed to read temp file for verification:', readError);
    }

    // Execute in Docker container
    console.log('🐳 [CPP] Starting Docker execution...');
    console.log('🐳 [CPP] Test cases count:', problem.testcases.length);
    const result = await executeCppInDocker(tempFile, problem.testcases.length);
    console.log('✅ [CPP] Execution completed');
    console.log('✅ [CPP] Result status:', result.status);
    console.log('✅ [CPP] Result output length:', result.output.length);

    // Clean up temp file
    console.log('🧹 [CPP] Cleaning up temp file...');
    try {
      await unlink(tempFile);
      console.log('🧹 [CPP] Temp file cleaned up successfully');
    } catch (cleanupError) {
      console.warn('⚠️ [CPP] Failed to cleanup temp file:', cleanupError);
      console.warn('⚠️ [CPP] Temp file path:', tempFile);
    }

    console.log('✅ [CPP] C++ execution completed successfully');
    return result;
  } catch (error: any) {
    console.error('❌ [CPP] Execution failed with error:', error);
    console.error('❌ [CPP] Error type:', typeof error);
    console.error('❌ [CPP] Error message:', error.message);
    console.error('❌ [CPP] Error stack:', error.stack);
    
    // Clean up temp file on error
    if (tempFile) {
      try {
        console.log('🧹 [CPP] Cleaning up temp file after error...');
        await unlink(tempFile);
        console.log('🧹 [CPP] Temp file cleaned up after error');
      } catch (cleanupError) {
        console.warn('⚠️ [CPP] Failed to cleanup temp file after error:', cleanupError);
      }
    }
    
    throw error;
  }
}

function extractFunctionName(userSnippet: string): string {
  console.log('🔍 [CPP-EXTRACT] Extracting function name from:', userSnippet);
  
  // Extract function name from patterns like:
  // "bool isValid(std::string s) {" -> "isValid"
  // "int maxSubArray(std::vector<int>& nums) {" -> "maxSubArray"
  const functionMatch = userSnippet.match(/\w+\s+(\w+)\s*\(/);
  if (!functionMatch) {
    console.error('❌ [CPP-EXTRACT] Could not extract function name from userSnippet');
    console.error('❌ [CPP-EXTRACT] UserSnippet:', userSnippet);
    throw new Error('Could not extract function name from userSnippet');
  }
  
  const functionName = functionMatch[1];
  console.log('✅ [CPP-EXTRACT] Extracted function name:', functionName);
  return functionName;
}

function generateCppCode(stub: any, userCode: string, testcases: any[], functionName: string): string {
  console.log('📝 [CPP-GENERATE] Generating C++ code...');
  console.log('📝 [CPP-GENERATE] Input parameters:');
  console.log('  - Start snippet length:', stub.startSnippet?.length || 0);
  console.log('  - User code length:', userCode.length);
  console.log('  - End snippet length:', stub.endSnippet?.length || 0);
  console.log('  - Test cases count:', testcases.length);
  console.log('  - Function name:', functionName);
  
  const startSnippet = stub.startSnippet || '';
  const endSnippet = stub.endSnippet || '';
  
  // Add necessary includes
  const includes = `#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <algorithm>
#include <stack>
#include <queue>
#include <deque>
#include <set>
#include <map>
#include <unordered_set>
#include <unordered_map>
#include <climits>
#include <cmath>
#include <numeric>
#include <functional>
using namespace std;

`;
  
  // Generate test runner
  console.log('📝 [CPP-GENERATE] Generating test runner...');
  const testRunner = generateCppTestRunner(testcases, functionName, userCode);
  console.log('📝 [CPP-GENERATE] Test runner length:', testRunner.length);
  
  // Check if user code already contains class structure
  const userCodeContainsClass = userCode.includes('class Solution') && userCode.includes('public:');
  
  // Combine the code with test runner
  let completeCode;
  if (userCodeContainsClass) {
    // User code already has class structure, just add our includes and test runner
    // Remove the closing brace from user code and add test runner inside
    const userCodeWithoutClosing = userCode.replace(/}\s*;\s*$/, '').trim();
    completeCode = `${includes}${userCodeWithoutClosing}

${testRunner}`;
  } else {
    // Use database snippets as before
    completeCode = `${includes}${startSnippet}
${userCode}
${endSnippet}

${testRunner}`;
  }
  
  console.log('📝 [CPP-GENERATE] Complete code length:', completeCode.length);
  console.log('✅ [CPP-GENERATE] Code generation completed');
  
  return completeCode;
}

function generateCppTestRunner(testcases: any[], functionName: string, userCode: string): string {
  // Extract parameter type from method signature
  const parameterType = extractParameterType(userCode, functionName);
  console.log('🔍 [CPP-TESTGEN] Detected parameter type:', parameterType);
  
  // Check if user code contains class structure
  const userCodeContainsClass = userCode.includes('class Solution') && userCode.includes('public:');
  
  let testRunner;
  if (userCodeContainsClass) {
    // Close the class and add main function
    testRunner = `};

int main() {
    Solution solution;
    
`;
  } else {
    // Just add main function
    testRunner = `int main() {
    Solution solution;
    
`;
  }

  // Add individual test cases
  testcases.forEach((testcase, index) => {
    const input = testcase.input;
    const expectedOutput = testcase.output;
    
    testRunner += `    // Test case ${index + 1}
    try {
        string rawInput${index + 1} = "${input.replace(/"/g, '\\"')}";
        string expected${index + 1} = "${expectedOutput}";
        
`;

    // Generate different input parsing based on parameter type
    if (parameterType === 'string') {
      testRunner += `        // String parameter
        string cleanInput = rawInput${index + 1};
        // Remove quotes if present
        if (cleanInput.front() == '"' && cleanInput.back() == '"') {
            cleanInput = cleanInput.substr(1, cleanInput.length() - 2);
        }
        auto result${index + 1} = solution.${functionName}(cleanInput);
`;
    } else if (parameterType === 'int') {
      testRunner += `        // Integer parameter
        int intInput = stoi(rawInput${index + 1});
        auto result${index + 1} = solution.${functionName}(intInput);
`;
    } else if (parameterType === 'vector<int>') {
      testRunner += `        // Vector<int> parameter
        vector<int> vectorInput;
        if (rawInput${index + 1} != "[]") {
            // Parse array format: "[1,2,3]" -> vector{1,2,3}
            string arrayStr = rawInput${index + 1}.substr(1, rawInput${index + 1}.length() - 2);
            if (!arrayStr.empty()) {
                stringstream ss(arrayStr);
                string item;
                while (getline(ss, item, ',')) {
                    // Remove whitespace
                    item.erase(remove_if(item.begin(), item.end(), ::isspace), item.end());
                    if (!item.empty()) {
                        vectorInput.push_back(stoi(item));
                    }
                }
            }
        }
        auto result${index + 1} = solution.${functionName}(vectorInput);
`;
    } else {
      // Fallback to string
      testRunner += `        // Fallback to string parameter
        string cleanInput = rawInput${index + 1};
        // Remove quotes if present
        if (cleanInput.front() == '"' && cleanInput.back() == '"') {
            cleanInput = cleanInput.substr(1, cleanInput.length() - 2);
        }
        auto result${index + 1} = solution.${functionName}(cleanInput);
`;
    }

    testRunner += `        
        // Convert result to string for comparison
        string resultStr;
        if (typeid(result${index + 1}) == typeid(bool)) {
            resultStr = result${index + 1} ? "true" : "false";
        } else {
            resultStr = to_string(result${index + 1});
        }
        
        // Convert to lowercase for comparison
        transform(resultStr.begin(), resultStr.end(), resultStr.begin(), ::tolower);
        string expectedStr = expected${index + 1};
        transform(expectedStr.begin(), expectedStr.end(), expectedStr.begin(), ::tolower);
        
        cout << "TEST_${index + 1}:" << resultStr << endl;
        
    } catch (const exception& e) {
        cout << "TEST_${index + 1}:ERROR:" << e.what() << endl;
    }
    
`;
  });

  testRunner += `    return 0;
}`;

  return testRunner;
}

function extractParameterType(userCode: string, functionName: string): string {
  console.log('🔍 [CPP-EXTRACT] Extracting parameter type for function:', functionName);
  console.log('🔍 [CPP-EXTRACT] User code snippet:', userCode.substring(0, 200) + '...');
  
  // Look for the method signature pattern
  const methodPattern = new RegExp(`\\w+\\s+${functionName}\\s*\\(([^)]+)\\)`, 'i');
  const match = userCode.match(methodPattern);
  
  if (match && match[1]) {
    const parameters = match[1].trim();
    console.log('🔍 [CPP-EXTRACT] Found parameters:', parameters);
    
    // Extract the type from parameter patterns
    if (parameters.includes('vector<int>') || parameters.includes('std::vector<int>')) {
      console.log('🔍 [CPP-EXTRACT] Detected type: vector<int>');
      return 'vector<int>';
    } else if (parameters.includes('int ') && !parameters.includes('vector')) {
      console.log('🔍 [CPP-EXTRACT] Detected type: int');
      return 'int';
    } else if (parameters.includes('string') || parameters.includes('std::string')) {
      console.log('🔍 [CPP-EXTRACT] Detected type: string');
      return 'string';
    } else if (parameters.includes('bool')) {
      console.log('🔍 [CPP-EXTRACT] Detected type: bool');
      return 'bool';
    }
  }
  
  console.log('🔍 [CPP-EXTRACT] No match found, defaulting to string');
  return 'string';
}

async function executeCppInDocker(tempFile: string, testCaseCount: number): Promise<ExecutionResponse> {
  console.log('🐳 [CPP-DOCKER] Starting Docker execution...');
  console.log('🐳 [CPP-DOCKER] Input parameters:');
  console.log('  - Temp file:', tempFile);
  console.log('  - Test case count:', testCaseCount);
  console.log('  - Temp file exists:', require('fs').existsSync(tempFile));
  
  return new Promise(async (resolve, reject) => {
    let container: any = null;
    
    try {
      // Pull C++ Docker image if not exists
      console.log('🐳 [CPP-DOCKER] Pulling Docker image...');
      await pullDockerImage('gcc:latest');
      console.log('✅ [CPP-DOCKER] Docker image ready');
      
      // Use STDIN/pipe approach - much simpler and more reliable
      console.log('📁 [CPP-DOCKER] Using STDIN/pipe approach...');
      
      console.log('📁 [CPP-DOCKER] Source file:', tempFile);
      console.log('📁 [CPP-DOCKER] Source file exists:', require('fs').existsSync(tempFile));
      
      // Create container with STDIN enabled
      console.log('🐳 [CPP-DOCKER] Creating container with STDIN...');
      const container = await docker.createContainer({
        Image: 'gcc:latest',
        Cmd: [
          'sh', '-c', 
          'echo "=== Receiving file via STDIN ===" && ' +
          'cat > /app/solution.cpp && ' +
          'echo "=== File received ===" && ' +
          'echo "=== Listing /app ===" && ls -la /app && ' +
          'echo "=== File content ===" && cat /app/solution.cpp && ' +
          'echo "=== Compiling ===" && cd /app && g++ -std=c++17 -o solution solution.cpp && ' +
          'echo "=== Running ===" && ./solution'
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
      
      console.log('🐳 [CPP-DOCKER] Created container with STDIN:', container.id);
      
      // Start the container
      await container.start();
      console.log('🚀 [CPP-DOCKER] Container started with STDIN');
      
      // Attach to container and send file content via STDIN
      console.log('📁 [CPP-DOCKER] Attaching to container...');
      const attachStream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true
      });
      
      // Send file content via STDIN
      console.log('📁 [CPP-DOCKER] Sending file content via STDIN...');
      const cppSourceContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('📁 [CPP-DOCKER] File content length:', cppSourceContent.length, 'characters');
      
      attachStream.write(cppSourceContent);
      attachStream.end();
      console.log('✅ [CPP-DOCKER] File content sent via STDIN');
      
      // Log the file content that was copied
      console.log('📁 [CPP-DOCKER] File content that was copied:');
      const fileContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('📁 [CPP-DOCKER] File size:', fileContent.length, 'bytes');
      console.log('📁 [CPP-DOCKER] First 10 lines:');
      fileContent.split('\n').slice(0, 10).forEach((line, i) => {
        console.log(`    ${i + 1}: ${line}`);
      });

      // Get output stream
      console.log('📤 [CPP-DOCKER] Getting container logs stream...');
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 100
      });
      console.log('📤 [CPP-DOCKER] Log stream obtained');

      let stdout = '';
      let stderr = '';
      let hasOutput = false;

      // Set timeout for execution
      console.log('⏰ [CPP-DOCKER] Setting execution timeout (10 seconds)...');
      const timeout = setTimeout(async () => {
        console.log('⏰ [CPP-DOCKER] Execution timeout, killing container');
        try {
          await container.kill();
          console.log('⏰ [CPP-DOCKER] Container killed due to timeout');
        } catch (killError) {
          console.warn('⚠️ [CPP-DOCKER] Failed to kill container:', killError);
        }
        resolve({
          output: '',
          status: 'error',
          error: 'Execution timeout (10 seconds)'
        });
      }, 10000);

      // Process output stream
      console.log('📤 [CPP-DOCKER] Processing output stream...');
      if (stream && typeof stream.on === 'function') {
        console.log('📤 [CPP-DOCKER] Stream is valid, setting up event handlers');
        
        stream.on('data', (chunk: Buffer) => {
          hasOutput = true;
          console.log('📤 [CPP-DOCKER] Received chunk:', chunk.length, 'bytes');
          
          // Parse Docker log format properly
          const cleanData = parseDockerLogChunk(chunk);
          
          if (cleanData) {
            stdout += cleanData;
            console.log('📤 [CPP-DOCKER] Clean data added to stdout');
          } else {
            console.log('📤 [CPP-DOCKER] No clean data from chunk');
          }
        });

        stream.on('end', async () => {
          console.log('📤 [CPP-DOCKER] Stream ended');
          clearTimeout(timeout);
          
          try {
            // Get container info
            console.log('📊 [CPP-DOCKER] Getting container info...');
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [CPP-DOCKER] Container exit code:', exitCode);
            console.log('📤 [CPP-DOCKER] Stdout length:', stdout.length);
            console.log('📤 [CPP-DOCKER] Stdout:', stdout);
            console.log('📤 [CPP-DOCKER] Stderr length:', stderr.length);
            console.log('📤 [CPP-DOCKER] Stderr:', stderr);

            // Clean up container
            console.log('🧹 [CPP-DOCKER] Removing container...');
            await container.remove();
            console.log('🧹 [CPP-DOCKER] Container removed');

            if (exitCode === 0) {
              console.log('✅ [CPP-DOCKER] Container exited successfully');
              // Parse test results
              console.log('🔍 [CPP-DOCKER] Parsing test results...');
              const results = parseCppOutput(stdout, testCaseCount);
              console.log('🔍 [CPP-DOCKER] Parsed results:', results);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              console.log('❌ [CPP-DOCKER] Container exited with error code:', exitCode);
              // Handle compilation or execution errors
              const errorMessage = stderr || 'Execution failed with non-zero exit code';
              console.log('❌ [CPP-DOCKER] Error message:', errorMessage);
              resolve({
                output: '',
                status: 'error',
                error: errorMessage
              });
            }
          } catch (cleanupError) {
            console.error('❌ [CPP-DOCKER] Cleanup error:', cleanupError);
            console.error('❌ [CPP-DOCKER] Cleanup error details:', {
              message: cleanupError.message,
              stack: cleanupError.stack
            });
            reject(cleanupError);
          }
        });

        stream.on('error', (error) => {
          clearTimeout(timeout);
          console.error('❌ [CPP-DOCKER] Stream error:', error);
          console.error('❌ [CPP-DOCKER] Stream error details:', {
            message: error.message,
            stack: error.stack
          });
          reject(error);
        });
      } else {
        console.log('⚠️ [CPP-DOCKER] Invalid stream, using fallback method...');
        // Fallback: wait for container to finish and get logs
        setTimeout(async () => {
          clearTimeout(timeout);
          try {
            console.log('📤 [CPP-DOCKER] Fallback: Getting container logs...');
            const logs = await container.logs({ stdout: true, stderr: true });
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [CPP-DOCKER] Fallback: Container exit code:', exitCode);
            console.log('📤 [CPP-DOCKER] Fallback: Logs length:', logs.length);
            console.log('📤 [CPP-DOCKER] Fallback: Logs:', logs.toString());

            await container.remove();
            console.log('🧹 [CPP-DOCKER] Fallback: Container removed');

            if (exitCode === 0) {
              console.log('✅ [CPP-DOCKER] Fallback: Container exited successfully');
              const results = parseCppOutput(logs.toString(), testCaseCount);
              console.log('🔍 [CPP-DOCKER] Fallback: Parsed results:', results);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              console.log('❌ [CPP-DOCKER] Fallback: Container exited with error');
              resolve({
                output: '',
                status: 'error',
                error: 'Execution failed with non-zero exit code'
              });
            }
          } catch (error) {
            console.error('❌ [CPP-DOCKER] Fallback error:', error);
            console.error('❌ [CPP-DOCKER] Fallback error details:', {
              message: error.message,
              stack: error.stack
            });
            reject(error);
          }
        }, 5000);
      }

    } catch (error) {
      console.error('❌ [CPP-DOCKER] Docker execution error:', error);
      console.error('❌ [CPP-DOCKER] Error details:', {
        message: error.message,
        stack: error.stack,
        tempFile: tempFile,
        testCaseCount: testCaseCount
      });
      
      // Clean up container on error
      if (container) {
        try {
          console.log('🧹 [CPP-DOCKER] Cleaning up container after error...');
          await container.remove();
          console.log('🧹 [CPP-DOCKER] Container cleaned up after error');
        } catch (cleanupError) {
          console.warn('⚠️ [CPP-DOCKER] Failed to cleanup container after error:', cleanupError);
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

function parseCppOutput(output: string, expectedTestCount: number): string[] {
  console.log('🔍 [CPP-PARSE] Parsing output for', expectedTestCount, 'test cases');
  console.log('🔍 [CPP-PARSE] Output length:', output.length);
  console.log('🔍 [CPP-PARSE] Output preview:', output.substring(output.length - 500));
  
  // Find and log the execution section
  const runningIndex = output.indexOf('=== Running ===');
  if (runningIndex !== -1) {
    const executionOutput = output.substring(runningIndex);
    console.log('🔍 [CPP-PARSE] Execution section:', executionOutput.substring(0, 200));
    const executionLines = executionOutput.split('\n');
    console.log('🔍 [CPP-PARSE] Execution lines:', executionLines.slice(0, 10));
  }
  
  const lines = output.trim().split('\n');
  const results: string[] = [];
  
  // Search for TEST_X patterns that are actual execution results (not source code)
  for (let i = 1; i <= expectedTestCount; i++) {
    const testPattern = `TEST_${i}:`;
    let found = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      // Look for lines that start with TEST_X: and don't contain C++ code patterns
      if (trimmedLine.startsWith(testPattern) && 
          !trimmedLine.includes('cout <<') && 
          !trimmedLine.includes('resultStr') &&
          !trimmedLine.includes('endl')) {
        const result = trimmedLine.substring(testPattern.length);
        results.push(result);
        console.log(`🔍 [CPP-PARSE] Found execution result: ${testPattern}${result}`);
        found = true;
        break;
      }
    }
    
    if (!found) {
      console.log(`❌ [CPP-PARSE] Missing execution result for ${testPattern}`);
      // Try to find it in a different way - look for the pattern after "=== Running ==="
      const runningIndex = output.indexOf('=== Running ===');
      if (runningIndex !== -1) {
        const executionOutput = output.substring(runningIndex);
        const executionLines = executionOutput.split('\n');
        console.log(`🔍 [CPP-PARSE] Searching execution lines for ${testPattern}:`, executionLines);
        for (const execLine of executionLines) {
          const trimmedExecLine = execLine.trim();
          if (trimmedExecLine.startsWith(testPattern)) {
            const result = trimmedExecLine.substring(testPattern.length);
            results.push(result);
            console.log(`🔍 [CPP-PARSE] Found in execution section: ${testPattern}${result}`);
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
              console.log(`🔍 [CPP-PARSE] Found standalone result for ${testPattern}: ${line}`);
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
  
  console.log('🔍 [CPP-PARSE] Final parsed results:', results);
  return results;
}

async function pullDockerImage(imageName: string): Promise<void> {
  try {
    const image = docker.getImage(imageName);
    await image.inspect();
    console.log('✅ [CPP] Docker image already exists:', imageName);
  } catch (error) {
    console.log('📥 [CPP] Pulling Docker image:', imageName);
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
            console.log('✅ [CPP] Docker image pulled successfully:', imageName);
            resolve();
          }
        });
      });
    });
  }
}
