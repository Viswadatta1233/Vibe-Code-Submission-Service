import Docker from 'dockerode';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { Problem, ExecutionResponse } from '../types';

const docker = new Docker();

interface TestResult {
  testcase: any;
  output: string;
  passed: boolean;
  error?: string;
}

export async function runJava(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('☕ [JAVA] Starting Java execution...');
  console.log('📊 [JAVA] Input validation:');
  console.log('  - Problem title:', problem.title);
  console.log('  - User code length:', userCode.length);
  console.log('  - Test cases count:', problem.testcases.length);
  console.log('  - Available code stubs:', problem.codeStubs.map(s => s.language));
  
  let tempFile: string | null = null;
  
  try {
    // Find Java code stub
    console.log('📋 [JAVA] Looking for Java code stub...');
    const stub = problem.codeStubs.find(s => s.language === 'JAVA');
    if (!stub) {
      console.error('❌ [JAVA] Java code stub not found in problem');
      console.error('❌ [JAVA] Available stubs:', problem.codeStubs.map(s => s.language));
      throw new Error('Java code stub not found');
    }
    console.log('📋 [JAVA] Found Java stub');
    console.log('📋 [JAVA] Stub details:');
    console.log('  - Start snippet length:', stub.startSnippet?.length || 0);
    console.log('  - End snippet length:', stub.endSnippet?.length || 0);
    console.log('  - User snippet length:', stub.userSnippet?.length || 0);

    // Extract function name from userSnippet
    console.log('🔍 [JAVA] Extracting function name from userSnippet...');
    console.log('🔍 [JAVA] UserSnippet:', stub.userSnippet);
    const functionName = extractFunctionName(stub.userSnippet);
    console.log('🔍 [JAVA] Extracted function name:', functionName);

    // Generate complete code with test runner
    console.log('📝 [JAVA] Generating complete code...');
    console.log('📝 [JAVA] Input for code generation:');
    console.log('  - User code length:', userCode.length);
    console.log('  - Test cases count:', problem.testcases.length);
    console.log('  - Function name:', functionName);
    
    const completeCode = generateJavaCode(stub, userCode, problem.testcases, functionName);
    console.log('📝 [JAVA] Generated complete code');
    console.log('📝 [JAVA] Code preview (first 500 chars):', completeCode.substring(0, 500));
    console.log('📝 [JAVA] Code preview (last 500 chars):', completeCode.substring(completeCode.length - 500));
    console.log('📝 [JAVA] Total code length:', completeCode.length, 'characters');
    console.log('📝 [JAVA] Number of lines:', completeCode.split('\n').length);
    
    // Log code structure
    const lines = completeCode.split('\n');
    console.log('📝 [JAVA] Code structure:');
    console.log('  - Lines 1-5 (imports):', lines.slice(0, 5).join(' | '));
    console.log('  - Class declaration:', lines.find(line => line.includes('public class Solution')));
    console.log('  - Method declaration:', lines.find(line => line.includes(`public boolean ${functionName}`)));
    console.log('  - Main method:', lines.find(line => line.includes('public static void main')));
    console.log('  - Test cases count:', lines.filter(line => line.includes('TEST_')).length);
    
    // Validate generated code
    console.log('🔍 [JAVA] Validating generated code...');
    if (!completeCode.includes('public class Solution')) {
      console.error('❌ [JAVA] Generated code missing Solution class');
      throw new Error('Generated code missing Solution class');
    }
    if (!completeCode.includes(`public `) || !completeCode.includes(` ${functionName}(`)) {
      console.error(`❌ [JAVA] Generated code missing ${functionName} method`);
      throw new Error(`Generated code missing ${functionName} method`);
    }
    if (!completeCode.includes('public static void main')) {
      console.error('❌ [JAVA] Generated code missing main method');
      throw new Error('Generated code missing main method');
    }
    console.log('✅ [JAVA] Code validation passed');

    // Create temporary file
    console.log('💾 [JAVA] Creating temporary file...');
    const tempFile = join(tmpdir(), `Solution_${uuidv4()}.java`);
    console.log('💾 [JAVA] Temp file path:', tempFile);
    
    try {
      await writeFile(tempFile, completeCode, 'utf8');
      console.log('💾 [JAVA] File written successfully');
    } catch (writeError) {
      console.error('❌ [JAVA] Failed to write temp file:', writeError);
      throw new Error(`Failed to write temp file: ${writeError}`);
    }
    
    console.log('💾 [JAVA] File size:', completeCode.length, 'bytes');
    console.log('💾 [JAVA] File exists:', require('fs').existsSync(tempFile));
    
    // Verify file content
    try {
      const writtenContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('💾 [JAVA] Written file size:', writtenContent.length, 'bytes');
      console.log('💾 [JAVA] Content matches:', writtenContent === completeCode);
    } catch (readError) {
      console.error('❌ [JAVA] Failed to read temp file for verification:', readError);
    }

    // Execute in Docker container
    console.log('🐳 [JAVA] Starting Docker execution...');
    console.log('🐳 [JAVA] Test cases count:', problem.testcases.length);
    const result = await executeJavaInDocker(tempFile, problem.testcases.length);
    console.log('✅ [JAVA] Execution completed');
    console.log('✅ [JAVA] Result status:', result.status);
    console.log('✅ [JAVA] Result output length:', result.output.length);

    // Clean up temp file
    console.log('🧹 [JAVA] Cleaning up temp file...');
    try {
      await unlink(tempFile);
      console.log('🧹 [JAVA] Temp file cleaned up successfully');
    } catch (cleanupError) {
      console.warn('⚠️ [JAVA] Failed to cleanup temp file:', cleanupError);
      console.warn('⚠️ [JAVA] Temp file path:', tempFile);
    }

    console.log('✅ [JAVA] Java execution completed successfully');
    return result;
  } catch (error: any) {
    console.error('❌ [JAVA] Execution failed with error:', error);
    console.error('❌ [JAVA] Error type:', typeof error);
    console.error('❌ [JAVA] Error message:', error.message);
    console.error('❌ [JAVA] Error stack:', error.stack);
    
    // Clean up temp file on error
    if (tempFile) {
      try {
        console.log('🧹 [JAVA] Cleaning up temp file after error...');
        await unlink(tempFile);
        console.log('🧹 [JAVA] Temp file cleaned up after error');
      } catch (cleanupError) {
        console.warn('⚠️ [JAVA] Failed to cleanup temp file after error:', cleanupError);
      }
    }
    
    throw error;
  }
}

function extractFunctionName(userSnippet: string): string {
  console.log('🔍 [JAVA-EXTRACT] Extracting function name from:', userSnippet);
  
  // Extract function name from patterns like:
  // "public boolean isValid(String s) {" -> "isValid"
  // "public int maxSubArray(int[] nums) {" -> "maxSubArray"
  const functionMatch = userSnippet.match(/public\s+\w+\s+(\w+)\s*\(/);
  if (!functionMatch) {
    console.error('❌ [JAVA-EXTRACT] Could not extract function name from userSnippet');
    console.error('❌ [JAVA-EXTRACT] UserSnippet:', userSnippet);
    throw new Error('Could not extract function name from userSnippet');
  }
  
  const functionName = functionMatch[1];
  console.log('✅ [JAVA-EXTRACT] Extracted function name:', functionName);
  return functionName;
}

function generateJavaCode(stub: any, userCode: string, testcases: any[], functionName: string): string {
  console.log('📝 [JAVA-GENERATE] Generating Java code...');
  console.log('📝 [JAVA-GENERATE] Input parameters:');
  console.log('  - Start snippet length:', stub.startSnippet?.length || 0);
  console.log('  - User code length:', userCode.length);
  console.log('  - End snippet length:', stub.endSnippet?.length || 0);
  console.log('  - Test cases count:', testcases.length);
  console.log('  - Function name:', functionName);
  
  const startSnippet = stub.startSnippet || '';
  const endSnippet = stub.endSnippet || '';
  
  // Add necessary imports
  const imports = `import java.util.*;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

`;
  
  // Generate test runner
  console.log('📝 [JAVA-GENERATE] Generating test runner...');
  const testRunner = generateJavaTestRunner(testcases, functionName, userCode);
  console.log('📝 [JAVA-GENERATE] Test runner length:', testRunner.length);
  
  // Combine the code with test runner INSIDE the class (before endSnippet)
  const completeCode = `${imports}${startSnippet}
    ${userCode}

${testRunner}
${endSnippet}`;
  
  console.log('📝 [JAVA-GENERATE] Complete code length:', completeCode.length);
  console.log('✅ [JAVA-GENERATE] Code generation completed');
  
  return completeCode;
}

function generateJavaTestRunner(testcases: any[], functionName: string, userCode: string): string {
  // Extract parameter type from method signature
  const parameterType = extractParameterType(userCode, functionName);
  console.log('🔍 [JAVA-TESTGEN] Detected parameter type:', parameterType);
  
  let testRunner = `    public static void main(String[] args) {
        Solution solution = new Solution();
        
`;

  // Add individual test cases
  testcases.forEach((testcase, index) => {
    const input = testcase.input;
    const expectedOutput = testcase.output;
    
    testRunner += `        // Test case ${index + 1}
        try {
            String rawInput${index + 1} = "${input}";
            String expected${index + 1} = "${expectedOutput}";
            Object result${index + 1} = null;
            
`;

    // Generate different input parsing based on parameter type
    if (parameterType === 'String') {
      testRunner += `            // String parameter
            String cleanInput = rawInput${index + 1}.replaceAll("\\"", "");
            result${index + 1} = solution.${functionName}(cleanInput);
`;
    } else if (parameterType === 'int') {
      testRunner += `            // Integer parameter
            int intInput = Integer.parseInt(rawInput${index + 1});
            result${index + 1} = solution.${functionName}(intInput);
`;
    } else if (parameterType === 'int[]') {
      testRunner += `            // Integer array parameter
            int[] arrayInput = null;
            if (rawInput${index + 1}.equals("[]")) {
                arrayInput = new int[0];
            } else {
                String arrayStr = rawInput${index + 1}.substring(1, rawInput${index + 1}.length() - 1);
                String[] parts = arrayStr.split(",");
                arrayInput = new int[parts.length];
                for (int j = 0; j < parts.length; j++) {
                    arrayInput[j] = Integer.parseInt(parts[j].trim());
                }
            }
            result${index + 1} = solution.${functionName}(arrayInput);
`;
    } else {
      // Fallback to string
      testRunner += `            // Fallback to string parameter
            String cleanInput = rawInput${index + 1}.replaceAll("\\"", "");
            result${index + 1} = solution.${functionName}(cleanInput);
`;
    }

    testRunner += `            
            // Convert result to string for comparison
            String resultStr = String.valueOf(result${index + 1}).toLowerCase();
            String expectedStr = expected${index + 1}.toLowerCase();
            
            System.out.println("TEST_${index + 1}:" + resultStr);
            
        } catch (Exception e) {
            System.out.println("TEST_${index + 1}:ERROR:" + e.getMessage());
        }
        
`;
  });

  testRunner += `    }`;

  return testRunner;
}

function extractParameterType(userCode: string, functionName: string): string {
  console.log('🔍 [JAVA-EXTRACT] Extracting parameter type for function:', functionName);
  console.log('🔍 [JAVA-EXTRACT] User code snippet:', userCode.substring(0, 200) + '...');
  
  // Look for the method signature pattern
  const methodPattern = new RegExp(`public\\s+\\w+\\s+${functionName}\\s*\\(([^)]+)\\)`, 'i');
  const match = userCode.match(methodPattern);
  
  if (match && match[1]) {
    const parameters = match[1].trim();
    console.log('🔍 [JAVA-EXTRACT] Found parameters:', parameters);
    
    // Extract the type (first word before parameter name)
    if (parameters.includes('int[]')) {
      console.log('🔍 [JAVA-EXTRACT] Detected type: int[]');
      return 'int[]';
    } else if (parameters.includes('String')) {
      console.log('🔍 [JAVA-EXTRACT] Detected type: String');
      return 'String';
    } else if (parameters.includes('int ')) {
      console.log('🔍 [JAVA-EXTRACT] Detected type: int');
      return 'int';
    } else if (parameters.includes('boolean')) {
      console.log('🔍 [JAVA-EXTRACT] Detected type: boolean');
      return 'boolean';
    } else if (parameters.includes('double')) {
      console.log('🔍 [JAVA-EXTRACT] Detected type: double');
      return 'double';
    }
  }
  
  console.log('🔍 [JAVA-EXTRACT] No match found, defaulting to String');
  return 'String';
}

async function executeJavaInDocker(tempFile: string, testCaseCount: number): Promise<ExecutionResponse> {
  console.log('🐳 [JAVA-DOCKER] Starting Docker execution...');
  console.log('🐳 [JAVA-DOCKER] Input parameters:');
  console.log('  - Temp file:', tempFile);
  console.log('  - Test case count:', testCaseCount);
  console.log('  - Temp file exists:', require('fs').existsSync(tempFile));
  
  return new Promise(async (resolve, reject) => {
    let container: any = null;
    
    try {
      // Pull Java Docker image if not exists
      console.log('🐳 [JAVA-DOCKER] Pulling Docker image...');
      await pullDockerImage('openjdk:11-jdk-slim');
      console.log('✅ [JAVA-DOCKER] Docker image ready');
      
      // Use STDIN/pipe approach - much simpler and more reliable
      console.log('📁 [JAVA-DOCKER] Using STDIN/pipe approach...');
      
      console.log('📁 [JAVA-DOCKER] Source file:', tempFile);
      console.log('📁 [JAVA-DOCKER] Source file exists:', require('fs').existsSync(tempFile));
      
      // Create container with STDIN enabled
      console.log('🐳 [JAVA-DOCKER] Creating container with STDIN...');
      const container = await docker.createContainer({
        Image: 'openjdk:11-jdk-slim',
        Cmd: [
          'sh', '-c', 
          'echo "=== Receiving file via STDIN ===" && ' +
          'cat > /app/Solution.java && ' +
          'echo "=== File received ===" && ' +
          'echo "=== Listing /app ===" && ls -la /app && ' +
          'echo "=== File content ===" && cat /app/Solution.java && ' +
          'echo "=== Compiling ===" && cd /app && javac Solution.java && ' +
          'echo "=== Running ===" && java Solution'
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
      
      console.log('🐳 [JAVA-DOCKER] Created container with STDIN:', container.id);
      
      // Start the container
      await container.start();
      console.log('🚀 [JAVA-DOCKER] Container started with STDIN');
      
      // Attach to container and send file content via STDIN
      console.log('📁 [JAVA-DOCKER] Attaching to container...');
      const attachStream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true
      });
      
      // Send file content via STDIN
      console.log('📁 [JAVA-DOCKER] Sending file content via STDIN...');
      const javaSourceContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('📁 [JAVA-DOCKER] File content length:', javaSourceContent.length, 'characters');
      
      attachStream.write(javaSourceContent);
      attachStream.end();
      console.log('✅ [JAVA-DOCKER] File content sent via STDIN');
      
      // Log the file content that was copied
      console.log('📁 [JAVA-DOCKER] File content that was copied:');
      const fileContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('📁 [JAVA-DOCKER] File size:', fileContent.length, 'bytes');
      console.log('📁 [JAVA-DOCKER] First 10 lines:');
      fileContent.split('\n').slice(0, 10).forEach((line, i) => {
        console.log(`    ${i + 1}: ${line}`);
      });



      // Get output stream
      console.log('📤 [JAVA-DOCKER] Getting container logs stream...');
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 100
      });
      console.log('📤 [JAVA-DOCKER] Log stream obtained');

      let stdout = '';
      let stderr = '';
      let hasOutput = false;

      // Set timeout for execution
      console.log('⏰ [JAVA-DOCKER] Setting execution timeout (10 seconds)...');
      const timeout = setTimeout(async () => {
        console.log('⏰ [JAVA-DOCKER] Execution timeout, killing container');
        try {
          await container.kill();
          console.log('⏰ [JAVA-DOCKER] Container killed due to timeout');
        } catch (killError) {
          console.warn('⚠️ [JAVA-DOCKER] Failed to kill container:', killError);
        }
        reject(new Error('Execution timeout (10 seconds)'));
      }, 10000);

      // Process output stream
      console.log('📤 [JAVA-DOCKER] Processing output stream...');
      if (stream && typeof stream.on === 'function') {
        console.log('📤 [JAVA-DOCKER] Stream is valid, setting up event handlers');
        
        stream.on('data', (chunk: Buffer) => {
          hasOutput = true;
          console.log('📤 [JAVA-DOCKER] Received chunk:', chunk.length, 'bytes');
          
          // Parse Docker log format properly
          const cleanData = parseDockerLogChunk(chunk);
          
          if (cleanData) {
            stdout += cleanData;
            console.log('📤 [JAVA-DOCKER] Clean data added to stdout');
          } else {
            console.log('📤 [JAVA-DOCKER] No clean data from chunk');
          }
        });

        stream.on('end', async () => {
          console.log('📤 [JAVA-DOCKER] Stream ended');
          clearTimeout(timeout);
          
          try {
            // Get container info
            console.log('📊 [JAVA-DOCKER] Getting container info...');
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [JAVA-DOCKER] Container exit code:', exitCode);
            console.log('📤 [JAVA-DOCKER] Stdout length:', stdout.length);
            console.log('📤 [JAVA-DOCKER] Stdout:', stdout);
            console.log('📤 [JAVA-DOCKER] Stderr length:', stderr.length);
            console.log('📤 [JAVA-DOCKER] Stderr:', stderr);

            // Clean up container
            console.log('🧹 [JAVA-DOCKER] Removing container...');
            await container.remove();
            console.log('🧹 [JAVA-DOCKER] Container removed');

            if (exitCode === 0) {
              console.log('✅ [JAVA-DOCKER] Container exited successfully');
              // Parse test results
              console.log('🔍 [JAVA-DOCKER] Parsing test results...');
              const results = parseJavaOutput(stdout, testCaseCount);
              console.log('🔍 [JAVA-DOCKER] Parsed results:', results);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              console.log('❌ [JAVA-DOCKER] Container exited with error code:', exitCode);
              // Handle compilation or execution errors
              const errorMessage = stderr || 'Execution failed with non-zero exit code';
              console.log('❌ [JAVA-DOCKER] Error message:', errorMessage);
              reject(new Error(errorMessage));
            }
          } catch (cleanupError) {
            console.error('❌ [JAVA-DOCKER] Cleanup error:', cleanupError);
            console.error('❌ [JAVA-DOCKER] Cleanup error details:', {
              message: cleanupError.message,
              stack: cleanupError.stack
            });
            reject(cleanupError);
          }
        });

        stream.on('error', (error) => {
          clearTimeout(timeout);
          console.error('❌ [JAVA-DOCKER] Stream error:', error);
          console.error('❌ [JAVA-DOCKER] Stream error details:', {
            message: error.message,
            stack: error.stack
          });
          reject(error);
        });
      } else {
        console.log('⚠️ [JAVA-DOCKER] Invalid stream, using fallback method...');
        // Fallback: wait for container to finish and get logs
        setTimeout(async () => {
          clearTimeout(timeout);
          try {
            console.log('📤 [JAVA-DOCKER] Fallback: Getting container logs...');
            const logs = await container.logs({ stdout: true, stderr: true });
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [JAVA-DOCKER] Fallback: Container exit code:', exitCode);
            console.log('📤 [JAVA-DOCKER] Fallback: Logs length:', logs.length);
            console.log('📤 [JAVA-DOCKER] Fallback: Logs:', logs.toString());

            await container.remove();
            console.log('🧹 [JAVA-DOCKER] Fallback: Container removed');

            if (exitCode === 0) {
              console.log('✅ [JAVA-DOCKER] Fallback: Container exited successfully');
              const results = parseJavaOutput(logs.toString(), testCaseCount);
              console.log('🔍 [JAVA-DOCKER] Fallback: Parsed results:', results);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              console.log('❌ [JAVA-DOCKER] Fallback: Container exited with error');
              reject(new Error('Execution failed with non-zero exit code'));
            }
          } catch (error) {
            console.error('❌ [JAVA-DOCKER] Fallback error:', error);
            console.error('❌ [JAVA-DOCKER] Fallback error details:', {
              message: error.message,
              stack: error.stack
            });
            reject(error);
          }
        }, 5000);
      }

    } catch (error) {
      console.error('❌ [JAVA-DOCKER] Docker execution error:', error);
      console.error('❌ [JAVA-DOCKER] Error details:', {
        message: error.message,
        stack: error.stack,
        tempFile: tempFile,
        testCaseCount: testCaseCount
      });
      
      // Clean up container on error
      if (container) {
        try {
          console.log('🧹 [JAVA-DOCKER] Cleaning up container after error...');
          await container.remove();
          console.log('🧹 [JAVA-DOCKER] Container cleaned up after error');
        } catch (cleanupError) {
          console.warn('⚠️ [JAVA-DOCKER] Failed to cleanup container after error:', cleanupError);
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

function parseJavaOutput(output: string, expectedTestCount: number): string[] {
  console.log('🔍 [JAVA-PARSE] Parsing output for', expectedTestCount, 'test cases');
  console.log('🔍 [JAVA-PARSE] Output length:', output.length);
  console.log('🔍 [JAVA-PARSE] Output preview:', output.substring(output.length - 500));
  
  // Find and log the execution section
  const runningIndex = output.indexOf('=== Running ===');
  if (runningIndex !== -1) {
    const executionOutput = output.substring(runningIndex);
    console.log('🔍 [JAVA-PARSE] Execution section:', executionOutput.substring(0, 200));
    const executionLines = executionOutput.split('\n');
    console.log('🔍 [JAVA-PARSE] Execution lines:', executionLines.slice(0, 10));
  }
  
  const lines = output.trim().split('\n');
  const results: string[] = [];
  
  // Search for TEST_X patterns that are actual execution results (not source code)
  for (let i = 1; i <= expectedTestCount; i++) {
    const testPattern = `TEST_${i}:`;
    let found = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      // Look for lines that start with TEST_X: and don't contain Java code patterns
      if (trimmedLine.startsWith(testPattern) && 
          !trimmedLine.includes('" + ') && 
          !trimmedLine.includes('System.out.println') &&
          !trimmedLine.includes('resultStr')) {
        const result = trimmedLine.substring(testPattern.length);
        results.push(result);
        console.log(`🔍 [JAVA-PARSE] Found execution result: ${testPattern}${result}`);
        found = true;
        break;
      }
    }
    
          if (!found) {
        console.log(`❌ [JAVA-PARSE] Missing execution result for ${testPattern}`);
        // Try to find it in a different way - look for the pattern after "=== Running ==="
        const runningIndex = output.indexOf('=== Running ===');
        if (runningIndex !== -1) {
          const executionOutput = output.substring(runningIndex);
          const executionLines = executionOutput.split('\n');
          console.log(`🔍 [JAVA-PARSE] Searching execution lines for ${testPattern}:`, executionLines);
          for (const execLine of executionLines) {
            const trimmedExecLine = execLine.trim();
            if (trimmedExecLine.startsWith(testPattern)) {
              const result = trimmedExecLine.substring(testPattern.length);
              results.push(result);
              console.log(`🔍 [JAVA-PARSE] Found in execution section: ${testPattern}${result}`);
              found = true;
              break;
            }
          }
        }
        
        // Last resort: check if there's a standalone number that could be the result
        if (!found && i === expectedTestCount) {
          const runningIndex = output.indexOf('=== Running ===');
          if (runningIndex !== -1) {
            const executionOutput = output.substring(runningIndex);
            const lines = executionOutput.split('\n');
            // Look for the last non-empty line that's just a number
            for (let j = lines.length - 1; j >= 0; j--) {
              const line = lines[j].trim();
              if (line && /^\d+$/.test(line)) {
                console.log(`🔍 [JAVA-PARSE] Found standalone number for ${testPattern}: ${line}`);
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
  
  console.log('🔍 [JAVA-PARSE] Final parsed results:', results);
  return results;
}

async function pullDockerImage(imageName: string): Promise<void> {
  try {
    const image = docker.getImage(imageName);
    await image.inspect();
    console.log('✅ [JAVA] Docker image already exists:', imageName);
  } catch (error) {
    console.log('📥 [JAVA] Pulling Docker image:', imageName);
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
            console.log('✅ [JAVA] Docker image pulled successfully:', imageName);
            resolve();
          }
        });
      });
    });
  }
}
