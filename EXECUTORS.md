# Code Executors Documentation

## Overview

The Submission Service includes three language-specific executors designed to handle code execution in isolated Docker containers. Each executor extracts function names from user code snippets, generates complete executable programs with test runners, and executes them securely.

## Architecture

### Problem Structure Analysis

Based on the provided problem structure, each problem contains:

```json
{
  "_id": "problem_id",
  "title": "Problem Title",
  "description": "Problem description",
  "difficulty": "easy/medium/hard",
  "testcases": [
    {
      "input": "input_value",
      "output": "expected_output"
    }
  ],
  "codeStubs": [
    {
      "language": "PYTHON/JAVA/CPP",
      "startSnippet": "class Solution:\n",
      "userSnippet": "    def isValid(self, s):\n        # your code here",
      "endSnippet": ""
    }
  ]
}
```

### Frontend Code Construction

The frontend constructs code by combining:
1. `startSnippet` (e.g., "class Solution:")
2. `userSnippet` (user's implementation)
3. `endSnippet` (closing braces/statements)

When submitting, only the `userSnippet` part is sent to the backend.

## Executor Design

### Common Features

All executors implement:

1. **Function Name Extraction**: Parse `userSnippet` to extract the function name
2. **Code Generation**: Combine snippets and add test runner
3. **Docker Execution**: Run in isolated containers with security constraints
4. **Output Parsing**: Parse test results and handle errors
5. **Resource Management**: Memory/CPU limits, timeouts, cleanup

### Security Measures

- **Container Isolation**: No network access, writable filesystem for compilation
- **Resource Limits**: 512MB memory, 50% CPU, 10-second timeout
- **Privilege Restrictions**: No new privileges, limited tmpfs
- **Input Validation**: Sanitize inputs before execution

## Language-Specific Executors

### Python Executor (`pythonExecutor.ts`)

**Docker Image**: `python:3.9-slim`

**Function Extraction**:
```typescript
// Extracts from: "def isValid(self, s):"
const functionMatch = userSnippet.match(/def\s+(\w+)\s*\(/);
```

**Code Generation**:
```python
class Solution:
    def isValid(self, s):
        # user code here

# Test Runner
if __name__ == "__main__":
    solution = Solution()
    test_cases = [
        ("()", "true"),
        ("()[]{}", "true"),
        # ... more test cases
    ]
    
    for i, (input_data, expected) in enumerate(test_cases, 1):
        try:
            result = solution.isValid(input_data)
            result_str = str(result).lower() if isinstance(result, bool) else str(result)
            print(f"TEST_{i}:{result_str}")
        except Exception as e:
            print(f"TEST_{i}:ERROR:{str(e)}")
```

**Execution Command**:
```bash
python /app/solution.py
```

### Java Executor (`javaExecutor.ts`)

**Docker Image**: `openjdk:11-jdk-slim`

**Function Extraction**:
```typescript
// Extracts from: "public boolean isValid(String s) {"
const functionMatch = userSnippet.match(/public\s+\w+\s+(\w+)\s*\(/);
```

**Code Generation**:
```java
public class Solution {
    public boolean isValid(String s) {
        // user code here
    }
    
    public static void main(String[] args) {
        Solution solution = new Solution();
        String[][] testCases = {
            {"\"()\"", "true"},
            {"\"()[]{}\"", "true"},
            // ... more test cases
        };
        
        for (int i = 0; i < testCases.length; i++) {
            try {
                String input = testCases[i][0];
                String expected = testCases[i][1];
                Object result = null;
                
                // Parse input based on expected type
                if (expected.equals("true") || expected.equals("false")) {
                    String cleanInput = input.replaceAll("\"", "");
                    result = solution.isValid(cleanInput);
                } else if (expected.matches("-?\\d+")) {
                    // Handle integer/array inputs
                    if (input.startsWith("[") && input.endsWith("]")) {
                        // Parse array
                        String[] parts = input.substring(1, input.length() - 1).split(",");
                        int[] nums = new int[parts.length];
                        for (int j = 0; j < parts.length; j++) {
                            nums[j] = Integer.parseInt(parts[j].trim());
                        }
                        result = solution.maxSubArray(nums);
                    } else {
                        // Single integer
                        int num = Integer.parseInt(input);
                        result = solution.isPalindrome(num);
                    }
                }
                
                String resultStr = String.valueOf(result).toLowerCase();
                System.out.println("TEST_" + (i + 1) + ":" + resultStr);
                
            } catch (Exception e) {
                System.out.println("TEST_" + (i + 1) + ":ERROR:" + e.getMessage());
            }
        }
    }
}
```

**Execution Command**:
```bash
javac Solution.java && java Solution
```

### C++ Executor (`cppExecutor.ts`)

**Docker Image**: `gcc:latest`

**Function Extraction**:
```typescript
// Extracts from: "bool isValid(std::string s) {"
const functionMatch = userSnippet.match(/\w+\s+(\w+)\s*\(/);
```

**Code Generation**:
```cpp
#include <stack>
#include <string>
#include <vector>
#include <iostream>
#include <sstream>
#include <regex>

class Solution {
public:
    bool isValid(std::string s) {
        // user code here
    }
};

int main() {
    Solution solution;
    std::vector<std::pair<std::string, std::string>> testCases = {
        {"\"()\"", "true"},
        {"\"()[]{}\"", "true"},
        // ... more test cases
    };
    
    for (int i = 0; i < testCases.size(); i++) {
        try {
            std::string input = testCases[i].first;
            std::string expected = testCases[i].second;
            std::string result;
            
            // Parse input based on expected type
            if (expected == "true" || expected == "false") {
                std::string cleanInput = input;
                if (cleanInput.front() == '"' && cleanInput.back() == '"') {
                    cleanInput = cleanInput.substr(1, cleanInput.length() - 2);
                }
                bool result_bool = solution.isValid(cleanInput);
                result = result_bool ? "true" : "false";
            } else if (std::regex_match(expected, std::regex("-?\\d+"))) {
                // Handle integer/array inputs
                if (input.front() == '[' && input.back() == ']') {
                    // Parse array
                    std::string arrayStr = input.substr(1, input.length() - 2);
                    std::vector<int> nums;
                    std::stringstream ss(arrayStr);
                    std::string item;
                    while (std::getline(ss, item, ',')) {
                        nums.push_back(std::stoi(item));
                    }
                    int result_int = solution.maxSubArray(nums);
                    result = std::to_string(result_int);
                } else {
                    // Single integer
                    int num = std::stoi(input);
                    int result_int = solution.isPalindrome(num);
                    result = std::to_string(result_int);
                }
            }
            
            std::cout << "TEST_" << (i + 1) << ":" << result << std::endl;
            
        } catch (const std::exception& e) {
            std::cout << "TEST_" << (i + 1) << ":ERROR:" << e.what() << std::endl;
        }
    }
    
    return 0;
}
```

**Execution Command**:
```bash
g++ -std=c++17 -O2 solution.cpp -o solution && ./solution
```

## Output Format

All executors produce standardized output:

```
TEST_1:true
TEST_2:true
TEST_3:false
TEST_4:false
TEST_5:true
```

Or for errors:
```
TEST_1:ERROR:Index out of range
TEST_2:ERROR:Division by zero
```

## Docker Container Configuration

### Security Settings

```typescript
HostConfig: {
  Memory: 512 * 1024 * 1024,        // 512MB memory limit
  MemorySwap: 0,                     // No swap
  CpuPeriod: 100000,
  CpuQuota: 50000,                   // 50% CPU limit
  NetworkMode: 'none',               // No network access
  SecurityOpt: ['no-new-privileges'], // No privilege escalation
  Tmpfs: {
    '/tmp': 'rw,noexec,nosuid,size=100m' // Limited tmpfs
  }
}
```

### Stream Processing

Docker logs include 8-byte headers that must be removed:

```typescript
function removeDockerHeaders(data: string): string {
  const lines = data.split('\n');
  const cleanLines = lines.map(line => {
    if (line.length >= 8) {
      return line.substring(8);
    }
    return line;
  });
  return cleanLines.join('\n');
}
```

## Error Handling

### Common Error Types

1. **Compilation Errors**: Syntax errors, missing imports
2. **Runtime Errors**: Exceptions, segmentation faults
3. **Timeout Errors**: Infinite loops, excessive computation
4. **Memory Errors**: Out of memory, stack overflow

### Error Response Format

```typescript
{
  output: "error_message",
  status: "error"
}
```

## Integration with Worker

The executors are called from the submission worker:

```typescript
switch (language) {
  case 'JAVA':
    execResult = await runJava(problem, userCode);
    break;
  case 'PYTHON':
    execResult = await runPython(problem, userCode);
    break;
  case 'CPP':
    execResult = await runCpp(problem, userCode);
    break;
  default:
    throw new Error(`Unsupported language: ${language}`);
}
```

## Testing

### Test Cases Supported

1. **Boolean Problems**: Return true/false
2. **Integer Problems**: Return single integers
3. **Array Problems**: Input arrays, return integers
4. **String Problems**: Input strings, return booleans/integers

### Input Parsing

Each executor handles different input types:

- **Strings**: Remove quotes, pass as string
- **Integers**: Parse as int
- **Arrays**: Parse comma-separated values into arrays
- **Booleans**: Handle true/false string conversion

## Performance Considerations

1. **Docker Image Caching**: Images are pulled once and reused
2. **Container Reuse**: New container per execution for security
3. **Resource Limits**: Prevent resource exhaustion
4. **Timeout Handling**: Kill containers after 10 seconds
5. **Cleanup**: Automatic cleanup of containers and temp files

## Deployment

### Prerequisites

1. Docker daemon running
2. Sufficient disk space for Docker images
3. Network access to pull Docker images
4. Proper permissions for Docker socket

### Environment Variables

```bash
DOCKER_HOST=unix:///var/run/docker.sock
REDIS_HOST=host.docker.internal
REDIS_PORT=6379
MONGO_URI=mongodb://...
```

## Monitoring and Logging

Each executor includes comprehensive logging:

- Container creation/startup
- Execution progress
- Output parsing
- Error handling
- Cleanup operations

Logs are prefixed with language-specific emojis for easy identification:
- 🐍 Python
- ☕ Java  
- ⚡ C++
- 🐳 Docker operations
- ⏰ Timeouts
- ❌ Errors
- ✅ Success 