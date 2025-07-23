import Docker from 'dockerode';
import { spawn } from 'child_process';
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

export async function runPython(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('🐍 [PYTHON] Starting Python execution...');
  
  try {
    // Find Python code stub
    const stub = problem.codeStubs.find(s => s.language === 'PYTHON');
    if (!stub) {
      throw new Error('Python code stub not found');
    }

    // Extract function name from userSnippet
    const functionName = extractFunctionName(stub.userSnippet);
    console.log('🔍 [PYTHON] Extracted function name:', functionName);

    // Generate complete code with test runner
    const completeCode = generatePythonCode(stub, userCode, problem.testcases, functionName);
    console.log('📝 [PYTHON] Generated complete code');

    // Create temporary file
    const tempFile = join(tmpdir(), `python_${uuidv4()}.py`);
    await writeFile(tempFile, completeCode, 'utf8');
    console.log('💾 [PYTHON] Created temp file:', tempFile);

    // Execute in Docker container
    const result = await executePythonInDocker(tempFile, problem.testcases.length);
    console.log('✅ [PYTHON] Execution completed');

    // Clean up temp file
    try {
      await unlink(tempFile);
    } catch (cleanupError) {
      console.warn('⚠️ [PYTHON] Failed to cleanup temp file:', cleanupError);
    }

    return result;
  } catch (error: any) {
    console.error('❌ [PYTHON] Execution failed:', error);
    throw error;
  }
}

function extractFunctionName(userSnippet: string): string {
  // Extract function name from patterns like:
  // "def isValid(self, s):" -> "isValid"
  // "def maxSubArray(self, nums):" -> "maxSubArray"
  const functionMatch = userSnippet.match(/def\s+(\w+)\s*\(/);
  if (!functionMatch) {
    throw new Error('Could not extract function name from userSnippet');
  }
  return functionMatch[1];
}

function generatePythonCode(stub: any, userCode: string, testcases: any[], functionName: string): string {
  const startSnippet = stub.startSnippet || '';
  const endSnippet = stub.endSnippet || '';
  
  // Combine the code
  const solutionCode = `${startSnippet}\n${userCode}\n${endSnippet}`;
  
  // Generate test runner
  const testRunner = generatePythonTestRunner(testcases, functionName);
  
  return `${solutionCode}\n\n${testRunner}`;
}

function generatePythonTestRunner(testcases: any[], functionName: string): string {
  let testRunner = `
# Test Runner
if __name__ == "__main__":
    solution = Solution()
    test_cases = [
`;

  // Add test cases
  testcases.forEach((testcase, index) => {
    const input = testcase.input;
    const expectedOutput = testcase.output;
    
    testRunner += `        (${input}, ${expectedOutput}),  # Test case ${index + 1}\n`;
  });

  testRunner += `    ]
    
    for i, (input_data, expected) in enumerate(test_cases, 1):
        try:
            result = solution.${functionName}(input_data)
            # Convert result to string for comparison
            result_str = str(result).lower() if isinstance(result, bool) else str(result)
            expected_str = str(expected).lower() if isinstance(expected, bool) else str(expected)
            
            print(f"TEST_{i}:{result_str}")
        except Exception as e:
            print(f"TEST_{i}:ERROR:{str(e)}")
`;

  return testRunner;
}

async function executePythonInDocker(tempFile: string, testCaseCount: number): Promise<ExecutionResponse> {
  return new Promise(async (resolve, reject) => {
    try {
      // Pull Python Docker image if not exists
      await pullDockerImage('python:3.9-slim');
      
      // Create container
      const container = await docker.createContainer({
        Image: 'python:3.9-slim',
        Cmd: ['python', '/app/solution.py'],
        HostConfig: {
          Binds: [`${tempFile}:/app/solution.py:ro`],
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

      console.log('🐳 [PYTHON] Created Docker container:', container.id);

      // Start container
      await container.start();
      console.log('🚀 [PYTHON] Started container');

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
        console.log('⏰ [PYTHON] Execution timeout, killing container');
        try {
          await container.kill();
        } catch (killError) {
          console.warn('⚠️ [PYTHON] Failed to kill container:', killError);
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
            
            console.log('📊 [PYTHON] Container exit code:', exitCode);
            console.log('📤 [PYTHON] Stdout:', stdout);
            console.log('📤 [PYTHON] Stderr:', stderr);

            // Clean up container
            await container.remove();
            console.log('🧹 [PYTHON] Container removed');

            if (exitCode === 0) {
              // Parse test results
              const results = parsePythonOutput(stdout, testCaseCount);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              // Handle execution errors
              const errorMessage = stderr || 'Execution failed with non-zero exit code';
              reject(new Error(errorMessage));
            }
          } catch (cleanupError) {
            console.error('❌ [PYTHON] Cleanup error:', cleanupError);
            reject(cleanupError);
          }
        });

        stream.on('error', (error) => {
          clearTimeout(timeout);
          console.error('❌ [PYTHON] Stream error:', error);
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
            
            console.log('📊 [PYTHON] Container exit code:', exitCode);
            console.log('📤 [PYTHON] Logs:', logs.toString());

            await container.remove();
            console.log('🧹 [PYTHON] Container removed');

            if (exitCode === 0) {
              const results = parsePythonOutput(logs.toString(), testCaseCount);
              resolve({
                output: results.join('\n'),
                status: 'success'
              });
            } else {
              reject(new Error('Execution failed with non-zero exit code'));
            }
          } catch (error) {
            console.error('❌ [PYTHON] Fallback error:', error);
            reject(error);
          }
        }, 5000);
      }

    } catch (error) {
      console.error('❌ [PYTHON] Docker execution error:', error);
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

function parsePythonOutput(output: string, expectedTestCount: number): string[] {
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
