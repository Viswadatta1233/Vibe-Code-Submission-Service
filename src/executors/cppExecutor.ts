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

export async function runCpp(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('⚡ [CPP] Starting C++ execution...');
  
  try {
    // Find C++ code stub
    const stub = problem.codeStubs.find(s => s.language === 'CPP');
    if (!stub) {
      throw new Error('C++ code stub not found');
    }

    // Extract function name from userSnippet
    const functionName = extractFunctionName(stub.userSnippet);
    console.log('🔍 [CPP] Extracted function name:', functionName);

    // Generate complete code with test runner
    const completeCode = generateCppCode(stub, userCode, problem.testcases, functionName);
    console.log('📝 [CPP] Generated complete code');

    // Create temporary file
    const tempFile = join(tmpdir(), `solution_${uuidv4()}.cpp`);
    await writeFile(tempFile, completeCode, 'utf8');
    console.log('💾 [CPP] Created temp file:', tempFile);

    // Execute in Docker container
    const result = await executeCppInDocker(tempFile, problem.testcases.length);
    console.log('✅ [CPP] Execution completed');

    // Clean up temp file
    try {
      await unlink(tempFile);
    } catch (cleanupError) {
      console.warn('⚠️ [CPP] Failed to cleanup temp file:', cleanupError);
    }

    return result;
  } catch (error: any) {
    console.error('❌ [CPP] Execution failed:', error);
    throw error;
  }
}

function extractFunctionName(userSnippet: string): string {
  // Extract function name from patterns like:
  // "bool isValid(std::string s) {" -> "isValid"
  // "int maxSubArray(std::vector<int>& nums) {" -> "maxSubArray"
  const functionMatch = userSnippet.match(/\w+\s+(\w+)\s*\(/);
  if (!functionMatch) {
    throw new Error('Could not extract function name from userSnippet');
  }
  return functionMatch[1];
}

function generateCppCode(stub: any, userCode: string, testcases: any[], functionName: string): string {
  const startSnippet = stub.startSnippet || '';
  const endSnippet = stub.endSnippet || '';
  
  // Combine the code
  const solutionCode = `${startSnippet}\n${userCode}\n${endSnippet}`;
  
  // Generate test runner
  const testRunner = generateCppTestRunner(testcases, functionName);
  
  return `${solutionCode}\n\n${testRunner}`;
}

function generateCppTestRunner(testcases: any[], functionName: string): string {
  let testRunner = `
int main() {
    Solution solution;
    std::vector<std::pair<std::string, std::string>> testCases = {
`;

  // Add test cases
  testcases.forEach((testcase, index) => {
    const input = testcase.input;
    const expectedOutput = testcase.output;
    
    testRunner += `        {${input}, ${expectedOutput}}, // Test case ${index + 1}\n`;
  });

  testRunner += `    };
    
    for (int i = 0; i < testCases.size(); i++) {
        try {
            std::string input = testCases[i].first;
            std::string expected = testCases[i].second;
            std::string result;
            
            // Parse input based on expected type
            if (expected == "true" || expected == "false") {
                // Boolean input - remove quotes if present
                std::string cleanInput = input;
                if (cleanInput.front() == '"' && cleanInput.back() == '"') {
                    cleanInput = cleanInput.substr(1, cleanInput.length() - 2);
                }
                bool result_bool = solution.${functionName}(cleanInput);
                result = result_bool ? "true" : "false";
            } else if (std::regex_match(expected, std::regex("-?\\\\d+"))) {
                // Integer input - parse array or single value
                if (input.front() == '[' && input.back() == ']') {
                    // Array input
                    std::string arrayStr = input.substr(1, input.length() - 2);
                    std::vector<int> nums;
                    std::stringstream ss(arrayStr);
                    std::string item;
                    while (std::getline(ss, item, ',')) {
                        nums.push_back(std::stoi(item));
                    }
                    int result_int = solution.${functionName}(nums);
                    result = std::to_string(result_int);
                } else {
                    // Single integer input
                    int num = std::stoi(input);
                    int result_int = solution.${functionName}(num);
                    result = std::to_string(result_int);
                }
            } else {
                // String input - remove quotes
                std::string cleanInput = input;
                if (cleanInput.front() == '"' && cleanInput.back() == '"') {
                    cleanInput = cleanInput.substr(1, cleanInput.length() - 2);
                }
                bool result_bool = solution.${functionName}(cleanInput);
                result = result_bool ? "true" : "false";
            }
            
            std::cout << "TEST_" << (i + 1) << ":" << result << std::endl;
            
        } catch (const std::exception& e) {
            std::cout << "TEST_" << (i + 1) << ":ERROR:" << e.what() << std::endl;
        }
    }
    
    return 0;
}
`;

  return testRunner;
}

async function executeCppInDocker(tempFile: string, testCaseCount: number): Promise<ExecutionResponse> {
  return new Promise(async (resolve, reject) => {
    try {
      // Pull GCC Docker image if not exists
      await pullDockerImage('gcc:latest');
      
      // Create container
      const container = await docker.createContainer({
        Image: 'gcc:latest',
        Cmd: ['sh', '-c', 'cd /app && g++ -std=c++17 -O2 solution.cpp -o solution && ./solution'],
        HostConfig: {
          Binds: [`${tempFile}:/app/solution.cpp:ro`],
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

      console.log('🐳 [CPP] Created Docker container:', container.id);

      // Start container
      await container.start();
      console.log('🚀 [CPP] Started container');

      // Get output stream
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 'all'
      });

      let stdout = '';
      let stderr = '';
      let hasOutput = false;

      // Set timeout for execution
      const timeout = setTimeout(async () => {
        console.log('⏰ [CPP] Execution timeout, killing container');
        try {
          await container.kill();
        } catch (killError) {
          console.warn('⚠️ [CPP] Failed to kill container:', killError);
        }
        reject(new Error('Execution timeout (10 seconds)'));
      }, 10000);

      // Process output stream
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
          
          console.log('📊 [CPP] Container exit code:', exitCode);
          console.log('📤 [CPP] Stdout:', stdout);
          console.log('📤 [CPP] Stderr:', stderr);

          // Clean up container
          await container.remove();
          console.log('🧹 [CPP] Container removed');

          if (exitCode === 0) {
            // Parse test results
            const results = parseCppOutput(stdout, testCaseCount);
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
          console.error('❌ [CPP] Cleanup error:', cleanupError);
          reject(cleanupError);
        }
      });

      stream.on('error', (error) => {
        clearTimeout(timeout);
        console.error('❌ [CPP] Stream error:', error);
        reject(error);
      });

    } catch (error) {
      console.error('❌ [CPP] Docker execution error:', error);
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

function parseCppOutput(output: string, expectedTestCount: number): string[] {
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
