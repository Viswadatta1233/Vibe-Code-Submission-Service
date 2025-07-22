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

    // Build the complete code structure
    const fullCode = stub.startSnippet + '\n' + this.userCode + '\n' + stub.endSnippet;
    
    // Generate test runner
    const testRunner = this.generateTestRunner();
    
    return fullCode + '\n\n' + testRunner;
  }

  private generateTestRunner(): string {
    const methodName = this.extractMethodName();
    const testCases = this.problem.testcases.map((tc, index) => {
      return `    // Test case ${index + 1}
    auto test_input = ${tc.input};
    auto expected_output = ${tc.output};
    auto result = sol.${methodName}(test_input);
    std::cout << "TEST_${index + 1}:" << result << std::endl;`;
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

  const docker = new Docker();
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

    // Pull C++ image if not exists
    console.log('📦 [CPP-DOCKER] Pulling C++ image...');
    await docker.pull('gcc:11-slim');

    // Create container
    console.log('🐳 [CPP-DOCKER] Creating container...');
    const container = await docker.createContainer({
      Image: 'gcc:11-slim',
      name: containerName,
      Cmd: ['sh', '-c', `cd /tmp && g++ -std=c++17 -o solution ${filename} && ./solution`],
      HostConfig: {
        Memory: 512 * 1024 * 1024, // 512MB limit
        MemorySwap: 512 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 50000, // 50% CPU limit
        NetworkMode: 'none', // No network access
        Binds: [`${filepath}:/tmp/${filename}:ro`], // Read-only mount
        AutoRemove: true,
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL']
      },
      WorkingDir: '/tmp'
    });

    console.log('✅ [CPP-DOCKER] Container created:', container.id);

    // Start container and get logs
    console.log('▶️ [CPP-DOCKER] Starting container...');
    await container.start();

    // Get logs with real-time streaming
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 'all'
    });

    let stdout = '';
    let stderr = '';
    let logsBuffer = Buffer.alloc(0);

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

      logStream.on('data', (chunk: Buffer) => {
        console.log('📤 [CPP-DOCKER] Raw log chunk received, size:', chunk.length);
        
        // Accumulate buffer
        logsBuffer = Buffer.concat([logsBuffer, chunk]);
        
        // Try to demultiplex if we have enough data
        if (logsBuffer.length >= 8) {
          try {
            const demuxed = demultiplexDockerLogs(logsBuffer);
            stdout += demuxed.stdout;
            stderr += demuxed.stderr;
            
            // Log real-time output
            if (demuxed.stdout) {
              console.log('📤 [CPP-DOCKER] STDOUT:', demuxed.stdout.trim());
            }
            if (demuxed.stderr) {
              console.log('❌ [CPP-DOCKER] STDERR:', demuxed.stderr.trim());
            }
          } catch (error) {
            console.error('❌ [CPP-DOCKER] Error demultiplexing logs:', error);
          }
        }
      });

      logStream.on('end', async () => {
        console.log('🏁 [CPP-DOCKER] Log stream ended');
        clearTimeout(timeout);
        
        try {
          // Get final container state
          const containerData = await container.inspect();
          const exitCode = containerData.State.ExitCode;
          
          console.log('📊 [CPP-DOCKER] Container exit code:', exitCode);
          
          // Clean up
          await container.remove();
          await unlink(filepath).catch(console.error);
          
          if (exitCode !== 0 && !stderr) {
            stderr = `Container exited with code ${exitCode}`;
          }
          
          resolve({ stdout, stderr });
        } catch (error) {
          console.error('❌ [CPP-DOCKER] Error in cleanup:', error);
          resolve({ stdout, stderr: stderr || 'Container execution failed' });
        }
      });

      logStream.on('error', async (error: any) => {
        console.error('❌ [CPP-DOCKER] Log stream error:', error);
        clearTimeout(timeout);
        
        try {
          await container.stop({ t: 0 });
          await container.remove();
        } catch (cleanupError) {
          console.error('❌ [CPP-DOCKER] Error stopping container:', cleanupError);
        }
        
        reject(error);
      });
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