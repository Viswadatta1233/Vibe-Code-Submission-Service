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
  console.log('🚀 Starting Python execution...');
  console.log('📥 Input code:', fullCode);
  console.log('📥 Input data:', input);
  
  // Use the direct method as primary approach since volume mounting is unreliable
  console.log('🔄 Using direct file creation method as primary approach...');
  return await runPythonDirect(fullCode, input);
}

// Alternative approach using exec instead of logs
export async function runPythonAlternative(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🔄 Using alternative Python execution method...');
  const docker = new Docker();
  const { path, cleanup } = await dir({ unsafeCleanup: true });
  const codeToRun = buildPythonCode(fullCode);
  const filePath = `${path}/main.py`;
  await writeFile(filePath, codeToRun);
  let container: any = null;
  
  try {
    await docker.pull(PYTHON_IMAGE);
    
    container = await docker.createContainer({
      Image: PYTHON_IMAGE,
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
    
    // Execute the program
    const runExec = await container.exec({
      Cmd: ['sh', '-c', `echo "${input}" | python main.py`],
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
    console.error('Alternative Python execution failed:', err);
    
    // Try third approach - create file directly in container
    console.log('🔄 Trying third approach - direct file creation...');
    return await runPythonDirect(fullCode, input);
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
export async function runPythonDirect(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🔄 Using direct file creation method...');
  const docker = new Docker();
  const codeToRun = buildPythonCode(fullCode);
  let container: any = null;
  
  try {
    // Use python:3.8-slim directly since it should be available
    const selectedImage = 'python:3.8-slim';
    console.log(`🚀 Using image: ${selectedImage}`);
    
    // Use a safer approach with base64 encoding to avoid shell escaping issues
    const codeToRunBase64 = Buffer.from(codeToRun).toString('base64');
    const inputBase64 = Buffer.from(input).toString('base64');
    
    const container = await docker.createContainer({
      Image: selectedImage,
      Cmd: ['sh', '-c', `
        echo '${codeToRunBase64}' | base64 -d > main.py
        echo '${inputBase64}' | base64 -d | python main.py
      `],
      HostConfig: { 
        AutoRemove: false,
        Memory: 512 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 50000,
        NetworkMode: 'none', // No network needed since Python is pre-installed
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
    
    console.log('✅ [DIRECT] Python execution completed successfully');
    console.log('📤 [DIRECT] stdout:', stdout);
    console.log('📤 [DIRECT] stderr:', stderr);
    
    return { stdout, stderr };
    
  } catch (err: any) {
    console.error('❌ [DIRECT] Direct Python execution failed:', err);
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
