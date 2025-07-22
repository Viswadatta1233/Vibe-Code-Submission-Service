import Docker from 'dockerode';
import { Problem, ExecutionResponse } from '../types';

const CPP_IMAGE = 'gcc:latest';

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
    console.log(`✅ [CPP] Image ${image} pulled successfully`);
  } catch (error) {
    console.error(`❌ [CPP] Failed to pull image ${image}:`, error);
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
    console.log(`✅ [CPP] Container created: ${container.id}`);
    return container;
  } catch (error) {
    console.error(`❌ [CPP] Failed to create container:`, error);
    throw error;
  }
}

// Helper function to fetch decoded stream with timeout
function fetchDecodedStream(loggerStream: NodeJS.ReadableStream, rawLogBuffer: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log('⏰ [CPP] Timer called - TLE');
      reject(new Error('TLE'));
    }, 4000);

    loggerStream.on('end', () => {
      clearTimeout(timer);
      console.log('📝 [CPP] Stream ended, processing logs...');
      
      // Concatenate all collected log chunks into one complete buffer
      const completeStreamData = Buffer.concat(rawLogBuffer);
      
      // Decode the complete log stream
      const decodedStream = demultiplexDockerLogs(completeStreamData);
      
      console.log('🔍 [CPP] Decoded stream:', {
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

export async function runCpp(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('🚀 [CPP] Starting C++ execution...');
  console.log('📋 [CPP] Problem title:', problem.title);
  console.log('📋 [CPP] User code length:', userCode.length);
  console.log('📋 [CPP] Number of test cases:', problem.testcases?.length || 0);
  
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  let container: any = null;
  
  try {
    // Extract the Solution class content from user code
    let solutionContent = userCode;
    console.log('🔍 [CPP] Original user code:', userCode.substring(0, 200) + '...');
    
    // If user provided full class, extract just the content
    if (userCode.includes('class Solution')) {
      console.log('🔍 [CPP] Detected full class, extracting content...');
      const classMatch = userCode.match(/class Solution\s*\{([\s\S]*)\}/);
      if (classMatch) {
        solutionContent = classMatch[1].trim();
        console.log('🔍 [CPP] Extracted class content length:', solutionContent.length);
      } else {
        console.log('⚠️ [CPP] Could not extract class content, using full code');
      }
    } else {
      console.log('🔍 [CPP] Using user code as-is (no class wrapper detected)');
    }
    
    // Extract method name and parameter type from user code
    const methodMatch = userCode.match(/(?:int|long|double|float|bool|string|void|std::vector<.*>|vector<.*>|int\[\]|long\[\]|double\[\]|float\[\]|bool\[\]|string\[\])\s+(\w+)\s*\(([^)]*)\)/);
    const methodName = methodMatch ? methodMatch[1] : 'solve';
    const fullParam = methodMatch ? methodMatch[2].trim() : 'string s';
    
    // Extract just the type from the parameter (e.g., "string s" -> "string")
    const paramTypeMatch = fullParam.match(/^(\w+(?:<.*>)?(?:\[\])?)/);
    const paramType = paramTypeMatch ? paramTypeMatch[1] : 'string';
    
    console.log('🔍 [CPP] Extracted method name:', methodName);
    console.log('🔍 [CPP] Full parameter:', fullParam);
    console.log('🔍 [CPP] Extracted parameter type:', paramType);
    console.log('🔍 [CPP] Method regex match:', methodMatch ? 'Found' : 'Not found, using default "solve"');
    
    // Build the complete C++ program
    const fullCode = [
      '#include <iostream>',
      '#include <vector>',
      '#include <string>',
      '#include <algorithm>',
      '#include <unordered_map>',
      '#include <unordered_set>',
      '#include <queue>',
      '#include <stack>',
      '#include <map>',
      '#include <set>',
      '#include <cmath>',
      '#include <climits>',
      '#include <cstring>',
      '#include <sstream>',
      '#include <fstream>',
      '#include <iomanip>',
      '#include <numeric>',
      '#include <functional>',
      '#include <bitset>',
      '#include <deque>',
      '#include <list>',
      '#include <array>',
      '#include <tuple>',
      '#include <utility>',
      '#include <memory>',
      '#include <chrono>',
      '#include <random>',
      '#include <cassert>',
      '#include <cctype>',
      '#include <cstdlib>',
      '#include <cstdio>',
      '#include <cstring>',
      '#include <ctime>',
      '#include <cwchar>',
      '#include <cwctype>',
      '',
      'using namespace std;',
      '',
      'class Solution {',
      `    ${solutionContent}`,
      '};',
      '',
      'int main() {',
      '    // Read input from stdin',
      '    string input;',
      '    getline(cin, input);',
      '',
      '    // Create solution instance',
      '    Solution solution;',
      '',
      '    // Execute and print result',
      '    try {',
      '        // Remove quotes from input if present',
      '        string cleanInput = input;',
      '        if (input.length() >= 2 && input[0] == \'"\' && input[input.length()-1] == \'"\') {',
      '            cleanInput = input.substr(1, input.length() - 2);',
      '        }',
      '',
      '        // Parse input based on format and method signature',
      `        string paramType = "${paramType}";`,
      '',
      '        // First, check if this is a string input (most common case)',
      '        if (paramType == "string" || paramType == "std::string") {',
      '            // For string parameters, use the clean input directly',
      '            auto result = solution.${methodName}(cleanInput);',
      '            cout << result << endl;',
      '        } else if (cleanInput.length() >= 2 && cleanInput[0] == \'[\' && cleanInput[cleanInput.length()-1] == \']\') {',
      '            // Parse array/vector input',
      '            string arrayContent = cleanInput.substr(1, cleanInput.length() - 2);',
      '            if (arrayContent.empty()) {',
      '                // Empty array - determine type from method signature',
      '                if (paramType == "vector<int>" || paramType == "int[]") {',
      '                    vector<int> intArray;',
      `                    auto result = solution.${methodName}(intArray);`,
      '                    cout << result << endl;',
      '                } else if (paramType == "vector<string>" || paramType == "string[]") {',
      '                    vector<string> stringArray;',
      `                    auto result = solution.${methodName}(stringArray);`,
      '                    cout << result << endl;',
      '                } else if (paramType == "vector<double>" || paramType == "double[]") {',
      '                    vector<double> doubleArray;',
      `                    auto result = solution.${methodName}(doubleArray);`,
      '                    cout << result << endl;',
      '                } else if (paramType == "vector<bool>" || paramType == "bool[]") {',
      '                    vector<bool> boolArray;',
      `                    auto result = solution.${methodName}(boolArray);`,
      '                    cout << result << endl;',
      '                } else {',
      '                    vector<int> intArray; // default',
      `                    auto result = solution.${methodName}(intArray);`,
      '                    cout << result << endl;',
      '                }',
      '            } else {',
      '                stringstream ss(arrayContent);',
      '                string item;',
      '                vector<string> elements;',
      '                while (getline(ss, item, \',\')) {',
      '                    elements.push_back(item);',
      '                }',
      '',
      '                // Check if elements are quoted (strings) or numbers',
      '                bool isStringArray = !elements.empty() && elements[0].length() >= 2 && elements[0][0] == \'"\' && elements[0][elements[0].length()-1] == \'"\';',
      '                bool isBooleanArray = !elements.empty() && (elements[0] == "true" || elements[0] == "false");',
      '',
      '                if (isStringArray) {',
      '                    // String array',
      '                    vector<string> stringArray;',
      '                    for (const string& element : elements) {',
      '                        string trimmed = element;',
      '                        if (trimmed.length() >= 2 && trimmed[0] == \'"\' && trimmed[trimmed.length()-1] == \'"\') {',
      '                            stringArray.push_back(trimmed.substr(1, trimmed.length() - 2));',
      '                        } else {',
      '                            stringArray.push_back(trimmed);',
      '                        }',
      '                    }',
      `                    auto result = solution.${methodName}(stringArray);`,
      '                    cout << result << endl;',
      '                } else if (isBooleanArray) {',
      '                    // Boolean array',
      '                    vector<bool> boolArray;',
      '                    for (const string& element : elements) {',
      '                        boolArray.push_back(element == "true");',
      '                    }',
      `                    auto result = solution.${methodName}(boolArray);`,
      '                    cout << result << endl;',
      '                } else {',
      '                    // Number array - try to determine type',
      '                    bool hasDecimal = false;',
      '                    for (const string& element : elements) {',
      '                        if (element.find(\'.\') != string::npos) {',
      '                            hasDecimal = true;',
      '                            break;',
      '                        }',
      '                    }',
      '',
      '                    if (hasDecimal) {',
      '                        // Double array',
      '                        vector<double> doubleArray;',
      '                        for (const string& element : elements) {',
      '                            doubleArray.push_back(stod(element));',
      '                        }',
      `                        auto result = solution.${methodName}(doubleArray);`,
      '                        cout << result << endl;',
      '                    } else {',
      '                        // Integer array',
      '                        vector<int> intArray;',
      '                        for (const string& element : elements) {',
      '                            intArray.push_back(stoi(element));',
      '                        }',
      `                        auto result = solution.${methodName}(intArray);`,
      '                        cout << result << endl;',
      '                    }',
      '                }',
      '            }',
      '        } else if (cleanInput == "true" || cleanInput == "false") {',
      '            // Boolean input',
      '            bool boolValue = (cleanInput == "true");',
      `            auto result = solution.${methodName}(boolValue);`,
      '            cout << result << endl;',
      '        } else if (cleanInput.length() == 1) {',
      '            // Single character',
      '            char charValue = cleanInput[0];',
      `            auto result = solution.${methodName}(charValue);`,
      '            cout << result << endl;',
      '        } else {',
      '            // Try to parse as number, otherwise use as string',
      '            if (paramType == "string" || paramType == "std::string") {',
      '                // For string parameters, use the clean input directly',
      '                auto result = solution.${methodName}(cleanInput);',
      '                cout << result << endl;',
      '            } else if (cleanInput.find(\'.\') != string::npos) {',
      '                // Double input',
      '                double doubleValue = stod(cleanInput);',
      `                auto result = solution.${methodName}(doubleValue);`,
      '                cout << result << endl;',
      '            } else {',
      '                try {',
      '                    // Integer input',
      '                    int intValue = stoi(cleanInput);',
      `                    auto result = solution.${methodName}(intValue);`,
      '                    cout << result << endl;',
      '                } catch (const exception& e) {',
      '                    // String input',
      `                    auto result = solution.${methodName}(cleanInput);`,
      '                    cout << result << endl;',
      '                }',
      '            }',
      '        }',
      '    } catch (const exception& e) {',
      '        cerr << "Error: " << e.what() << endl;',
      '    }',
      '',
      '    return 0;',
      '}'
    ].join('\n');
  
    console.log('📝 [CPP] Generated code length:', fullCode.length);
    console.log('📝 [CPP] Generated code preview:', fullCode.substring(0, 500) + '...');
    
    // Prepare test cases
    const testCases = problem.testcases || [];
    console.log(`🧪 [CPP] Processing ${testCases.length} test cases`);
    
    let allOutputs = '';
    let passedTests = 0;
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const input = testCase.input;
      const expectedOutput = testCase.output;
      
      console.log(`🧪 [CPP] Running test case ${i + 1}/${testCases.length}`);
      console.log(`📥 [CPP] Test case ${i + 1} input:`, input);
      console.log(`📥 [CPP] Test case ${i + 1} expected output:`, expectedOutput);
      
      // Create the run command using heredoc to avoid escaping issues
      const runCommand = `cat > main.cpp << 'EOF'
${fullCode}
EOF
g++ -std=c++17 -O2 -o main main.cpp && echo '${input}' | ./main`;
      
      console.log('🔧 [CPP] Run command length:', runCommand.length);
      
      // Pull image if needed
      await pullImage(docker, CPP_IMAGE);
      
      // Create and start container
      container = await createContainer(docker, CPP_IMAGE, ['/bin/sh', '-c', runCommand]);
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
        
        console.log(`📊 [CPP] Test ${i + 1} - Raw response: "${codeResponse}"`);
        console.log(`📊 [CPP] Test ${i + 1} - Trimmed response: "${trimmedResponse}"`);
        console.log(`📊 [CPP] Test ${i + 1} - Expected: "${trimmedExpected}"`);
        console.log(`📊 [CPP] Test ${i + 1} - Match: ${trimmedResponse === trimmedExpected ? '✅ PASS' : '❌ FAIL'}`);
        
        if (trimmedResponse === trimmedExpected) {
          passedTests++;
          console.log(`✅ [CPP] Test ${i + 1} passed!`);
        } else {
          console.log(`❌ [CPP] Test ${i + 1} failed!`);
        }
        allOutputs += `${trimmedResponse}\n`;
        console.log(`📝 [CPP] Added to allOutputs: "${trimmedResponse}"`);
        
              } catch (error) {
          if (error instanceof Error) {
            console.log(`❌ [CPP] Test ${i + 1} error:`, error.message);
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
    console.log(`✅ [CPP] Execution completed: ${passedTests}/${testCases.length} tests passed`);
    console.log(`📊 [CPP] Final status: ${status}`);
    console.log(`📝 [CPP] Final output:`, allOutputs);
    console.log(`📝 [CPP] Output length:`, allOutputs.length);
    
    return { output: allOutputs, status };
    
  } catch (error) {
    console.error('❌ [CPP] Execution error:', error);
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
        console.error('❌ [CPP] Failed to remove container:', error);
      }
    }
  }
}