import Docker from 'dockerode';
import { writeFile } from 'fs-extra';
import { dir } from 'tmp-promise';

export const PYTHON_IMAGE = 'python:3.8-slim';
export const JAVA_IMAGE = 'openjdk:17-slim';
export const CPP_IMAGE = 'gcc:latest';

// Python code template for user submissions
function buildPythonCode(fullCode: string): string {
  console.log('🔧 Building Python code with input:', fullCode);
  
  // Clean up the user code
  const cleanUserCode = fullCode.trim();
  console.log('🧹 Cleaned user code:', cleanUserCode);
  
  // Extract method name from user's code
  const methodMatch = cleanUserCode.match(/def\s+(\w+)\s*\(/);
  const methodName = methodMatch ? methodMatch[1] : 'solve';
  console.log('📋 Extracted method name:', methodName);
  
  // Extract method parameters by parsing the method signature
  const methodSignatureMatch = cleanUserCode.match(/def\s+\w+\s*\(([^)]*)\)/);
  let methodParams = methodSignatureMatch ? methodSignatureMatch[1].trim() : '';
  
  // Clean up type hints from parameters (e.g., "self, x: int" -> "self, x")
  methodParams = methodParams.replace(/:\s*\w+(?:\[.*?\])?/g, '');
  
  console.log('📋 Extracted method parameters:', methodParams);
  
  // Extract individual parameter names (excluding self)
  const paramNames = methodParams.split(',').map(p => p.trim()).filter(p => p !== 'self');
  console.log('🔍 Individual parameter names:', paramNames);
  
  // Count parameters (excluding self)
  const paramCount = paramNames.length;
  const hasMultipleParams = paramCount > 1;
  
  console.log('🔍 Method signature analysis:', {
    methodName,
    methodParams,
    paramNames,
    paramCount,
    hasMultipleParams
  });
  
  let inputParsing = '';
  let methodCall = '';
  
  // Simple logic based on parameter count (like Java/C++)
  if (paramCount === 0) {
    console.log('✅ Detected no parameters');
    inputParsing = `
# Parse input and run the solution
import sys
# No input needed`;
    methodCall = `sol.${methodName}()`;
  } else if (paramCount === 1) {
    console.log('✅ Detected single parameter');
    const paramName = paramNames[0];
    
    // Simple input parsing based on parameter name pattern
    if (paramName === 's' || paramName === 'str') {
      inputParsing = `
# Parse input and run the solution
import sys
${paramName} = input().strip()
# Remove quotes if present
if ${paramName}.startswith('"') and ${paramName}.endswith('"'):
    ${paramName} = ${paramName}[1:-1]`;
    } else if (paramName === 'nums' || paramName === 'prices') {
      // Array parameter
      inputParsing = `
# Parse input and run the solution
import sys
line = input().strip()
arr_str = line.replace('[', '').replace(']', '').strip()

# Handle empty array case
if arr_str == "":
    ${paramName} = []
else:
    arr_items = arr_str.split(',')
    ${paramName} = [int(item.strip()) for item in arr_items]`;
    } else {
      // Assume integer parameter
      inputParsing = `
# Parse input and run the solution
import sys
${paramName} = int(input().strip())`;
    }
    methodCall = `sol.${methodName}(${paramName})`;
  } else if (paramCount === 2) {
    console.log('✅ Detected two parameters');
    const [param1, param2] = paramNames;
    
    // Check if it's array + target pattern
    if ((param1 === 'nums' || param1 === 'prices') && param2 === 'target') {
      inputParsing = `
# Parse input and run the solution
import sys
line = input().strip()
parts = line.split('],')
arr_str = parts[0].replace('[', '').replace(']', '').strip()

# Handle empty array case
if arr_str == "":
    ${param1} = []
else:
    arr_items = arr_str.split(',')
    ${param1} = [int(item.strip()) for item in arr_items]
${param2} = int(parts[1].strip())`;
    } else {
      // Generic two parameter parsing
      inputParsing = `
# Parse input and run the solution
import sys
line = input().strip()
parts = line.split(',')
${param1} = int(parts[0].strip())
${param2} = int(parts[1].strip())`;
    }
    methodCall = `sol.${methodName}(${param1}, ${param2})`;
  } else {
    console.log('⚠️ Multiple parameters detected, using generic parsing');
    // Generic parsing for multiple parameters
    const paramAssignments = paramNames.map((param, index) => {
      if (param === 's' || param === 'str') {
        return `${param} = input().strip()`;
      } else {
        return `${param} = int(input().strip())`;
      }
    }).join('\n');
    
    inputParsing = `
# Parse input and run the solution
import sys
${paramAssignments}`;
    methodCall = `sol.${methodName}(${paramNames.join(', ')})`;
  }
  
  console.log('🔧 Generated input parsing:', inputParsing);
  console.log('🔧 Generated method call:', methodCall);
  
  // Indent user code by 4 spaces for class method
  const indentedUserCode = cleanUserCode.split('\n').map(line => '    ' + line).join('\n');
  
  const finalCode = `# This code will run in the testing environment

class Solution:
${indentedUserCode}

${inputParsing}

sol = Solution()
result = ${methodCall}
# Format output to match expected format (no spaces in lists, lowercase booleans)
if isinstance(result, list):
    print(str(result).replace(' ', ''))
elif isinstance(result, bool):
    print(str(result).lower())
else:
    print(result)`;
  
  console.log('🔧 Final generated code:', finalCode);
  
  return finalCode;
}

export async function runPython(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  const docker = new Docker();
  const { path, cleanup } = await dir({ unsafeCleanup: true });
  const codeToRun = buildPythonCode(fullCode);
  const filePath = `${path}/main.py`;
  
  try {
    // Write the code to file
    await writeFile(filePath, codeToRun);
    
    console.log('🔍 Python Executor Debug:');
    console.log('📥 Input fullCode:', fullCode);
    console.log('📄 Generated Python code:');
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
    console.log('📦 Pulling Python image...');
    await docker.pull(PYTHON_IMAGE);
    console.log('✅ Python image pulled successfully');
    
    // Create container
    console.log('🔨 Creating Python container...');
    const container = await docker.createContainer({
      Image: PYTHON_IMAGE,
      Cmd: ['sh', '-c', `echo ${JSON.stringify(input)} | python main.py`],
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
    
    // Parse logs using the same approach as Java and C++ executors
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
    
  } catch (err: any) {
    console.error('❌ Error in Python execution:', err);
    
    // If it's a timeout error, try to kill the container
    if (err.message.includes('timeout')) {
      try {
        const containers = await docker.listContainers({ all: true });
        const runningContainer = containers.find((c: any) => c.Image.includes('python'));
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
