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

export class JavaExecutor {
  private problem: Problem;
  private userCode: string;

  constructor(problem: Problem, userCode: string) {
    this.problem = problem;
    this.userCode = userCode;
  }

  // Generate complete Java code with test runner
  generateCode(): string {
    const stub = this.problem.codeStubs.find(s => s.language === 'JAVA');
    if (!stub) {
      throw new Error('No Java code stub found for this problem');
    }

    // Build the complete code structure with imports
    const imports = 'import java.util.Stack;\nimport java.util.*;\n';
    const fullCode = imports + stub.startSnippet + '\n' + this.userCode + '\n' + stub.endSnippet;
    
    // Generate test runner
    const testRunner = this.generateTestRunner();
    
    return fullCode + '\n\n' + testRunner;
  }

  private generateTestRunner(): string {
    const methodName = this.extractMethodName();
    const testCases = this.problem.testcases.map((tc, index) => {
      return `        // Test case ${index + 1}
        Object test_input_${index + 1} = ${tc.input};
        Object expected_output_${index + 1} = ${tc.output};
        Object result_${index + 1} = sol.${methodName}(test_input_${index + 1});
        System.out.println("TEST_${index + 1}:" + result_${index + 1});`;
    }).join('\n');

    return `    public static void main(String[] args) {
        Solution sol = new Solution();
${testCases}
    }`;
  }

  private extractMethodName(): string {
    const stub = this.problem.codeStubs.find(s => s.language === 'JAVA');
    if (!stub) return 'solve';

    const methodMatch = stub.userSnippet.match(/public\s+(?:static\s+)?(?:int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+(\w+)\s*\(/);
    return methodMatch ? methodMatch[1] : 'solve';
  }
}

// Main execution function using Docker
export async function runJava(
  problem: Problem,
  userCode: string
): Promise<{ stdout: string; stderr: string }> {
  console.log('🚀 [JAVA-DOCKER] Starting Java execution with Docker...');
  console.log('📥 Problem:', problem.title);
  console.log('📥 User code length:', userCode.length);

  const docker = new Docker({
    socketPath: '/var/run/docker.sock'
  });
  const executor = new JavaExecutor(problem, userCode);
  const fullCode = executor.generateCode();

  console.log('🔧 Generated Java code:', fullCode);

  const filename = `Solution_${Date.now()}.java`;
  const filepath = join(tmpdir(), filename);
  const containerName = `java-exec-${Date.now()}`;

  try {
    // Write code to temporary file
    await writeFile(filepath, fullCode);
    console.log('📝 [JAVA-DOCKER] Code written to:', filepath);
    
    // Verify file exists and has content
    const fs = require('fs');
    const stats = fs.statSync(filepath);
    console.log('📊 [JAVA-DOCKER] File size:', stats.size, 'bytes');
    console.log('📊 [JAVA-DOCKER] File exists:', fs.existsSync(filepath));
    console.log('📊 [JAVA-DOCKER] File is file:', stats.isFile());
    console.log('📊 [JAVA-DOCKER] File permissions:', stats.mode.toString(8));

    // Convert Windows path to Unix path for Docker and ensure it's absolute
    const unixPath = filepath.replace(/\\/g, '/');
    const absoluteUnixPath = unixPath.startsWith('/') ? unixPath : `/${unixPath}`;
    console.log('🔄 [JAVA-DOCKER] Unix path for Docker:', absoluteUnixPath);

    // Pull Java image if not exists
    console.log('📦 [JAVA-DOCKER] Pulling Java image...');
    await docker.pull('openjdk:11-jdk-slim');

    // Create container
    console.log('🐳 [JAVA-DOCKER] Creating container...');
    console.log('📁 [JAVA-DOCKER] File path:', filepath);
    console.log('📁 [JAVA-DOCKER] Filename:', filename);
    
    const container = await docker.createContainer({
      Image: 'openjdk:11-jdk-slim',
      name: containerName,
      Cmd: ['sh', '-c', `cd /tmp && echo "Files in /tmp:" && ls -la && echo "Compiling ${filename}..." && javac ${filename} && echo "Running Solution..." && java Solution`],
      HostConfig: { 
        Memory: 512 * 1024 * 1024, // 512MB limit
        MemorySwap: 512 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 50000, // 50% CPU limit
        NetworkMode: 'none', // No network access
        Binds: [`${absoluteUnixPath}:/tmp/${filename}:ro`], // Read-only mount with absolute Unix path
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL']
      },
      WorkingDir: '/tmp'
    });

    console.log('✅ [JAVA-DOCKER] Container created:', container.id);

    // Start container and get logs
    console.log('▶️ [JAVA-DOCKER] Starting container...');
    await container.start();
    
    let stdout = '';
    let stderr = '';
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        console.log('⏰ [JAVA-DOCKER] Execution timeout, stopping container...');
        try {
          await container.stop({ t: 0 });
          await container.remove();
        } catch (error) {
          console.error('❌ [JAVA-DOCKER] Error stopping container:', error);
        }
        resolve({ stdout, stderr: stderr || 'Execution timeout' });
      }, 10000);

      // Use the wait method to get container completion and then fetch logs
      const waitForContainer = async () => {
        try {
          // Wait for container to finish
          const result = await container.wait();
          console.log('📊 [JAVA-DOCKER] Container finished with code:', result.StatusCode);
          
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
            
            console.log('📤 [JAVA-DOCKER] Final STDOUT:', stdout.trim());
            if (stderr) console.log('❌ [JAVA-DOCKER] Final STDERR:', stderr.trim());
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
          console.error('❌ [JAVA-DOCKER] Container execution error:', error);
          clearTimeout(timeout);
          
          try {
            await container.remove();
          } catch (cleanupError) {
            console.error('❌ [JAVA-DOCKER] Cleanup error:', cleanupError);
          }
          
          reject(error);
        }
      };
      
      waitForContainer();
    });

  } catch (error) {
    console.error('❌ [JAVA-DOCKER] Execution error:', error);
    
    // Cleanup
    try {
      const container = docker.getContainer(containerName);
      await container.stop({ t: 0 });
        await container.remove();
    } catch (cleanupError) {
      console.error('❌ [JAVA-DOCKER] Cleanup error:', cleanupError);
    }
    
    await unlink(filepath).catch(console.error);
    throw error;
  }
}