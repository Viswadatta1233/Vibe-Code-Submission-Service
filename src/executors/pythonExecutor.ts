import Docker from 'dockerode';
import { Problem, ExecutionResponse } from '../types';

const PYTHON_IMAGE = 'python:3.9-slim';

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
    console.log(`✅ [PYTHON] Image ${image} pulled successfully`);
  } catch (error) {
    console.error(`❌ [PYTHON] Failed to pull image ${image}:`, error);
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
    console.log(`✅ [PYTHON] Container created: ${container.id}`);
    return container;
  } catch (error) {
    console.error(`❌ [PYTHON] Failed to create container:`, error);
    throw error;
  }
}

// Helper function to fetch decoded stream with timeout
function fetchDecodedStream(loggerStream: NodeJS.ReadableStream, rawLogBuffer: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log('⏰ [PYTHON] Timer called - TLE');
      reject(new Error('TLE'));
    }, 4000);

    loggerStream.on('end', () => {
      clearTimeout(timer);
      console.log('📝 [PYTHON] Stream ended, processing logs...');
      
      // Concatenate all collected log chunks into one complete buffer
      const completeStreamData = Buffer.concat(rawLogBuffer);
      
      // Decode the complete log stream
      const decodedStream = demultiplexDockerLogs(completeStreamData);
      
      console.log('🔍 [PYTHON] Decoded stream:', {
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

export async function runPython(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('🚀 [PYTHON] Starting Python execution...');
  console.log('📋 [PYTHON] Problem title:', problem.title);
  console.log('📋 [PYTHON] User code length:', userCode.length);
  console.log('📋 [PYTHON] Number of test cases:', problem.testcases?.length || 0);
  
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  let container: any = null;
  
  try {
    // Extract the Solution class content from user code
    let solutionContent = userCode;
    console.log('🔍 [PYTHON] Original user code:', userCode.substring(0, 200) + '...');
    
    // If user provided full class, extract just the content
    if (userCode.includes('class Solution')) {
      console.log('🔍 [PYTHON] Detected full class, extracting content...');
      const classMatch = userCode.match(/class Solution\s*:([\s\S]*)/);
      if (classMatch) {
        solutionContent = classMatch[1].trim();
        console.log('🔍 [PYTHON] Extracted class content length:', solutionContent.length);
      } else {
        console.log('⚠️ [PYTHON] Could not extract class content, using full code');
      }
    } else {
      console.log('🔍 [PYTHON] Using user code as-is (no class wrapper detected)');
    }
    
    // Extract method name from user code
    const methodMatch = userCode.match(/def\s+(\w+)\s*\(/);
    const methodName = methodMatch ? methodMatch[1] : 'solve';
    
    console.log('🔍 [PYTHON] Extracted method name:', methodName);
    console.log('🔍 [PYTHON] Method regex match:', methodMatch ? 'Found' : 'Not found, using default "solve"');
    
    // Build the complete Python program
    const fullCode = [
      '# Common imports for coding problems',
      'import sys',
      'import os',
      'from typing import *',
      'from collections import *',
      'import math',
      'import heapq',
      '',
      'class Solution:',
      `    ${solutionContent}`,
      '',
      'def main():',
      '    # Read input from stdin',
      '    input_data = input().strip()',
      '',
      '    # Create solution instance',
      '    solution = Solution()',
      '',
      '    # Execute and print result',
      '    try:',
      '        # Remove quotes from input if present',
      '        clean_input = input_data',
      '        if input_data.startswith(\'"\') and input_data.endswith(\'"\'):',
      '            clean_input = input_data[1:-1]',
      '',
      `        result = solution.${methodName}(clean_input)`,
      '        print(result)',
      '    except Exception as e:',
      '        print(f"Error: {e}", file=sys.stderr)',
      '',
      'if __name__ == "__main__":',
      '    main()'
    ].join('\n');

    console.log('📝 [PYTHON] Generated code length:', fullCode.length);
    console.log('📝 [PYTHON] Generated code preview:', fullCode.substring(0, 500) + '...');
    
    // Prepare test cases
    const testCases = problem.testcases || [];
    console.log(`🧪 [PYTHON] Processing ${testCases.length} test cases`);
    
    let allOutputs = '';
    let passedTests = 0;
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const input = testCase.input;
      const expectedOutput = testCase.output;
      
      console.log(`🧪 [PYTHON] Running test case ${i + 1}/${testCases.length}`);
      console.log(`📥 [PYTHON] Test case ${i + 1} input:`, input);
      console.log(`📥 [PYTHON] Test case ${i + 1} expected output:`, expectedOutput);
      
      // Create the run command using heredoc to avoid escaping issues
      const runCommand = `cat > main.py << 'EOF'
${fullCode}
EOF
echo '${input}' | python main.py`;
      
      console.log('🔧 [PYTHON] Run command length:', runCommand.length);
      
      // Pull image if needed
      await pullImage(docker, PYTHON_IMAGE);
      
      // Create and start container
      container = await createContainer(docker, PYTHON_IMAGE, ['/bin/sh', '-c', runCommand]);
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
        
        console.log(`📊 [PYTHON] Test ${i + 1} - Raw response: "${codeResponse}"`);
        console.log(`📊 [PYTHON] Test ${i + 1} - Trimmed response: "${trimmedResponse}"`);
        console.log(`📊 [PYTHON] Test ${i + 1} - Expected: "${trimmedExpected}"`);
        console.log(`📊 [PYTHON] Test ${i + 1} - Match: ${trimmedResponse === trimmedExpected ? '✅ PASS' : '❌ FAIL'}`);
        
        if (trimmedResponse === trimmedExpected) {
          passedTests++;
          console.log(`✅ [PYTHON] Test ${i + 1} passed!`);
        } else {
          console.log(`❌ [PYTHON] Test ${i + 1} failed!`);
        }
        allOutputs += `${trimmedResponse}\n`;
        console.log(`📝 [PYTHON] Added to allOutputs: "${trimmedResponse}"`);
        
              } catch (error) {
          if (error instanceof Error) {
            console.log(`❌ [PYTHON] Test ${i + 1} error:`, error.message);
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
    console.log(`✅ [PYTHON] Execution completed: ${passedTests}/${testCases.length} tests passed`);
    console.log(`📊 [PYTHON] Final status: ${status}`);
    console.log(`📝 [PYTHON] Final output:`, allOutputs);
    console.log(`📝 [PYTHON] Output length:`, allOutputs.length);
    
    return { output: allOutputs, status };
    
  } catch (error) {
    console.error('❌ [PYTHON] Execution error:', error);
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
        console.error('❌ [PYTHON] Failed to remove container:', error);
      }
    }
  }
} 