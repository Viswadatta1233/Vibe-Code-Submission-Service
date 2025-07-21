import Docker from 'dockerode';
import { writeFile } from 'fs-extra';
import { dir } from 'tmp-promise';

export const PYTHON_IMAGE = 'python:3.8-slim';
export const JAVA_IMAGE = 'openjdk:17-slim';
export const CPP_IMAGE = 'gcc:latest';

// Function to properly demultiplex Docker logs
function demultiplexDockerLogs(buffer: Buffer): { stdout: string, stderr: string } {
  let stdout = '';
  let stderr = '';
  let offset = 0;
  
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    
    // Read the header
    const streamType = buffer[offset];
    const size = buffer.readUInt32BE(offset + 4);
    
    if (offset + 8 + size > buffer.length) break;
    
    // Extract the payload
    const payload = buffer.slice(offset + 8, offset + 8 + size).toString();
    
    // Stream type: 1 = stdout, 2 = stderr
    if (streamType === 1) {
      stdout += payload;
    } else if (streamType === 2) {
      stderr += payload;
    }
    
    offset += 8 + size;
  }
  
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

// Test function to verify regex patterns
function testCppRegexPatterns() {
  const testCode = `int maxSubArray(std::vector<int>& nums) {
       int maxSoFar = nums[0];
    int currentMax = nums[0];

    for (size_t i = 1; i < nums.size(); ++i) {
        currentMax = std::max(nums[i], currentMax + nums[i]);
        maxSoFar = std::max(maxSoFar, currentMax);
    }

    return maxSoFar;
    }`;
  
  console.log('🧪 Testing C++ regex patterns with:', testCode);
  
  // Test method name extraction
  const methodMatch = testCode.match(/(?:int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+(\w+)\s*\(/);
  console.log('🧪 Method name match:', methodMatch);
  
  // Test method signature extraction
  const methodSignatureMatch = testCode.match(/(?:int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+\w+\s*\(([^)]*)\)/);
  console.log('🧪 Method signature match:', methodSignatureMatch);
  
  // Test parameter detection
  const methodParams = methodSignatureMatch ? methodSignatureMatch[1].trim() : '';
  console.log('🧪 Method params:', methodParams);
  
  const hasVectorParam = /(?:std::)?vector<.*>/.test(methodParams);
  const hasIntParam = /\bint\s+\w+/.test(methodParams) && !/int\[\]/.test(methodParams);
  
  console.log('🧪 hasVectorParam:', hasVectorParam);
  console.log('🧪 hasIntParam:', hasIntParam);
  console.log('🧪 Combined condition (hasVectorParam && hasIntParam):', hasVectorParam && hasIntParam);
}

// C++ code template for user submissions
function buildCppCode(fullCode: string): string {
  console.log('🔧 Building C++ code with input:', fullCode);
  
  // Clean up the user code
  const cleanUserCode = fullCode.trim();
  console.log('🧹 Cleaned user code:', cleanUserCode);
  
  // Extract method name from the Solution class
  const solutionMethodMatch = cleanUserCode.match(/class Solution\s*\{[\s\S]*?public:[\s\S]*?(?:int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+(\w+)\s*\(/);
  const methodName = solutionMethodMatch ? solutionMethodMatch[1] : 'twoSum';
  console.log('🔧 Extracted method name from Solution class:', methodName);
  
  // Extract the Solution class content
  const solutionMatch = cleanUserCode.match(/class Solution\s*\{([\s\S]*)\}/);
  if (!solutionMatch) {
    console.error('❌ Could not find Solution class in the code');
    return cleanUserCode;
  }
  
  const solutionContent = solutionMatch[1];
  console.log('🔧 Extracted Solution class content');
  
  // Create a new main function with proper input parsing
  let newMainFunction = '';
  
  // Determine the problem type based on method name
  if (methodName === 'twoSum') {
    // Two Sum: array + target
    newMainFunction = `int main() {
    Solution sol;
    
    // Parse input from stdin
    string line;
    getline(cin, line);
    
    // Parse input: "[2,7,11,15],9" -> vector<int> and int
    size_t commaPos = line.find_last_of(',');
    string arrStr = line.substr(1, commaPos - 1);
    int target = stoi(line.substr(commaPos + 1));
    
    // Parse array
    vector<int> nums;
    if (!arrStr.empty()) {
        size_t start = 0;
        size_t end = arrStr.find(',');
        while (end != string::npos) {
            nums.push_back(stoi(arrStr.substr(start, end - start)));
            start = end + 1;
            end = arrStr.find(',', start);
        }
        nums.push_back(stoi(arrStr.substr(start)));
    }
    
    vector<int> result = sol.${methodName}(nums, target);
    cout << "[" << result[0];
    for (size_t i = 1; i < result.size(); ++i) {
        cout << "," << result[i];
    }
    cout << "]" << endl;
    return 0;
}`;
  } else if (methodName === 'isValid') {
    // Valid Parentheses: string
    newMainFunction = `int main() {
    Solution sol;
    string s;
    getline(cin, s);
    s = s.substr(1, s.length() - 2); // Remove quotes
    bool result = sol.${methodName}(s);
    cout << (result ? "true" : "false") << endl;
    return 0;
}`;
  } else if (methodName === 'maxSubArray' || methodName === 'removeDuplicates') {
    // Array problems: single array input
    newMainFunction = `int main() {
    Solution sol;
    string line;
    getline(cin, line);
    string arrStr = line.substr(1, line.length() - 2); // Remove [ and ]
    
    vector<int> nums;
    if (!arrStr.empty()) {
        size_t start = 0;
        size_t end = arrStr.find(',');
        while (end != string::npos) {
            nums.push_back(stoi(arrStr.substr(start, end - start)));
            start = end + 1;
            end = arrStr.find(',', start);
        }
        nums.push_back(stoi(arrStr.substr(start)));
    }
    
    int result = sol.${methodName}(nums);
    cout << result << endl;
    return 0;
}`;
  } else if (methodName === 'isPalindrome') {
    // Integer input
    newMainFunction = `int main() {
    Solution sol;
    int x;
    cin >> x;
    bool result = sol.${methodName}(x);
    cout << (result ? "true" : "false") << endl;
    return 0;
}`;
  } else {
    // Default case
    newMainFunction = `int main() {
    Solution sol;
    string line;
    getline(cin, line);
    // Add your method call here
    return 0;
}`;
  }
  
  // Build the complete code
  const finalCode = `#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
#include <unordered_map>
using namespace std;

class Solution {
${solutionContent}
};

${newMainFunction}`;
  
  console.log('🔧 Final processed code:', finalCode);
  return finalCode;
}

export async function runCpp(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🚀 Starting C++ execution...');
  console.log('📥 Input code:', fullCode);
  console.log('📥 Input data:', input);
  
  // Use the direct method as primary approach since volume mounting is unreliable
  console.log('🔄 Using direct file creation method as primary approach...');
  return await runCppDirect(fullCode, input);
}

// Alternative approach using exec instead of logs
export async function runCppAlternative(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🔄 Using alternative C++ execution method...');
  const docker = new Docker();
  const { path, cleanup } = await dir({ unsafeCleanup: true });
  const codeToRun = buildCppCode(fullCode);
  const filePath = `${path}/main.cpp`;
    await writeFile(filePath, codeToRun);
  let container: any = null;
  
  try {
    await docker.pull(CPP_IMAGE);
    
    container = await docker.createContainer({
      Image: CPP_IMAGE,
      Cmd: ['sleep', '30'], // Keep container alive
      HostConfig: { 
        Binds: [`${path}:/usr/src/app:ro`], 
        AutoRemove: false 
      },
      WorkingDir: '/usr/src/app',
      Tty: false,
      OpenStdin: false
    });
    
    await container.start();
    
    // Execute compilation
    const compileExec = await container.exec({
      Cmd: ['g++', 'main.cpp', '-o', 'main'],
      AttachStdout: true,
      AttachStderr: true
    });
    
    const compileStream = await compileExec.start({ Detach: false });
    let compileOutput = '';
    
    compileStream.on('data', (chunk: Buffer) => {
      compileOutput += chunk.toString();
    });
    
    await new Promise(resolve => compileStream.on('end', resolve));
    
    if (compileOutput.includes('error:')) {
      await container.kill();
      await cleanup();
      return { stdout: '', stderr: compileOutput };
    }
    
    // Execute the program
    const runExec = await container.exec({
      Cmd: ['sh', '-c', `echo "${input}" | ./main`],
      AttachStdout: true,
      AttachStderr: true
    });
    
    const runStream = await runExec.start({ Detach: false });
    let stdout = '';
    let stderr = '';
    
    runStream.on('data', (chunk: Buffer) => {
      const output = chunk.toString();
      if (output.includes('Exception') || output.includes('Error')) {
        stderr += output;
      } else {
        stdout += output;
      }
    });
    
    await new Promise(resolve => runStream.on('end', resolve));
    
    return { 
      stdout: stdout.trim(), 
      stderr: stderr.trim() 
    };
    
  } catch (err: any) {
    console.error('Alternative C++ execution failed:', err);
    
    // Try third approach - create file directly in container
    console.log('🔄 Trying third approach - direct file creation...');
    return await runCppDirect(fullCode, input);
  } finally {
    if (container) {
      try {
        // Check if container is still running before trying to kill it
        const containerInfo = await container.inspect();
        if (containerInfo.State.Running) {
          await container.kill();
        }
        await container.remove();
      } catch (e) {
        console.error('Failed to cleanup alternative container:', e);
      }
    }
    await cleanup();
  }
}

// Third approach: Create file directly inside container
export async function runCppDirect(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🔄 Using direct file creation method...');
  const docker = new Docker();
  const codeToRun = buildCppCode(fullCode);
  let container: any = null;
  
  try {
    // Use gcc:latest directly since it's available and has GCC pre-installed
    const selectedImage = 'gcc:latest';
    console.log(`🚀 Using image: ${selectedImage}`);
    
    // Use a safer approach with base64 encoding to avoid shell escaping issues
    const codeToRunBase64 = Buffer.from(codeToRun).toString('base64');
    const inputBase64 = Buffer.from(input).toString('base64');
    
        const container = await docker.createContainer({
      Image: selectedImage,
      Cmd: ['sh', '-c', `
        echo '${codeToRunBase64}' | base64 -d > main.cpp
        g++ main.cpp -o main
        echo '${inputBase64}' | base64 -d | ./main
      `],
          HostConfig: { 
        AutoRemove: false,
        Memory: 512 * 1024 * 1024,
            CpuPeriod: 100000,
        CpuQuota: 50000,
        NetworkMode: 'none', // No network needed since GCC is pre-installed
          },
          Tty: false,
          OpenStdin: true,
          StdinOnce: false,
        });
        
        await container.start();
        
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Container execution timeout (30s)')), 30000);
        });
        
        const waitPromise = container.wait();
        const result = await Promise.race([waitPromise, timeoutPromise]) as any;
        
        const logs = await container.logs({
          stdout: true,
          stderr: true,
          tail: 1000
        });
        
    const { stdout, stderr } = demultiplexDockerLogs(Buffer.from(logs));
    
        await container.remove();
    
    console.log('✅ [DIRECT] C++ execution completed successfully');
    console.log('📤 [DIRECT] stdout:', stdout);
    console.log('📤 [DIRECT] stderr:', stderr);
    
    return { stdout, stderr };
    
  } catch (err: any) {
    console.error('❌ [DIRECT] Direct C++ execution failed:', err);
    return { stdout: '', stderr: err.message || 'Direct execution failed' };
  } finally {
    if (container) {
      try {
        // Check if container is still running before trying to kill it
        const containerInfo = await container.inspect();
        if (containerInfo.State.Running) {
          await container.kill();
        }
          await container.remove();
      } catch (e) {
        console.error('Failed to cleanup direct container:', e);
      }
    }
  }
}
