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
  
  try {
    // Find Java code stub
    const stub = problem.codeStubs.find(s => s.language === 'JAVA');
    if (!stub) {
      throw new Error('Java code stub not found');
    }

    // Extract function name from userSnippet
    const functionName = extractFunctionName(stub.userSnippet);
    console.log('🔍 [JAVA] Extracted function name:', functionName);

    // Generate complete code with test runner
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

    // Create temporary file
    const tempFile = join(tmpdir(), `Solution_${uuidv4()}.java`);
    await writeFile(tempFile, completeCode, 'utf8');
    console.log('💾 [JAVA] Created temp file:', tempFile);
    console.log('💾 [JAVA] File size:', completeCode.length, 'bytes');
    console.log('💾 [JAVA] File exists:', require('fs').existsSync(tempFile));

    // Execute in Docker container
    const result = await executeJavaInDocker(tempFile, problem.testcases.length);
    console.log('✅ [JAVA] Execution completed');

    // Clean up temp file
    try {
      await unlink(tempFile);
    } catch (cleanupError) {
      console.warn('⚠️ [JAVA] Failed to cleanup temp file:', cleanupError);
    }

    return result;
  } catch (error: any) {
    console.error('❌ [JAVA]"""""" Execution faileds:', error);
    throw error;
  }
}

function extractFunctionName(userSnippet: string): string {
  // Extract function name from patterns like:
  // "public boolean isValid(String s) {" -> "isValid"
  // "public int maxSubArray(int[] nums) {" -> "maxSubArray"
  const functionMatch = userSnippet.match(/public\s+\w+\s+(\w+)\s*\(/);
  if (!functionMatch) {
    throw new Error('Could not extract function name from userSnippet');
  }
  return functionMatch[1];
}

function generateJavaCode(stub: any, userCode: string, testcases: any[], functionName: string): string {
  const startSnippet = stub.startSnippet || '';
  const endSnippet = stub.endSnippet || '';
  
  // Add necessary imports
  const imports = `import java.util.*;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

`;
  
  // Combine the code
  const solutionCode = `${imports}${startSnippet}\n${userCode}\n${endSnippet}`;
  
  // Generate test runner
  const testRunner = generateJavaTestRunner(testcases, functionName);
  
  return `${solutionCode}\n\n${testRunner}`;
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
  return new Promise(async (resolve, reject) => {
    try {
      // Pull Java Docker image if not exists
      await pullDockerImage('openjdk:11-jdk-slim');
      
      // Create container
      const container = await docker.createContainer({
        Image: 'openjdk:11-jdk-slim',
        Cmd: ['sh', '-c', 'echo "=== Copying file ===" && cp /tmp/source.java /app/Solution.java && echo "=== Current directory ===" && pwd && echo "=== Listing /app ===" && ls -la /app && echo "=== File content ===" && cat /app/Solution.java && echo "=== Compiling ===" && cd /app && javac Solution.java && echo "=== Running ===" && java Solution'],
        HostConfig: {
          Binds: [`${tempFile}:/tmp/source.java:ro`],
          Memory: 512 * 1024 * 1024, // 512MB memory limit
          MemorySwap: 0,
          CpuPeriod: 100000,
          CpuQuota: 50000, // 50% CPU limit
          NetworkMode: 'none', // No network access
          SecurityOpt: ['no-new-privileges'],
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=100m'
          }
        },
        WorkingDir: '/app',
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: false,
        StdinOnce: false
      });

      console.log('🐳 [JAVA] Created Docker container:', container.id);

      // Start container
      await container.start();
      console.log('🚀 [JAVA] Started container');
      
      // Log the actual file content that will be in the container
      console.log('📁 [JAVA] File content to be copied:');
      const fileContent = await require('fs').readFileSync(tempFile, 'utf8');
      console.log('📁 [JAVA] File size in container:', fileContent.length, 'bytes');
      console.log('📁 [JAVA] First 10 lines in container:');
      fileContent.split('\n').slice(0, 10).forEach((line, i) => {
        console.log(`    ${i + 1}: ${line}`);
      });



      // Get output stream
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 100
      });

      let stdout = '';
      let stderr = '';
      let hasOutput = false;

      // Set timeout for execution
      const timeout = setTimeout(async () => {
        console.log('⏰ [JAVA] Execution timeout, killing container');
        try {
          await container.kill();
        } catch (killError) {
          console.warn('⚠️ [JAVA] Failed to kill container:', killError);
        }
        reject(new Error('Execution timeout (10 seconds)'));
      }, 10000);

      // Process output stream
      if (stream && typeof stream.on === 'function') {
        stream.on('data', (chunk: Buffer) => {
          const data = chunk.toString('utf8');
          hasOutput = true;
          
          // Remove Docker log headers (8-byte headers)
          const cleanData = removeDockerHeaders(data);
          
          if (cleanData) {
            stdout += cleanData;
          }
        });

        stream.on('end', async () => {
          clearTimeout(timeout);
          
          try {
            // Get container info
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [JAVA] Container exit code:', exitCode);
            console.log('📤 [JAVA] Stdout:', stdout);
            console.log('📤 [JAVA] Stderr:', stderr);

            // Clean up container
            await container.remove();
            console.log('🧹 [JAVA] Container removed');

            if (exitCode === 0) {
              // Parse test results
              const results = parseJavaOutput(stdout, testCaseCount);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              // Handle compilation or execution errors
              const errorMessage = stderr || 'Execution failed with non-zero exit code';
              reject(new Error(errorMessage));
            }
          } catch (cleanupError) {
            console.error('❌ [JAVA] Cleanup error:', cleanupError);
            reject(cleanupError);
          }
        });

        stream.on('error', (error) => {
          clearTimeout(timeout);
          console.error('❌ [JAVA] Stream error:', error);
          reject(error);
        });
      } else {
        // Fallback: wait for container to finish and get logs
        setTimeout(async () => {
          clearTimeout(timeout);
          try {
            const logs = await container.logs({ stdout: true, stderr: true });
            const containerInfo = await container.inspect();
            const exitCode = containerInfo.State.ExitCode;
            
            console.log('📊 [JAVA] Container exit code:', exitCode);
            console.log('📤 [JAVA] Logs:', logs.toString());

            await container.remove();
            console.log('🧹 [JAVA] Container removed');

            if (exitCode === 0) {
              const results = parseJavaOutput(logs.toString(), testCaseCount);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              reject(new Error('Execution failed with non-zero exit code'));
            }
          } catch (error) {
            console.error('❌ [JAVA] Fallback error:', error);
            reject(error);
          }
        }, 5000);
      }

    } catch (error) {
      console.error('❌ [JAVA] Docker execution error:', error);
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
