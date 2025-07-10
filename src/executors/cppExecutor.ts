import Docker from 'dockerode';
import { writeFile } from 'fs-extra';
import { dir } from 'tmp-promise';

export const PYTHON_IMAGE = 'python:3.8-slim';
export const JAVA_IMAGE = 'openjdk:17-slim';
export const CPP_IMAGE = 'gcc:latest';

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
    cout << "[" << result[0];
    for (size_t i = 1; i < result.size(); ++i) {
        cout << "," << result[i];
    }
    cout << "]" << endl;`;
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
  const docker = new Docker();
  const { path, cleanup } = await dir({ unsafeCleanup: true });
  
  console.log('🚀 C++ Executor Debug:');
  console.log('📥 Input fullCode:', fullCode);
  console.log('📥 Input length:', fullCode.length);
  
  const codeToRun = buildCppCode(fullCode);
  console.log('📄 Code to run length:', codeToRun.length);
  console.log('📄 Code to run first 100 chars:', codeToRun.substring(0, 100));
  
  const filePath = `${path}/main.cpp`;
  
  try {
    // Write the code to file
    await writeFile(filePath, codeToRun);
    console.log('✅ File written successfully to:', filePath);
    
    console.log('🔍 Debug Info:');
    console.log('📥 Input user code:', fullCode);
    console.log('📄 Generated C++ code:');
    console.log('='.repeat(50));
    console.log(codeToRun);
    console.log('='.repeat(50));
    console.log('📥 Test input:', input);
    console.log('📁 File written to:', filePath);
    
    // Also read back the file to verify it was written correctly
    const fs = require('fs');
    const writtenCode = fs.readFileSync(filePath, 'utf8');
    console.log('📖 File content verification:');
    console.log('📖 Written code length:', writtenCode.length);
    console.log('📖 Written code first 100 chars:', writtenCode.substring(0, 100));
    console.log('📖 Full written code:');
    console.log('='.repeat(50));
    console.log(writtenCode);
    console.log('='.repeat(50));
    
    // Pull the image before creating the container
    console.log('📦 Pulling C++ image...');
    let imagePulled = false;
    const gccImages = ['gcc:latest', 'gcc:11', 'gcc:10', 'gcc:9'];
    
    for (const image of gccImages) {
      try {
        console.log(`🔄 Trying to pull ${image}...`);
        await docker.pull(image);
        console.log(`✅ ${image} pulled successfully`);
        imagePulled = true;
        // Update the image name for container creation
        const container = await docker.createContainer({
          Image: image,
          Cmd: ['sh', '-c', `g++ main.cpp -o main && echo ${JSON.stringify(input)} | ./main`],
          HostConfig: { 
            Binds: [`${path}:/usr/src/app`], 
            AutoRemove: false, // Don't auto-remove so we can get logs
            Memory: 512 * 1024 * 1024, // 512MB memory limit
            CpuPeriod: 100000,
            CpuQuota: 50000, // 50% CPU limit
            NetworkMode: 'none', // Disable network for security
          },
          WorkingDir: '/usr/src/app',
          Tty: false,
          OpenStdin: true,
          StdinOnce: false,
        });
        
        console.log('✅ Container created:', container.id);
        
        // Start the container
        await container.start();
        console.log('🚀 Container started');
        
        // Wait for container to finish with timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Container execution timeout (30s)')), 30000);
        });
        
        const waitPromise = container.wait();
        const result = await Promise.race([waitPromise, timeoutPromise]) as any;
        console.log('⏹️ Container finished with exit code:', result.StatusCode);
        
        // Get container logs
        const logs = await container.logs({
          stdout: true,
          stderr: true,
          tail: 1000
        });
        
        console.log('🔍 Raw Docker logs debug:');
        console.log('📊 Logs buffer length:', logs.length);
        console.log('📊 Logs buffer:', logs);
        console.log('📊 Logs as string:', logs.toString());
        console.log('📊 Logs as hex:', logs.toString('hex'));
        
        // Parse logs using the same approach as Java executor
        let stdout = '', stderr = '';
        const logBuffer = Buffer.from(logs);
        
        // Docker logs come with 8-byte headers for stream multiplexing
        // Format: [stream_type][size][payload]
        let offset = 0;
        while (offset < logBuffer.length) {
          if (offset + 8 > logBuffer.length) break;
          
          // Read the header
          const streamType = logBuffer[offset];
          const size = logBuffer.readUInt32BE(offset + 4);
          
          if (offset + 8 + size > logBuffer.length) break;
          
          // Extract the payload
          const payload = logBuffer.slice(offset + 8, offset + 8 + size).toString();
          
          console.log('🔍 Stream type:', streamType, 'Size:', size, 'Payload:', payload);
          
          // Stream type: 1 = stdout, 2 = stderr
          if (streamType === 1) {
            stdout += payload;
          } else if (streamType === 2) {
            stderr += payload;
          }
          
          offset += 8 + size;
        }
        
        console.log('✅ Container logs parsing successful');
        console.log('📤 Parsed stdout:', stdout);
        console.log('📤 Parsed stderr:', stderr);
        
        // Remove container
        await container.remove();
        console.log('🗑️ Container removed');
        
        return { 
          stdout: stdout.trim(), 
          stderr: stderr.trim() 
        };
        
      } catch (pullErr) {
        console.log(`❌ Failed to pull ${image}:`, pullErr);
        continue;
      }
    }
    
    if (!imagePulled) {
      throw new Error('Failed to pull any GCC image. Please check Docker connectivity.');
    }
    
    // This should never be reached, but TypeScript needs it
    return { stdout: '', stderr: 'Failed to execute C++ code' };
    
  } catch (err: any) {
    console.error('❌ Error in C++ execution:', err);
    
    // If it's a timeout error, try to kill the container
    if (err.message.includes('timeout')) {
      try {
        const containers = await docker.listContainers({ all: true });
        const runningContainer = containers.find((c: any) => c.Image.includes('gcc'));
        if (runningContainer) {
          const container = docker.getContainer(runningContainer.Id);
          await container.kill();
          await container.remove();
          console.log('🛑 Killed and removed timeout container');
        }
      } catch (killErr) {
        console.error('Failed to kill timeout container:', killErr);
      }
    }
    
    return { 
      stdout: '', 
      stderr: err.message || 'Unknown error occurred' 
    };
  } finally {
    await cleanup();
  }
}
