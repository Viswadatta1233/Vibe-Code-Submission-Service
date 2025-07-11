import Docker from 'dockerode';
import { writeFile } from 'fs-extra';
import { dir } from 'tmp-promise';

export const PYTHON_IMAGE = 'python:3.8-slim';
export const JAVA_IMAGE = 'eclipse-temurin:17';
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
function testRegexPatterns() {
  const testCode = `public int[] twoSum(int[] nums, int target) {
Map<Integer, Integer> map = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        if (map.containsKey(complement)) {
            return new int[]{map.get(complement), i};
        }
        map.put(nums[i], i);
    }
    return new int[0];

    }`;
  
  console.log('🧪 Testing regex patterns with:', testCode);
  
  // Test method name extraction
  const methodMatch = testCode.match(/public\s+(?:static\s+)?(?:int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+(\w+)\s*\(/);
  console.log('🧪 Method name match:', methodMatch);
  
  // Test method signature extraction
  const methodSignatureMatch = testCode.match(/public\s+(?:static\s+)?(?:int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+\w+\s*\(([^)]*)\)/);
  console.log('🧪 Method signature match:', methodSignatureMatch);
  
  // Test parameter detection
  const methodParams = methodSignatureMatch ? methodSignatureMatch[1].trim() : '';
  console.log('🧪 Method params:', methodParams);
  
  const hasArrayParam = /int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\]/.test(methodParams);
  const hasIntParam = /\bint\s+\w+/.test(methodParams) && !/int\[\]/.test(methodParams);
  
  console.log('🧪 hasArrayParam:', hasArrayParam);
  console.log('🧪 hasIntParam:', hasIntParam);
  console.log('🧪 Combined condition (hasArrayParam && hasIntParam):', hasArrayParam && hasIntParam);
}

// Java code template for user submissions
function buildJavaCode(fullCode: string): string {
  console.log('🔧 Building Java code with input:', fullCode);
  
  // Run test patterns first
  testRegexPatterns();
  
  // If the code already contains 'public class Main', just return as is
  if (/public\s+class\s+Main/.test(fullCode)) {
    console.log('📝 Code already contains Main class, applying patch...');
    // Patch: Replace Arrays.toString(result) with Arrays.toString(result).replaceAll(", ", ",") in user code
    return fullCode.replace(
      /System\.out\.println\(Arrays\.toString\(([^)]*)\)\);/g,
      'System.out.println(Arrays.toString($1).replaceAll(", ", ","));'
    );
  }

  // Extract method name from user's code
  const methodMatch = fullCode.match(/public\s+(?:static\s+)?(?:int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+(\w+)\s*\(/);
  const methodName = methodMatch ? methodMatch[1] : 'solve';
  console.log('📋 Extracted method name:', methodName);
  
  // Extract return type from user's code
  const returnTypeMatch = fullCode.match(/public\s+(?:static\s+)?(int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+\w+\s*\(/);
  const returnType = returnTypeMatch ? returnTypeMatch[1] : 'int';
  console.log('📋 Extracted return type:', returnType);
  
  // Extract method parameters by parsing the method signature
  const methodSignatureMatch = fullCode.match(/public\s+(?:static\s+)?(?:int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+\w+\s*\(([^)]*)\)/);
  const methodParams = methodSignatureMatch ? methodSignatureMatch[1].trim() : '';
  console.log('📋 Extracted method parameters:', methodParams);
  
  // Parse parameters more accurately
  const hasArrayParam = /int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\]/.test(methodParams);
  const hasIntParam = /\bint\s+\w+/.test(methodParams) && !/int\[\]/.test(methodParams);
  const hasStringParam = /\bString\s+\w+/.test(methodParams) && !/String\[\]/.test(methodParams);
  const hasLongParam = /\blong\s+\w+/.test(methodParams) && !/long\[\]/.test(methodParams);
  const hasDoubleParam = /\bdouble\s+\w+/.test(methodParams) && !/double\[\]/.test(methodParams);
  
  // Count parameters
  const paramCount = methodParams ? methodParams.split(',').length : 0;
  
  // Fallback: If we have array param and more than 1 parameter, assume it's array + something
  const hasMultipleParams = paramCount > 1;
  
  console.log('🔍 Method signature analysis:', {
    methodName,
    returnType,
    methodParams,
    hasArrayParam,
    hasIntParam,
    hasStringParam,
    hasLongParam,
    hasDoubleParam,
    paramCount,
    hasMultipleParams
  });
  
  let inputParsing = '';
  let methodCall = '';
  
  if (hasArrayParam && hasIntParam) {
    console.log('✅ Detected array + int parameters (Two Sum pattern)');
    // For problems like Two Sum: [1,2,3], 5
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();
        String[] parts = line.split("],");
        String arrStr = parts[0].replace("[", "").replace("]", "").trim();
        
        // Handle empty array case
        int[] nums;
        if (arrStr.isEmpty()) {
            nums = new int[0];
        } else {
            String[] arrItems = arrStr.split(",");
            nums = new int[arrItems.length];
            for (int i = 0; i < arrItems.length; i++) {
                nums[i] = Integer.parseInt(arrItems[i].trim());
            }
        }
        int target = Integer.parseInt(parts[1].trim());`;
    methodCall = `sol.${methodName}(nums, target)`;
  } else if (hasArrayParam && hasMultipleParams) {
    console.log('✅ Detected array + multiple parameters (fallback for Two Sum pattern)');
    // Fallback for Two Sum pattern when regex detection fails
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();
        String[] parts = line.split("],");
        String arrStr = parts[0].replace("[", "").replace("]", "").trim();
        
        // Handle empty array case
        int[] nums;
        if (arrStr.isEmpty()) {
            nums = new int[0];
        } else {
            String[] arrItems = arrStr.split(",");
            nums = new int[arrItems.length];
            for (int i = 0; i < arrItems.length; i++) {
                nums[i] = Integer.parseInt(arrItems[i].trim());
            }
        }
        int target = Integer.parseInt(parts[1].trim());`;
    methodCall = `sol.${methodName}(nums, target)`;
  } else if (hasArrayParam && hasStringParam) {
    console.log('✅ Detected array + string parameters');
    // For problems with array and string parameters
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();
        String[] parts = line.split("],");
        String arrStr = parts[0].replace("[", "").replace("]", "").trim();
        
        // Handle empty array case
        int[] nums;
        if (arrStr.isEmpty()) {
            nums = new int[0];
        } else {
            String[] arrItems = arrStr.split(",");
            nums = new int[arrItems.length];
            for (int i = 0; i < arrItems.length; i++) {
                nums[i] = Integer.parseInt(arrItems[i].trim());
            }
        }
        String s = parts[1].replace("\"", "").trim();`;
    methodCall = `sol.${methodName}(nums, s)`;
  } else if (hasArrayParam) {
    console.log('✅ Detected array only parameters (Maximum Subarray pattern)');
    // For problems with only array parameter like Maximum Subarray
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();
        String arrStr = line.replace("[", "").replace("]", "").trim();
        
        // Handle empty array case
        int[] nums;
        if (arrStr.isEmpty()) {
            nums = new int[0];
        } else {
            String[] arrItems = arrStr.split(",");
            nums = new int[arrItems.length];
            for (int i = 0; i < arrItems.length; i++) {
                nums[i] = Integer.parseInt(arrItems[i].trim());
            }
        }`;
    methodCall = `sol.${methodName}(nums)`;
  } else if (hasStringParam) {
    console.log('✅ Detected string only parameters');
    // For problems with only string parameter
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        String s = sc.nextLine().trim();
        // Remove quotes if present
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            s = s.substring(1, s.length() - 1);
        }`;
    methodCall = `sol.${methodName}(s)`;
  } else if (hasIntParam) {
    console.log('✅ Detected int only parameters');
    // For problems with only int parameter
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        int n = Integer.parseInt(sc.nextLine().trim());`;
    methodCall = `sol.${methodName}(n)`;
  } else if (hasLongParam) {
    console.log('✅ Detected long only parameters');
    // For problems with only long parameter
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        long n = Long.parseLong(sc.nextLine().trim());`;
    methodCall = `sol.${methodName}(n)`;
  } else if (hasDoubleParam) {
    console.log('✅ Detected double only parameters');
    // For problems with only double parameter
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        double n = Double.parseDouble(sc.nextLine().trim());`;
    methodCall = `sol.${methodName}(n)`;
  } else {
    console.log('⚠️ No specific parameter pattern detected, using default');
    // Default case
    inputParsing = `
        Scanner sc = new Scanner(System.in);
        String line = sc.nextLine().trim();`;
    methodCall = `sol.${methodName}()`;
  }
  
  console.log('🔧 Generated input parsing:', inputParsing);
  console.log('🔧 Generated method call:', methodCall);
  
  // Determine output formatting based on return type
  let outputFormatting = '';
  if (returnType === 'int[]' || returnType === 'long[]' || returnType === 'double[]' || returnType === 'float[]' || returnType === 'boolean[]' || returnType === 'String[]') {
    outputFormatting = `System.out.println(Arrays.toString(result).replaceAll(", ", ","));`;
  } else if (returnType === 'List<') {
    outputFormatting = `System.out.println(result.toString().replaceAll(", ", ","));`;
  } else if (returnType === 'boolean') {
    outputFormatting = `System.out.println(result);`;
  } else if (returnType === 'String') {
    outputFormatting = `System.out.println(result);`;
  } else {
    outputFormatting = `System.out.println(result);`;
  }
  
  console.log('🔧 Generated output formatting:', outputFormatting);

  const finalCode = `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {${inputParsing}\n        Solution sol = new Solution();\n        ${returnType} result = ${methodCall};\n        ${outputFormatting}\n    }\n}\n\nclass Solution {\n${fullCode}\n}\n`;
  
  console.log('🔧 Final generated code:', finalCode);
  
  return finalCode;
}

export async function runJava(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🚀 Starting Java execution...');
  console.log('📥 Input code:', fullCode);
  console.log('📥 Input data:', input);
  
  const docker = new Docker();
  const { path, cleanup } = await dir({ unsafeCleanup: true });
  const codeToRun = buildJavaCode(fullCode);
  const filePath = `${path}/Main.java`;
  
  console.log('📁 Writing code to file:', filePath);
  console.log('📄 Code to run:', codeToRun);
  
  try {
    // Write the code to file
    await writeFile(filePath, codeToRun);
    console.log('✅ Code written to file successfully');
    
    // Verify file was written
    const fs = require('fs');
    const fileExists = fs.existsSync(filePath);
    console.log('🔍 File exists check:', fileExists);
    if (fileExists) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      console.log('📄 File content length:', fileContent.length);
    }
    
    // Pull the image before creating the container
    console.log('📦 Pulling Java image...');
    await docker.pull(JAVA_IMAGE);
    console.log('✅ Java image pulled successfully');
    
    // Create container with more explicit volume mounting
    console.log('🔨 Creating Java container...');
    const container = await docker.createContainer({
      Image: JAVA_IMAGE,
      Cmd: ['sh', '-c', `cd /usr/src/app && ls -la && cat Main.java && javac Main.java && echo ${JSON.stringify(input)} | java Main`],
      HostConfig: { 
        Binds: [`${path}:/usr/src/app:ro`], 
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
    
    // Parse logs
    let stdout = '', stderr = '';
    const logBuffer = Buffer.from(logs);
    
    // Docker logs come with 8-bit headers for stream multiplexing
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
      
      // Stream type: 1 = stdout, 2 = stderr
      if (streamType === 1) {
        stdout += payload;
      } else if (streamType === 2) {
        stderr += payload;
      }
      
      offset += 8 + size;
    }
    
    console.log('📤 Container stdout:', stdout);
    console.log('📤 Container stderr:', stderr);
    
    // Remove container
    await container.remove();
    console.log('🗑️ Container removed');
    
    // If the first approach failed, try alternative approach
    if (stderr.includes('file not found') || stderr.includes('Main.java')) {
      console.log('🔄 First approach failed, trying alternative method...');
      return await runJavaAlternative(fullCode, input);
    }
    
    return { 
      stdout: stdout.trim(), 
      stderr: stderr.trim() 
    };
    
  } catch (err: any) {
    console.error('❌ Error in Java execution:', err);
    
    // If it's a timeout error, try to kill the container
    if (err.message.includes('timeout')) {
      try {
        const containers = await docker.listContainers({ all: true });
        const runningContainer = containers.find((c: any) => c.Image.includes('eclipse-temurin'));
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

// Alternative approach using exec instead of logs
export async function runJavaAlternative(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🔄 Using alternative Java execution method...');
  const docker = new Docker();
  const { path, cleanup } = await dir({ unsafeCleanup: true });
  const codeToRun = buildJavaCode(fullCode);
  const filePath = `${path}/Main.java`;
  await writeFile(filePath, codeToRun);
  let container: any = null;
  
  try {
    await docker.pull(JAVA_IMAGE);
    
    container = await docker.createContainer({
      Image: JAVA_IMAGE,
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
      Cmd: ['javac', 'Main.java'],
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
      Cmd: ['sh', '-c', `echo "${input}" | java Main`],
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
    console.error('Alternative Java execution failed:', err);
    
    // Try third approach - create file directly in container
    console.log('🔄 Trying third approach - direct file creation...');
    return await runJavaDirect(fullCode, input);
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
export async function runJavaDirect(fullCode: string, input: string): Promise<{ stdout: string, stderr: string }> {
  console.log('🔄 Using direct file creation method...');
  const docker = new Docker();
  const codeToRun = buildJavaCode(fullCode);
  let container: any = null;
  
  try {
    await docker.pull(JAVA_IMAGE);
    
    // Use a simpler approach with printf to avoid shell escaping issues
    const container = await docker.createContainer({
      Image: JAVA_IMAGE,
      Cmd: ['sh', '-c', `
        printf '%s' '${codeToRun.replace(/'/g, "'\"'\"'")}' > Main.java
        javac Main.java
        echo '${input.replace(/'/g, "'\"'\"'")}' | java Main
      `],
      HostConfig: { 
        AutoRemove: false,
        Memory: 512 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 50000,
        NetworkMode: 'none',
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
    
    const logBuffer = Buffer.from(logs);
    let stdout = '', stderr = '';
    let offset = 0;
    
    while (offset < logBuffer.length) {
      if (offset + 8 > logBuffer.length) break;
      
      const streamType = logBuffer[offset];
      const size = logBuffer.readUInt32BE(offset + 4);
      
      if (offset + 8 + size > logBuffer.length) break;
      
      const payload = logBuffer.slice(offset + 8, offset + 8 + size).toString();
      
      if (streamType === 1) {
        stdout += payload;
      } else if (streamType === 2) {
        stderr += payload;
      }
      
      offset += 8 + size;
    }
    
    await container.remove();
    
    console.log('✅ [DIRECT] Java execution completed successfully');
    console.log('📤 [DIRECT] stdout:', stdout);
    console.log('📤 [DIRECT] stderr:', stderr);
    
    return { stdout: stdout.trim(), stderr: stderr.trim() };
    
  } catch (err: any) {
    console.error('❌ [DIRECT] Direct Java execution failed:', err);
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