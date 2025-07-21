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
  
  // The frontend already provides complete code, we just need to add input parsing
  // and replace hardcoded test cases with dynamic input
  
  let processedCode = cleanUserCode;
  
  // Replace hardcoded test cases with input parsing
  if (processedCode.includes('sol.twoSum([2, 7, 11, 15], 9)') || 
      processedCode.includes('sol.twoSum([3,2,4], 6)') ||
      processedCode.includes('sol.twoSum([3,3], 6)')) {
    
    console.log('🔧 Replacing hardcoded test cases with input parsing...');
    
    // Extract method name from the code
    const methodMatch = processedCode.match(/def\s+(\w+)\s*\(/);
    const methodName = methodMatch ? methodMatch[1] : 'twoSum';
    
    // Replace the hardcoded call with input parsing
    const inputParsing = `
# Parse input from stdin
line = input().strip()
parts = line.split('],')
arr_str = parts[0].replace('[', '').replace(']', '').strip()

# Handle empty array case
if arr_str == "":
    nums = []
else:
    arr_items = arr_str.split(',')
    nums = [int(item.strip()) for item in arr_items]
target = int(parts[1].strip())`;
    
    // Replace the hardcoded method call
    processedCode = processedCode.replace(
      /sol\.\w+\(\[[\d,\s]+\],\s*\d+\)/g,
      `sol.${methodName}(nums, target)`
    );
    
    // Insert input parsing before the method call
    processedCode = processedCode.replace(
      /(sol\.\w+\([^)]+\))/,
      `${inputParsing}\n\n$1`
    );
  }
  
  // Handle other problem types
  if (processedCode.includes('sol.isValid(') || processedCode.includes('sol.maxSubArray(') || 
      processedCode.includes('sol.isPalindrome(') || processedCode.includes('sol.removeDuplicates(')) {
    
    console.log('🔧 Replacing hardcoded test cases for other problems...');
    
    // Extract method name
    const methodMatch = processedCode.match(/def\s+(\w+)\s*\(/);
    const methodName = methodMatch ? methodMatch[1] : 'solve';
    
    // Replace hardcoded calls with input parsing
    if (processedCode.includes('sol.isValid(')) {
      // String input
      processedCode = processedCode.replace(
        /sol\.isValid\([^)]+\)/g,
        `s = input().strip().strip('"')
sol.isValid(s)`
      );
    } else if (processedCode.includes('sol.maxSubArray(') || processedCode.includes('sol.removeDuplicates(')) {
      // Array input
      processedCode = processedCode.replace(
        /sol\.\w+\(\[[\d,\s-]+\]\)/g,
        `line = input().strip()
arr_str = line.replace('[', '').replace(']', '').strip()
if arr_str == "":
    nums = []
else:
    arr_items = arr_str.split(',')
    nums = [int(item.strip()) for item in arr_items]
sol.${methodName}(nums)`
      );
    } else if (processedCode.includes('sol.isPalindrome(')) {
      // Integer input
      processedCode = processedCode.replace(
        /sol\.isPalindrome\(\d+\)/g,
        `x = int(input().strip())
sol.isPalindrome(x)`
      );
    }
  }
  
  // Ensure proper output formatting
  if (processedCode.includes('print(')) {
    processedCode = processedCode.replace(
      /print\s*\(\s*([^)]+)\s*\)/g,
      (match, content) => {
        if (content.includes('[') || content.includes('result') || content.includes('ans')) {
          return `print(str(${content}).replace(' ', ''))`;
        }
        return match;
      }
    );
  }
  
  console.log('🔧 Final processed code:', processedCode);
  return processedCode;
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
        console.error('Faileds to cleanup direct container:', e);
      }
    }
  }
}
