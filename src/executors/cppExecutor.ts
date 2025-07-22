import Docker from 'dockerode';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

interface TestCase {
  input: string;
  output: string;
}

interface CodeStub {
  language: string;
  startSnippet: string;
  userSnippet: string;
  endSnippet: string;
}

interface Problem {
  title: string;
  testcases: TestCase[];
  codeStubs: CodeStub[];
}

// Docker output stream demultiplexer
function demultiplexDockerLogs(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';

  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    
    // Read the 8-byte header
    const header = buffer.slice(offset, offset + 8);
    const streamType = header[0];
    const payloadSize = header.readUInt32BE(4);

    offset += 8;

    if (offset + payloadSize > buffer.length) break;

    // Read the payload
    const payload = buffer.slice(offset, offset + payloadSize);
    const payloadString = payload.toString('utf8');

    // Route to appropriate stream
    if (streamType === 1) {
      stdout += payloadString;
    } else if (streamType === 2) {
      stderr += payloadString;
    }

    offset += payloadSize;
  }

  return { stdout, stderr };
}

export class CppExecutor {
  private problem: Problem;
  private userCode: string;

  constructor(problem: Problem, userCode: string) {
    this.problem = problem;
    this.userCode = userCode;
  }

  // Generate complete C++ code with test runner
  generateCode(): string {
    const stub = this.problem.codeStubs.find(s => s.language === 'CPP');
    if (!stub) {
      throw new Error('No C++ code stub found for this problem');
    }

    // Build the complete code structure with common includes
    const includes = `// Common includes for coding problems
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <stack>
#include <queue>
#include <deque>
#include <set>
#include <map>
#include <cmath>
#include <climits>
#include <cstring>
#include <sstream>
#include <iomanip>
using namespace std;

`;
    const fullCode = includes + stub.startSnippet + '\n' + this.userCode + '\n' + stub.endSnippet;
    
    // Generate test runner
    const testRunner = this.generateTestRunner();
    
    return fullCode + '\n\n' + testRunner;
  }

  private generateTestRunner(): string {
    const methodName = this.extractMethodName();
    const testCases = this.problem.testcases.map((tc, index) => {
      return `    // Test case ${index + 1}
    auto test_input_${index + 1} = ${tc.input};
    auto expected_output_${index + 1} = ${tc.output};
    auto result_${index + 1} = sol.${methodName}(test_input_${index + 1});
    std::cout << "TEST_${index + 1}:" << result_${index + 1} << std::endl;`;
    }).join('\n');

    return `int main() {
    Solution sol;
${testCases}
    return 0;
}`;
  }

  private extractMethodName(): string {
    const stub = this.problem.codeStubs.find(s => s.language === 'CPP');
    if (!stub) return 'solve';

    const methodMatch = stub.userSnippet.match(/(?:int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+(\w+)\s*\(/);
    return methodMatch ? methodMatch[1] : 'solve';
  }
}

// Main execution function using Docker
export async function runCpp(
  problem: Problem,
  userCode: string
): Promise<{ stdout: string; stderr: string }> {
  console.log('🚀 [CPP-DOCKER] Starting C++ execution with Docker...');
  console.log('📥 Problem:', problem.title);
  console.log('📥 User code length:', userCode.length);

  const docker = new Docker({
    socketPath: '/var/run/docker.sock'
  });
  const executor = new CppExecutor(problem, userCode);
  const fullCode = executor.generateCode();

  console.log('🔧 Generated C++ code:', fullCode);

  const filename = `solution_${Date.now()}.cpp`;
  const filepath = join(tmpdir(), filename);
  const containerName = `cpp-exec-${Date.now()}`;

  try {
    // Write code to temporary file
    await writeFile(filepath, fullCode);
    console.log('📝 [CPP-DOCKER] Code written to:', filepath);
    
    // Verify file exists and has content
    const fs = require('fs');
    const stats = fs.statSync(filepath);
    console.log('📊 [CPP-DOCKER] File size:', stats.size, 'bytes');
    console.log('📊 [CPP-DOCKER] File exists:', fs.existsSync(filepath));

    // Convert Windows path to Unix path for Docker
    const unixPath = filepath.replace(/\\/g, '/');
    console.log('🔄 [CPP-DOCKER] Unix path for Docker:', unixPath);

    // Pull C++ image if not exists
    console.log('📦 [CPP-DOCKER] Pulling C++ image...');
    await docker.pull('gcc:latest');

    // Create container
    console.log('🐳 [CPP-DOCKER] Creating container...');
    const container = await docker.createContainer({
      Image: 'gcc:latest',
      name: containerName,
      Cmd: ['sh', '-c', `cd /tmp && echo "Files in /tmp:" && ls -la && echo "Compiling ${filename}..." && g++ -std=c++17 -o solution ${filename} && echo "Running solution..." && ./solution`],
      HostConfig: { 
        Memory: 512 * 1024 * 1024, // 512MB limit
        MemorySwap: 512 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 50000, // 50% CPU limit
        NetworkMode: 'none', // No network access
        Binds: [`${unixPath}:/tmp/${filename}:ro`], // Read-only mount with Unix path
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL']
      },
      WorkingDir: '/tmp'
    });

    console.log('✅ [CPP-DOCKER] Container created:', container.id);

    // Start container and get logs
    console.log('▶️ [CPP-DOCKER] Starting container...');
    await container.start();
    
    let stdout = '';
    let stderr = '';
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        console.log('⏰ [CPP-DOCKER] Execution timeout, stopping container...');
        try {
          await container.stop({ t: 0 });
          await container.remove();
        } catch (error) {
          console.error('❌ [CPP-DOCKER] Error stopping container:', error);
        }
        resolve({ stdout, stderr: stderr || 'Execution timeout' });
      }, 10000);

      // Use the wait method to get container completion and then fetch logs
      const waitForContainer = async () => {
        try {
          // Wait for container to finish
          const result = await container.wait();
          console.log('📊 [CPP-DOCKER] Container finished with code:', result.StatusCode);
          
          // Get logs after container finishes (before removing)
        const logs = await container.logs({
          stdout: true,
            stderr: true
          });
          
          // Process logs
          if (logs && logs.length > 0) {
            const demuxed = demultiplexDockerLogs(logs);
            stdout = demuxed.stdout;
            stderr = demuxed.stderr;
            
            console.log('📤 [CPP-DOCKER] Final STDOUT:', stdout.trim());
            if (stderr) console.log('❌ [CPP-DOCKER] Final STDERR:', stderr.trim());
          }
          
          // Clean up container after getting logs
        await container.remove();
          await unlink(filepath).catch(console.error);
          
          if (result.StatusCode !== 0 && !stderr) {
            stderr = `Container exited with code ${result.StatusCode}`;
          }
          
          clearTimeout(timeout);
          resolve({ stdout, stderr });
        } catch (error) {
          console.error('❌ [CPP-DOCKER] Container execution error:', error);
          clearTimeout(timeout);
          
          try {
            await container.remove();
          } catch (cleanupError) {
            console.error('❌ [CPP-DOCKER] Cleanup error:', cleanupError);
          }
          
          reject(error);
        }
      };
      
      waitForContainer();
    });

  } catch (error) {
    console.error('❌ [CPP-DOCKER] Execution error:', error);
    
    // Cleanup
    try {
      const container = docker.getContainer(containerName);
      await container.stop({ t: 0 });
          await container.remove();
    } catch (cleanupError) {
      console.error('❌ [CPP-DOCKER] Cleanup error:', cleanupError);
    }
    
    await unlink(filepath).catch(console.error);
    throw error;
  }
}