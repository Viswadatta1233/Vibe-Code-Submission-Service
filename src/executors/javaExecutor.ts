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
    if (!completeCode.includes(`public boolean ${functionName}`)) {
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
  
  // Combine the code
  const solutionCode = `${imports}${startSnippet}\n${userCode}\n${endSnippet}`;
  console.log('📝 [JAVA-GENERATE] Solution code length:', solutionCode.length);
  
  // Generate test runner
  console.log('📝 [JAVA-GENERATE] Generating test runner...');
  const testRunner = generateJavaTestRunner(testcases, functionName);
  console.log('📝 [JAVA-GENERATE] Test runner length:', testRunner.length);
  
  const completeCode = `${solutionCode}\n\n${testRunner}`;
  console.log('📝 [JAVA-GENERATE] Complete code length:', completeCode.length);
  console.log('✅ [JAVA-GENERATE] Code generation completed');
  
  return completeCode;
}

function generateJavaTestRunner(testcases: any[], functionName: string): string {
  let testRunner = `
    public static void main(String[] args) {
        Solution solution = new Solution();
        String[][] testCases = {
`;

  // Add test cases
  testcases.forEach((testcase, index) => {
    const input = testcase.input;
    const expectedOutput = testcase.output;
    
    testRunner += `            {${input}, ${expectedOutput}}, // Test case ${index + 1}\n`;
  });

  testRunner += `        };
        
        for (int i = 0; i < testCases.length; i++) {
            try {
                String input = testCases[i][0];
                String expected = testCases[i][1];
                Object result = null;
                
                // Parse input based on expected type
                if (expected.equals("true") || expected.equals("false")) {
                    // Boolean input - remove quotes if present
                    String cleanInput = input.replaceAll("\"", "");
                    result = solution.${functionName}(cleanInput);
                } else if (expected.matches("-?\\\\d+")) {
                    // Integer input - parse array or single value
                    if (input.startsWith("[") && input.endsWith("]")) {
                        // Array input
                        String[] parts = input.substring(1, input.length() - 1).split(",");
                        int[] nums = new int[parts.length];
                        for (int j = 0; j < parts.length; j++) {
                            nums[j] = Integer.parseInt(parts[j].trim());
                        }
                        result = solution.${functionName}(nums);
                    } else {
                        // Single integer input
                        int num = Integer.parseInt(input);
                        result = solution.${functionName}(num);
                    }
                } else {
                    // String input - remove quotes
                    String cleanInput = input.replaceAll("\"", "");
                    result = solution.${functionName}(cleanInput);
                }
                
                // Convert result to string for comparison
                String resultStr = String.valueOf(result).toLowerCase();
                String expectedStr = expected.toLowerCase();
                
                System.out.println("TEST_" + (i + 1) + ":" + resultStr);
                
            } catch (Exception e) {
                System.out.println("TEST_" + (i + 1) + ":ERROR:" + e.getMessage());
            }
        }
    }
`;

  return testRunner;
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
      
      // Use bind mount approach - mount file directly to fixed location
      console.log('📁 [JAVA-DOCKER] Using bind mount approach...');
      
      // Mount the file directly to a fixed location in container
      const containerFilePath = '/tmp/Solution.java';
      
      console.log('📁 [JAVA-DOCKER] Source file:', tempFile);
      console.log('📁 [JAVA-DOCKER] Container path:', containerFilePath);
      console.log('📁 [JAVA-DOCKER] Bind mount path:', `${tempFile}:${containerFilePath}:ro`);
      console.log('📁 [JAVA-DOCKER] Source file exists:', require('fs').existsSync(tempFile));
      
      // Create container with bind mount
      console.log('🐳 [JAVA-DOCKER] Creating container with bind mount...');
      const container = await docker.createContainer({
        Image: 'openjdk:11-jdk-slim',
        Cmd: ['sh', '-c', 'echo "=== Current directory ===" && pwd && echo "=== Listing /tmp ===" && ls -la /tmp && echo "=== Checking if file exists ===" && test -f /tmp/Solution.java && echo "File exists" || echo "File does not exist" && echo "=== Copying file ===" && cp /tmp/Solution.java /app/ && echo "=== File content ===" && cat /app/Solution.java && echo "=== Compiling ===" && cd /app && javac Solution.java && echo "=== Running ===" && java Solution'],
        HostConfig: {
          Binds: [`${tempFile}:${containerFilePath}:ro`],
          Memory: 512 * 1024 * 1024, // 512MB memory limit
          MemorySwap: 0,
          CpuPeriod: 100000,
          CpuQuota: 50000, // 50% CPU limit
          NetworkMode: 'none', // No network access
          SecurityOpt: ['no-new-privileges'],
          Tmpfs: {
            '/tmp/tmp': 'rw,noexec,nosuid,size=100m'
          }
        },
        WorkingDir: '/app',
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: false,
        StdinOnce: false
      });
      
      console.log('🐳 [JAVA-DOCKER] Created container with bind mount:', container.id);
      
      // Start the container
      await container.start();
      console.log('🚀 [JAVA-DOCKER] Container started with bind mount');
      
      console.log('✅ [JAVA-DOCKER] File copied to container');
      
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
          const data = chunk.toString('utf8');
          hasOutput = true;
          console.log('📤 [JAVA-DOCKER] Received chunk:', chunk.length, 'bytes');
          
          // Remove Docker log headers (8-byte headers)
          const cleanData = removeDockerHeaders(data);
          
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

function removeDockerHeaders(data: string): string {
  // Docker log format: [8 bytes header][payload]
  // We need to skip the 8-byte headers
  const lines = data.split('\n');
  const cleanLines = lines.map(line => {
    if (line.length >= 8) {
      return line.substring(8);
    }
    return line;
  });
  return cleanLines.join('\n');
}

function parseJavaOutput(output: string, expectedTestCount: number): string[] {
  const lines = output.trim().split('\n');
  const results: string[] = [];
  
  for (let i = 0; i < expectedTestCount; i++) {
    const line = lines[i];
    if (line && line.startsWith(`TEST_${i + 1}:`)) {
      const result = line.substring(`TEST_${i + 1}:`.length);
      results.push(result);
    } else {
      // Missing or malformed output
      results.push('');
    }
  }
  
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
