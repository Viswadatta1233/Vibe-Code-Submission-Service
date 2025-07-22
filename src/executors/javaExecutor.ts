import Docker from 'dockerode';
import { Problem, ExecutionResponse } from '../types';

const JAVA_IMAGE = 'openjdk:11-jdk-slim';

// Helper function to demultiplex Docker logs
function demultiplexDockerLogs(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  
  for (let i = 0; i < buffer.length; i += 8) {
    if (i + 8 > buffer.length) break;
    
    const header = buffer.slice(i, i + 8);
    const streamType = header[0];
    const payloadLength = header.readUInt32BE(4);
    
    if (i + 8 + payloadLength > buffer.length) break;
    
    const payload = buffer.slice(i + 8, i + 8 + payloadLength);
    const text = payload.toString('utf8');
    
    if (streamType === 1) {
      stdout += text;
    } else if (streamType === 2) {
      stderr += text;
    }
    
    i += payloadLength - 8; // Adjust for the payload we just processed
  }
  
  return { stdout, stderr };
}

// Helper function to pull Docker image
async function pullImage(docker: any, image: string): Promise<void> {
  try {
    await docker.pull(image);
    console.log(`✅ [JAVA] Image ${image} pulled successfully`);
  } catch (error) {
    console.error(`❌ [JAVA] Failed to pull image ${image}:`, error);
    throw error;
  }
}

// Helper function to create container
async function createContainer(docker: any, image: string, cmd: string[]): Promise<any> {
  try {
    const container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
              HostConfig: {
          Memory: 512 * 1024 * 1024, // 512MB
          MemorySwap: 0,
          CpuPeriod: 100000,
          CpuQuota: 50000, // 50% CPU
          NetworkMode: 'none',
          SecurityOpt: ['no-new-privileges'],
          Binds: []
        }
    });
    console.log(`✅ [JAVA] Container created: ${container.id}`);
    return container;
  } catch (error) {
    console.error(`❌ [JAVA] Failed to create container:`, error);
    throw error;
  }
}

// Helper function to fetch decoded stream with timeout
function fetchDecodedStream(loggerStream: NodeJS.ReadableStream, rawLogBuffer: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log('⏰ [JAVA] Timer called - TLE');
      reject(new Error('TLE'));
    }, 4000);

    loggerStream.on('end', () => {
      clearTimeout(timer);
      console.log('📝 [JAVA] Stream ended, processing logs...');
      
      // Concatenate all collected log chunks into one complete buffer
      const completeStreamData = Buffer.concat(rawLogBuffer);
      
      // Decode the complete log stream
      const decodedStream = demultiplexDockerLogs(completeStreamData);
      
      console.log('🔍 [JAVA] Decoded stream:', {
        stdoutLength: decodedStream.stdout.length,
        stderrLength: decodedStream.stderr.length,
        stdout: decodedStream.stdout.substring(0, 200) + '...',
        stderr: decodedStream.stderr.substring(0, 200) + '...'
      });
      
      if (decodedStream.stderr) {
        reject(new Error(decodedStream.stderr));
      } else {
        resolve(decodedStream.stdout);
      }
    });
  });
}

export async function runJava(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('🚀 [JAVA] Starting Java execution...');
  console.log('📋 [JAVA] Problem title:', problem.title);
  console.log('📋 [JAVA] User code length:', userCode.length);
  console.log('📋 [JAVA] Number of test cases:', problem.testcases?.length || 0);
  
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  let container: any = null;
  
  try {
    // Extract the Solution class content from user code
    let solutionContent = userCode;
    console.log('🔍 [JAVA] Original user code:', userCode.substring(0, 200) + '...');
    
    // If user provided full class, extract just the content
    if (userCode.includes('class Solution')) {
      console.log('🔍 [JAVA] Detected full class, extracting content...');
      const classMatch = userCode.match(/class Solution\s*\{([\s\S]*)\}/);
      if (classMatch) {
        solutionContent = classMatch[1].trim();
        console.log('🔍 [JAVA] Extracted class content length:', solutionContent.length);
      } else {
        console.log('⚠️ [JAVA] Could not extract class content, using full code');
      }
    } else {
      console.log('🔍 [JAVA] Using user code as-is (no class wrapper detected)');
    }
    
    // Extract method name from user code
    const methodMatch = userCode.match(/public\s+(?:static\s+)?(?:int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+(\w+)\s*\(/);
    const methodName = methodMatch ? methodMatch[1] : 'solve';
    
    console.log('🔍 [JAVA] Extracted method name:', methodName);
    console.log('🔍 [JAVA] Method regex match:', methodMatch ? 'Found' : 'Not found, using default "solve"');
    
    // Build the complete Java program
    const fullCode = [
      'import java.util.*;',
      'import java.util.Stack;',
      'import java.util.Queue;',
      'import java.util.LinkedList;',
      'import java.util.PriorityQueue;',
      'import java.util.HashMap;',
      'import java.util.HashSet;',
      'import java.util.ArrayList;',
      'import java.util.Arrays;',
      'import java.util.List;',
      'import java.util.Map;',
      'import java.util.Set;',
      '',
      'public class Main {',
      '    public static void main(String[] args) {',
      '        Scanner scanner = new Scanner(System.in);',
      '',
      '        // Read input',
      '        String input = scanner.nextLine();',
      '        scanner.close();',
      '',
      '        // Create solution instance',
      '        Solution solution = new Solution();',
      '',
      '        // Execute and print result',
      '        try {',
      '            // Remove quotes from input if present',
      '            String cleanInput = input;',
      '            if (input.startsWith("\\"") && input.endsWith("\\"")) {',
      '                cleanInput = input.substring(1, input.length() - 1);',
      '            }',
      '',
      '            // Call the solution method with cleaned input',
      `            Object result = solution.${methodName}(cleanInput);`,
      '            System.out.println(result);',
      '        } catch (Exception e) {',
      '            System.err.println("Error: " + e.getMessage());',
      '        }',
      '    }',
      '',
      '    static class Solution {',
      `        ${solutionContent}`,
      '    }',
      '}'
    ].join('\n');

    console.log('📝 [JAVA] Generated code length:', fullCode.length);
    console.log('📝 [JAVA] Generated code preview:', fullCode.substring(0, 500) + '...');
    
    // Prepare test cases
    const testCases = problem.testcases || [];
    console.log(`🧪 [JAVA] Processing ${testCases.length} test cases`);
    
    let allOutputs = '';
    let passedTests = 0;
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const input = testCase.input;
      const expectedOutput = testCase.output;
      
      console.log(`🧪 [JAVA] Running test case ${i + 1}/${testCases.length}`);
      console.log(`📥 [JAVA] Test case ${i + 1} input:`, input);
      console.log(`📥 [JAVA] Test case ${i + 1} expected output:`, expectedOutput);
      
      // Create the run command using heredoc to avoid escaping issues
      const runCommand = `cat > Main.java << 'EOF'
${fullCode}
EOF
javac Main.java && echo '${input}' | java Main`;
      
      console.log('🔧 [JAVA] Run command length:', runCommand.length);
      
      // Pull image if needed
      await pullImage(docker, JAVA_IMAGE);
      
      // Create and start container
      container = await createContainer(docker, JAVA_IMAGE, ['/bin/sh', '-c', runCommand]);
      await container.start();
      
      // Set up log collection
      const rawLogBuffer: Buffer[] = [];
      const loggerStream = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: false,
        follow: true
      });
      
      loggerStream.on('data', (chunks: Buffer) => {
        rawLogBuffer.push(chunks);
      });
      
      try {
        const codeResponse = await fetchDecodedStream(loggerStream, rawLogBuffer);
        const trimmedResponse = codeResponse.trim();
        const trimmedExpected = expectedOutput.trim();
        
        console.log(`📊 [JAVA] Test ${i + 1} - Raw response: "${codeResponse}"`);
        console.log(`📊 [JAVA] Test ${i + 1} - Trimmed response: "${trimmedResponse}"`);
        console.log(`📊 [JAVA] Test ${i + 1} - Expected: "${trimmedExpected}"`);
        console.log(`📊 [JAVA] Test ${i + 1} - Match: ${trimmedResponse === trimmedExpected ? '✅ PASS' : '❌ FAIL'}`);
        
        if (trimmedResponse === trimmedExpected) {
          passedTests++;
          console.log(`✅ [JAVA] Test ${i + 1} passed!`);
        } else {
          console.log(`❌ [JAVA] Test ${i + 1} failed!`);
        }
        allOutputs += `${trimmedResponse}\n`;
        console.log(`📝 [JAVA] Added to allOutputs: "${trimmedResponse}"`);
        
              } catch (error) {
          if (error instanceof Error) {
            console.log(`❌ [JAVA] Test ${i + 1} error:`, error.message);
            if (error.message === 'TLE') {
              await container.kill();
            }
            allOutputs += `ERROR\n`;
          } else {
            allOutputs += `ERROR\n`;
          }
      } finally {
        // Remove container
        if (container) {
    await container.remove();
          container = null;
        }
      }
    }
    
    // Determine final status
    const status = passedTests === testCases.length ? 'SUCCESS' : 'WA';
    console.log(`✅ [JAVA] Execution completed: ${passedTests}/${testCases.length} tests passed`);
    console.log(`📊 [JAVA] Final status: ${status}`);
    console.log(`📝 [JAVA] Final output:`, allOutputs);
    console.log(`📝 [JAVA] Output length:`, allOutputs.length);
    
    return { output: allOutputs, status };
    
  } catch (error) {
    console.error('❌ [JAVA] Execution error:', error);
    if (error instanceof Error) {
      return { output: error.message, status: 'ERROR' };
    } else {
      return { output: String(error), status: 'ERROR' };
    }
  } finally {
    // Ensure container is removed
    if (container) {
      try {
        await container.remove();
      } catch (error) {
        console.error('❌ [JAVA] Failed to remove container:', error);
      }
    }
  }
}