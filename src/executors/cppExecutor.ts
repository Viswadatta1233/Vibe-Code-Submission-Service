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
  
  // Run test patterns first
  testCppRegexPatterns();
  
  // Clean up the user code
  const cleanUserCode = fullCode.trim();
  console.log('🧹 Cleaned user code:', cleanUserCode);
  
  // If the code already contains main function or input/output handling, return as is
  if (cleanUserCode.includes('int main(') || cleanUserCode.includes('cin >>') || cleanUserCode.includes('cout <<') || cleanUserCode.includes('main()')) {
    console.log('📝 Code already contains main function or I/O handling, returning as is...');
    
    // Fix common compilation issues in complete programs
    let fixedCode = cleanUserCode;
    
    // Fix: Change non-const reference parameters to const reference or value
    // This handles cases like: vector<int> twoSum(vector<int>& nums, int target)
    // When called with temporary: sol.twoSum({2, 7, 11, 15}, 9)
    fixedCode = fixedCode.replace(
      /vector<int>&/g, 
      'const vector<int>&'
    );
    fixedCode = fixedCode.replace(
      /vector<long>&/g, 
      'const vector<long>&'
    );
    fixedCode = fixedCode.replace(
      /vector<double>&/g, 
      'const vector<double>&'
    );
    fixedCode = fixedCode.replace(
      /vector<float>&/g, 
      'const vector<float>&'
    );
    fixedCode = fixedCode.replace(
      /vector<bool>&/g, 
      'const vector<bool>&'
    );
    fixedCode = fixedCode.replace(
      /vector<string>&/g, 
      'const vector<string>&'
    );
    
    // Fix: Replace simple cout statements that output arrays with proper formatting
    // This handles cases like: for (int i : result) cout << i << " ";
    fixedCode = fixedCode.replace(
      /for\s*\(\s*int\s+[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\)\s*cout\s*<<\s*[a-zA-Z_][a-zA-Z0-9_]*\s*<<\s*[""][^""]*[""]\s*;/g,
      'cout << "[" << result[0]; for (size_t i = 1; i < result.size(); ++i) { cout << "," << result[i]; } cout << "]" << endl;'
    );
    
    // Fix: Replace simple cout statements that output single values with proper formatting
    fixedCode = fixedCode.replace(
      /cout\s*<<\s*[a-zA-Z_][a-zA-Z0-9_]*\s*<<\s*[""][^""]*[""]\s*;/g,
      'cout << "[" << result << "]" << endl;'
    );
    
    console.log('🔧 Fixed compilation and formatting issues in complete program');
    return fixedCode;
  }
  
  // Extract method name from user's code
  const methodMatch = cleanUserCode.match(/(?:int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+(\w+)\s*\(/);
  const methodName = methodMatch ? methodMatch[1] : 'solve';
  console.log('📋 Extracted method name:', methodName);
  
  // Extract return type from user's code
  const returnTypeMatch = cleanUserCode.match(/(int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+\w+\s*\(/);
  const returnType = returnTypeMatch ? returnTypeMatch[1] : 'int';
  console.log('📋 Extracted return type:', returnType);
  
  // Extract method parameters by parsing the method signature
  const methodSignatureMatch = cleanUserCode.match(/(?:int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+\w+\s*\(([^)]*)\)/);
  const methodParams = methodSignatureMatch ? methodSignatureMatch[1].trim() : '';
  console.log('📋 Extracted method parameters:', methodParams);
  
  // Parse parameters more accurately
  const hasVectorParam = /(?:std::)?vector<.*>/.test(methodParams);
  const hasIntParam = /\bint\s+\w+/.test(methodParams) && !/int\[\]/.test(methodParams);
  const hasStringParam = /\bstring\s+\w+/.test(methodParams) && !/string\[\]/.test(methodParams);
  const hasLongParam = /\blong\s+\w+/.test(methodParams) && !/long\[\]/.test(methodParams);
  const hasDoubleParam = /\bdouble\s+\w+/.test(methodParams) && !/double\[\]/.test(methodParams);
  
  // Count parameters
  const paramCount = methodParams ? methodParams.split(',').length : 0;
  const hasMultipleParams = paramCount > 1;
  
  // Fallback: If we have vector param and more than 1 parameter, assume it's vector + something
  const hasMultipleParamsWithVector = hasVectorParam && hasMultipleParams;
  
  console.log('🔍 Method signature analysis:', {
    methodName,
    returnType,
    methodParams,
    hasVectorParam,
    hasIntParam,
    hasStringParam,
    hasLongParam,
    hasDoubleParam,
    paramCount,
    hasMultipleParams,
    hasMultipleParamsWithVector
  });
  
  let inputParsing = '';
  let methodCall = '';
  
  if (hasVectorParam && hasIntParam) {
    console.log('✅ Detected vector + int parameters (Two Sum pattern)');
    // For problems like Two Sum: [1,2,3], 5
    inputParsing = `
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
    }`;
    methodCall = `sol.${methodName}(nums, target)`;
  } else if (hasVectorParam && hasMultipleParams) {
    console.log('✅ Detected vector + multiple parameters (fallback for Two Sum pattern)');
    // Fallback for Two Sum pattern when regex detection fails
    inputParsing = `
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
    }`;
    methodCall = `sol.${methodName}(nums, target)`;
  } else if (hasVectorParam) {
    console.log('✅ Detected vector only parameters (Maximum Subarray pattern)');
    // For problems with only vector parameter like Maximum Subarray
    inputParsing = `
    string line;
    getline(cin, line);
    
    // Parse input: "[-2,1,-3,4,-1,2,1,-5,4]" -> vector<int>
    string arrStr = line.substr(1, line.length() - 2); // Remove [ and ]
    
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
    }`;
    methodCall = `sol.${methodName}(nums)`;
  } else if (hasStringParam) {
    console.log('✅ Detected string only parameters');
    // For problems with only string parameter
    inputParsing = `
    string s;
    getline(cin, s);
    // Remove quotes if present
    if (s.length() >= 2 && s[0] == '"' && s[s.length()-1] == '"') {
        s = s.substr(1, s.length() - 2);
    }`;
    methodCall = `sol.${methodName}(s)`;
  } else if (hasIntParam) {
    console.log('✅ Detected int only parameters');
    // For problems with only int parameter
    inputParsing = `
    int n;
    cin >> n;`;
    methodCall = `sol.${methodName}(n)`;
  } else if (hasLongParam) {
    console.log('✅ Detected long only parameters');
    // For problems with only long parameter
    inputParsing = `
    long n;
    cin >> n;`;
    methodCall = `sol.${methodName}(n)`;
  } else if (hasDoubleParam) {
    console.log('✅ Detected double only parameters');
    // For problems with only double parameter
    inputParsing = `
    double n;
    cin >> n;`;
    methodCall = `sol.${methodName}(n)`;
  } else {
    console.log('⚠️ No specific parameter pattern detected, using default');
    // Default case
    inputParsing = `
    string line;
    getline(cin, line);`;
    methodCall = `sol.${methodName}()`;
  }
  
  console.log('🔧 Generated input parsing:', inputParsing);
  console.log('🔧 Generated method call:', methodCall);
  
  // Determine output formatting based on return type
  let outputFormatting = '';
  if (returnType === 'vector<int>' || returnType === 'std::vector<int>' || returnType === 'vector<long>' || returnType === 'vector<double>' || returnType === 'vector<float>' || returnType === 'vector<bool>' || returnType === 'vector<string>') {
    outputFormatting = `
    if (result.empty()) {
        cout << "[]" << endl;
    } else {
        cout << "[" << result[0];
        for (size_t i = 1; i < result.size(); ++i) {
            cout << "," << result[i];
        }
        cout << "]" << endl;
    }`;
  } else if (returnType === 'bool') {
    outputFormatting = `
    cout << (result ? "true" : "false") << endl;`;
  } else if (returnType === 'string') {
    outputFormatting = `
    cout << result << endl;`;
  } else {
    outputFormatting = `
    cout << result << endl;`;
  }
  
  console.log('🔧 Generated output formatting:', outputFormatting);

  // Determine required includes based on user's code
  let requiredIncludes = ['#include <iostream>', '#include <vector>', '#include <string>', '#include <algorithm>'];
  
  if (cleanUserCode.includes('unordered_map')) {
    requiredIncludes.push('#include <unordered_map>');
  }
  if (cleanUserCode.includes('map') && !cleanUserCode.includes('unordered_map')) {
    requiredIncludes.push('#include <map>');
  }
  if (cleanUserCode.includes('set')) {
    requiredIncludes.push('#include <set>');
  }
  if (cleanUserCode.includes('queue')) {
    requiredIncludes.push('#include <queue>');
  }
  if (cleanUserCode.includes('stack')) {
    requiredIncludes.push('#include <stack>');
  }
  if (cleanUserCode.includes('deque')) {
    requiredIncludes.push('#include <deque>');
  }
  if (cleanUserCode.includes('list')) {
    requiredIncludes.push('#include <list>');
  }
  if (cleanUserCode.includes('cmath') || cleanUserCode.includes('math.h')) {
    requiredIncludes.push('#include <cmath>');
  }
  if (cleanUserCode.includes('cstring') || cleanUserCode.includes('string.h')) {
    requiredIncludes.push('#include <cstring>');
  }
  
  console.log('🔧 Required includes:', requiredIncludes);

  const finalCode = `${requiredIncludes.join('\n')}
using namespace std;

class Solution {
public:
${cleanUserCode}
};

int main() {
    Solution sol;${inputParsing}
    ${returnType} result = ${methodCall};${outputFormatting}
    return 0;
}`;
  
  console.log('🔧 Final generated code:', finalCode);
  
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
