# Docker-Enabled Standardized Executor System

## Overview

The Docker-Enabled Standardized Executor System provides individual, language-specific executors (Java, Python, C++) that work for any problem structure using Docker containers for secure, isolated execution. Each executor follows the same standardized approach while being optimized for its specific language and includes proper Docker output stream handling.

## Key Features

### ✅ **Docker-Based Execution**
- **Secure isolation** - Each execution runs in a separate container
- **Resource limits** - Memory and CPU limits for each container
- **Network isolation** - No network access for security
- **Automatic cleanup** - Containers are automatically removed after execution

### ✅ **Real-Time Output Streaming**
- **8-byte header handling** - Proper Docker log stream demultiplexing
- **Real-time logs** - Live output streaming during execution
- **Separate stdout/stderr** - Proper separation of output and error streams
- **Buffer management** - Efficient handling of Docker's multiplexed streams

### ✅ **Standardized Approach**
- Each language has its own dedicated executor
- Consistent interface across all executors
- No hardcoded function names or problem types
- Automatic method name extraction from code stubs
- Universal input/output handling

### ✅ **Language-Specific Optimization**
- **Java**: Uses `openjdk:11-jdk-slim` image
- **Python**: Uses `python:3.9-slim` image
- **C++**: Uses `gcc:11-slim` image

## Docker Output Stream Handling

### **8-Byte Header Format**
Docker uses a multiplexed stream format with 8-byte headers:

```
[stream type (1 byte)][padding (3 bytes)][payload size (4 bytes)][payload data]
```

- **Stream type 1**: stdout
- **Stream type 2**: stderr
- **Payload size**: Length of the actual data

### **Demultiplexing Function**
```typescript
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
```

## Executor Architecture

### **Java Executor** (`javaExecutor.ts`)
```typescript
export class JavaExecutor {
  generateCode(): string          // Combines snippets + generates test runner
  private generateTestRunner(): string  // Creates main method with test cases
  private extractMethodName(): string   // Extracts method name from userSnippet
}

export async function runJava(problem: Problem, userCode: string)
```

**Docker Configuration:**
- **Image**: `openjdk:11-jdk-slim`
- **Command**: `cd /tmp && javac Solution.java && java Solution`
- **Memory Limit**: 512MB
- **CPU Limit**: 50%

### **Python Executor** (`pythonExecutor.ts`)
```typescript
export class PythonExecutor {
  generateCode(): string          // Combines snippets + generates test runner
  private generateTestRunner(): string  // Creates if __name__ == "__main__" block
  private extractMethodName(): string   // Extracts method name from userSnippet
}

export async function runPython(problem: Problem, userCode: string)
```

**Docker Configuration:**
- **Image**: `python:3.9-slim`
- **Command**: `python3 /tmp/solution.py`
- **Memory Limit**: 512MB
- **CPU Limit**: 50%

### **C++ Executor** (`cppExecutor.ts`)
```typescript
export class CppExecutor {
  generateCode(): string          // Combines snippets + generates test runner
  private generateTestRunner(): string  // Creates main function with test cases
  private extractMethodName(): string   // Extracts method name from userSnippet
}

export async function runCpp(problem: Problem, userCode: string)
```

**Docker Configuration:**
- **Image**: `gcc:11-slim`
- **Command**: `cd /tmp && g++ -std=c++17 -o solution solution.cpp && ./solution`
- **Memory Limit**: 512MB
- **CPU Limit**: 50%

## Execution Flow

### **1. Container Creation**
```typescript
const container = await docker.createContainer({
  Image: 'openjdk:11-jdk-slim',
  name: containerName,
  Cmd: ['sh', '-c', `cd /tmp && javac ${filename} && java Solution`],
  HostConfig: {
    Memory: 512 * 1024 * 1024, // 512MB limit
    MemorySwap: 512 * 1024 * 1024,
    CpuPeriod: 100000,
    CpuQuota: 50000, // 50% CPU limit
    NetworkMode: 'none', // No network access
    Binds: [`${filepath}:/tmp/${filename}:ro`], // Read-only mount
    AutoRemove: true,
    SecurityOpt: ['no-new-privileges'],
    CapDrop: ['ALL']
  },
  WorkingDir: '/tmp'
});
```

### **2. Real-Time Log Streaming**
```typescript
const logStream = await container.logs({
  follow: true,
  stdout: true,
  stderr: true,
  tail: 'all'
});

logStream.on('data', (chunk: Buffer) => {
  // Accumulate buffer
  logsBuffer = Buffer.concat([logsBuffer, chunk]);
  
  // Demultiplex if we have enough data
  if (logsBuffer.length >= 8) {
    const demuxed = demultiplexDockerLogs(logsBuffer);
    stdout += demuxed.stdout;
    stderr += demuxed.stderr;
    
    // Log real-time output
    if (demuxed.stdout) {
      console.log('📤 STDOUT:', demuxed.stdout.trim());
    }
    if (demuxed.stderr) {
      console.log('❌ STDERR:', demuxed.stderr.trim());
    }
  }
});
```

### **3. Container Cleanup**
```typescript
logStream.on('end', async () => {
  const containerData = await container.inspect();
  const exitCode = containerData.State.ExitCode;
  
  // Clean up
  await container.remove();
  await unlink(filepath).catch(console.error);
  
  resolve({ stdout, stderr });
});
```

## Security Features

### **Container Security**
- **Network isolation**: `NetworkMode: 'none'`
- **Read-only mounts**: `Binds: [filepath + ':ro']`
- **No new privileges**: `SecurityOpt: ['no-new-privileges']`
- **Dropped capabilities**: `CapDrop: ['ALL']`
- **Auto-removal**: `AutoRemove: true`

### **Resource Limits**
- **Memory**: 512MB per container
- **CPU**: 50% CPU limit
- **Timeout**: 10 seconds execution timeout
- **File system**: Read-only access to code files

## Supported Languages

### **Java**
- **Image**: `openjdk:11-jdk-slim`
- **Method extraction**: `public returnType methodName(...)`
- **Test runner**: `public static void main(String[] args)`
- **Execution**: `javac Solution.java && java Solution`
- **File naming**: `Solution_${timestamp}.java`

### **Python**
- **Image**: `python:3.9-slim`
- **Method extraction**: `def methodName(...)`
- **Test runner**: `if __name__ == "__main__"`
- **Execution**: `python3 solution.py`
- **File naming**: `solution_${timestamp}.py`

### **C++**
- **Image**: `gcc:11-slim`
- **Method extraction**: `returnType methodName(...)`
- **Test runner**: `int main()`
- **Execution**: `g++ -std=c++17 -o solution solution.cpp && ./solution`
- **File naming**: `solution_${timestamp}.cpp`

## Error Handling

### **Container Errors**
- **Timeout handling**: Automatic container stop after 10 seconds
- **Resource limits**: Memory/CPU limit violations
- **Network isolation**: No external network access
- **File system**: Read-only access prevents file system attacks

### **Stream Errors**
- **Demultiplexing errors**: Graceful handling of malformed streams
- **Buffer management**: Proper accumulation and processing
- **Real-time logging**: Live output for debugging

### **Cleanup Errors**
- **Container removal**: Automatic cleanup with error handling
- **File cleanup**: Temporary file removal
- **Resource cleanup**: Memory and CPU limit enforcement

## Performance Considerations

### **Container Startup**
- **Image caching**: Docker images are cached after first pull
- **Container reuse**: Each execution uses a fresh container
- **Resource limits**: Prevents resource exhaustion

### **Stream Processing**
- **Buffer accumulation**: Efficient handling of Docker's multiplexed streams
- **Real-time output**: Immediate feedback during execution
- **Memory management**: Proper cleanup of accumulated buffers

## Example Usage

### **Valid Parentheses Problem**
```json
{
  "title": "Valid Parentheses",
  "testcases": [
    {"input": "\"()\"", "output": "true"},
    {"input": "\"()[]{}\"", "output": "true"},
    {"input": "\"(]\"", "output": "false"}
  ],
  "codeStubs": [
    {
      "language": "PYTHON",
      "startSnippet": "class Solution:\n",
      "userSnippet": "    def isValid(self, s):\n        # your code here",
      "endSnippet": ""
    }
  ]
}
```

### **Execution Logs**
```
🚀 [PYTHON-DOCKER] Starting Python execution with Docker...
📥 Problem: Valid Parentheses
📥 User code length: 45
🔧 Generated Python code: [code content]
📝 [PYTHON-DOCKER] Code written to: /tmp/solution_1234567890.py
📦 [PYTHON-DOCKER] Pulling Python image...
🐳 [PYTHON-DOCKER] Creating container...
✅ [PYTHON-DOCKER] Container created: abc123def456
▶️ [PYTHON-DOCKER] Starting container...
📤 [PYTHON-DOCKER] Raw log chunk received, size: 24
📤 [PYTHON-DOCKER] STDOUT: TEST_1:true
📤 [PYTHON-DOCKER] STDOUT: TEST_2:true
📤 [PYTHON-DOCKER] STDOUT: TEST_3:false
🏁 [PYTHON-DOCKER] Log stream ended
📊 [PYTHON-DOCKER] Container exit code: 0
```

## File Structure

```
src/executors/
├── javaExecutor.ts      # Java-specific Docker executor
├── pythonExecutor.ts    # Python-specific Docker executor
└── cppExecutor.ts       # C++-specific Docker executor
```

Each executor includes:
- Docker container management
- 8-byte header demultiplexing
- Real-time output streaming
- Security configurations
- Resource limits
- Automatic cleanup 