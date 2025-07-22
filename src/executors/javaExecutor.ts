import Docker from 'dockerode';
import { Problem, ExecutionResponse } from '../types';

const JAVA_IMAGE = 'openjdk:11-jdk-slim';

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
    console.log(`✅ [JAVA] Image ${image} pulled successfully`);
  } catch (error) {
    console.error(`❌ [JAVA] Failed to pull image ${image}:`, error);
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
    console.log(`✅ [JAVA] Container created: ${container.id}`);
    return container;
  } catch (error) {
    console.error(`❌ [JAVA] Failed to create container:`, error);
    throw error;
  }
}

// Helper function to fetch decoded stream with timeout
function fetchDecodedStream(loggerStream: NodeJS.ReadableStream, rawLogBuffer: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log('⏰ [JAVA] Timer called - TLE');
      reject(new Error('TLE'));
    }, 4000);

    loggerStream.on('end', () => {
      clearTimeout(timer);
      console.log('📝 [JAVA] Stream ended, processing logs...');
      
      // Concatenate all collected log chunks into one complete buffer
      const completeStreamData = Buffer.concat(rawLogBuffer);
      
      // Decode the complete log stream
      const decodedStream = demultiplexDockerLogs(completeStreamData);
      
      console.log('🔍 [JAVA] Decoded stream:', {
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

export async function runJava(problem: Problem, userCode: string): Promise<ExecutionResponse> {
  console.log('🚀 [JAVA] Starting Java execution...');
  console.log('📋 [JAVA] Problem title:', problem.title);
  console.log('📋 [JAVA] User code length:', userCode.length);
  console.log('📋 [JAVA] Number of test cases:', problem.testcases?.length || 0);
  
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  let container: any = null;
  
  try {
    // Extract the Solution class content from user code
    let solutionContent = userCode;
    console.log('🔍 [JAVA] Original user code:', userCode.substring(0, 200) + '...');
    
    // If user provided full class, extract just the content
    if (userCode.includes('class Solution')) {
      console.log('🔍 [JAVA] Detected full class, extracting content...');
      const classMatch = userCode.match(/class Solution\s*\{([\s\S]*)\}/);
      if (classMatch) {
        solutionContent = classMatch[1].trim();
        console.log('🔍 [JAVA] Extracted class content length:', solutionContent.length);
      } else {
        console.log('⚠️ [JAVA] Could not extract class content, using full code');
      }
    } else {
      console.log('🔍 [JAVA] Using user code as-is (no class wrapper detected)');
    }
    
    // Extract method name and parameter type from user code
    const methodMatch = userCode.match(/public\s+(?:static\s+)?(?:int|long|double|float|boolean|String|void|List<.*>|int\[\]|long\[\]|double\[\]|float\[\]|boolean\[\]|String\[\])\s+(\w+)\s*\(([^)]*)\)/);
    const methodName = methodMatch ? methodMatch[1] : 'solve';
    const fullParam = methodMatch ? methodMatch[2].trim() : 'String s';
    
    // Extract just the type from the parameter (e.g., "String s" -> "String")
    const paramTypeMatch = fullParam.match(/^(\w+(?:<.*>)?(?:\[\])?)/);
    const paramType = paramTypeMatch ? paramTypeMatch[1] : 'String';
    
    console.log('🔍 [JAVA] Extracted method name:', methodName);
    console.log('🔍 [JAVA] Full parameter:', fullParam);
    console.log('🔍 [JAVA] Extracted parameter type:', paramType);
    console.log('🔍 [JAVA] Method regex match:', methodMatch ? 'Found' : 'Not found, using default "solve"');
    
    // Build the complete Java program
    const fullCode = [
      'import java.util.*;',
      'import java.util.Stack;',
      'import java.util.Queue;',
      'import java.util.LinkedList;',
      'import java.util.PriorityQueue;',
      'import java.util.HashMap;',
      'import java.util.HashSet;',
      'import java.util.ArrayList;',
      'import java.util.Arrays;',
      'import java.util.List;',
      'import java.util.Map;',
      'import java.util.Set;',
      '',
      'public class Main {',
      '    public static void main(String[] args) {',
      '        Scanner scanner = new Scanner(System.in);',
      '',
      '        // Read input',
      '        String input = scanner.nextLine();',
      '        scanner.close();',
      '',
      '        // Create solution instance',
      '        Solution solution = new Solution();',
      '',
      '        // Execute and print result',
      '        try {',
      '            // Remove quotes from input if present',
      '            String cleanInput = input;',
      '            if (input.startsWith("\\"") && input.endsWith("\\"")) {',
      '                cleanInput = input.substring(1, input.length() - 1);',
      '            }',
      '',
      '            // Parse input based on method signature',
      '            Object parsedInput;',
      `            String paramType = "${paramType}";`,
      '',
      '            // First, check if this is a string input (most common case)',
      '            if (paramType.equals("String")) {',
      '                // For String parameters, use the clean input directly',
      '                parsedInput = cleanInput;',
      '            } else if (cleanInput.startsWith("[") && cleanInput.endsWith("]")) {',
      '                // Parse array/list input',
      '                String arrayContent = cleanInput.substring(1, cleanInput.length() - 1);',
      '                if (arrayContent.isEmpty()) {',
      '                    // Empty array - determine type from method signature',
      '                    if (paramType.contains("int[]")) {',
      '                        parsedInput = new int[0];',
      '                    } else if (paramType.contains("String[]")) {',
      '                        parsedInput = new String[0];',
      '                    } else if (paramType.contains("double[]")) {',
      '                        parsedInput = new double[0];',
      '                    } else if (paramType.contains("boolean[]")) {',
      '                        parsedInput = new boolean[0];',
      '                    } else if (paramType.contains("List")) {',
      '                        if (paramType.contains("List<Integer>")) {',
      '                            parsedInput = new ArrayList<Integer>();',
      '                        } else if (paramType.contains("List<String>")) {',
      '                            parsedInput = new ArrayList<String>();',
      '                        } else if (paramType.contains("List<Double>")) {',
      '                            parsedInput = new ArrayList<Double>();',
      '                        } else {',
      '                            parsedInput = new ArrayList<>();',
      '                        }',
      '                    } else {',
      '                        parsedInput = new int[0]; // default',
      '                    }',
      '                } else {',
      '                    String[] elements = arrayContent.split(",");',
      '                    // Check if elements are quoted (strings) or numbers',
      '                    boolean isStringArray = elements[0].trim().startsWith("\\"") && elements[0].trim().endsWith("\\"");',
      '                    boolean isBooleanArray = elements[0].trim().equals("true") || elements[0].trim().equals("false");',
      '',
      '                    if (isStringArray) {',
      '                        // String array or List<String>',
      '                        if (paramType.contains("String[]")) {',
      '                            String[] stringArray = new String[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                String element = elements[i].trim();',
      '                                stringArray[i] = element.substring(1, element.length() - 1);',
      '                            }',
      '                            parsedInput = stringArray;',
      '                        } else if (paramType.contains("List<String>")) {',
      '                            List<String> stringList = new ArrayList<>();',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                String element = elements[i].trim();',
      '                                stringList.add(element.substring(1, element.length() - 1));',
      '                            }',
      '                            parsedInput = stringList;',
      '                        } else {',
      '                            // Default to String array',
      '                            String[] stringArray = new String[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                String element = elements[i].trim();',
      '                                stringArray[i] = element.substring(1, element.length() - 1);',
      '                            }',
      '                            parsedInput = stringArray;',
      '                        }',
      '                    } else if (isBooleanArray) {',
      '                        // Boolean array or List<Boolean>',
      '                        if (paramType.contains("boolean[]")) {',
      '                            boolean[] boolArray = new boolean[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                boolArray[i] = Boolean.parseBoolean(elements[i].trim());',
      '                            }',
      '                            parsedInput = boolArray;',
      '                        } else if (paramType.contains("List<Boolean>")) {',
      '                            List<Boolean> boolList = new ArrayList<>();',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                boolList.add(Boolean.parseBoolean(elements[i].trim()));',
      '                            }',
      '                            parsedInput = boolList;',
      '                        } else {',
      '                            boolean[] boolArray = new boolean[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                boolArray[i] = Boolean.parseBoolean(elements[i].trim());',
      '                            }',
      '                            parsedInput = boolArray;',
      '                        }',
      '                    } else {',
      '                        // Number array - try to determine type',
      '                        try {',
      '                            // Check if any element has decimal point',
      '                            boolean hasDecimal = false;',
      '                            for (String element : elements) {',
      '                                if (element.trim().contains(".")) {',
      '                                    hasDecimal = true;',
      '                                    break;',
      '                                }',
      '                            }',
      '',
      '                            if (hasDecimal) {',
      '                                // Double array or List<Double>',
      '                                if (paramType.contains("double[]")) {',
      '                                    double[] doubleArray = new double[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        doubleArray[i] = Double.parseDouble(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = doubleArray;',
      '                                } else if (paramType.contains("List<Double>")) {',
      '                                    List<Double> doubleList = new ArrayList<>();',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        doubleList.add(Double.parseDouble(elements[i].trim()));',
      '                                    }',
      '                                    parsedInput = doubleList;',
      '                                } else {',
      '                                    double[] doubleArray = new double[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        doubleArray[i] = Double.parseDouble(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = doubleArray;',
      '                                }',
      '                            } else {',
      '                                // Integer array or List<Integer>',
      '                                if (paramType.contains("int[]")) {',
      '                                    int[] intArray = new int[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        intArray[i] = Integer.parseInt(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = intArray;',
      '                                } else if (paramType.contains("List<Integer>")) {',
      '                                    List<Integer> intList = new ArrayList<>();',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        intList.add(Integer.parseInt(elements[i].trim()));',
      '                                    }',
      '                                    parsedInput = intList;',
      '                                } else {',
      '                                    int[] intArray = new int[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        intArray[i] = Integer.parseInt(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = intArray;',
      '                                }',
      '                            }',
      '                        } catch (NumberFormatException e) {',
      '                            // Fallback to String array',
      '                            String[] stringArray = new String[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                stringArray[i] = elements[i].trim();',
      '                            }',
      '                            parsedInput = stringArray;',
      '                        }',
      '                    }',
      '                }',
      '            } else if (cleanInput.equals("true") || cleanInput.equals("false")) {',
      '                // Boolean input',
      '                parsedInput = Boolean.parseBoolean(cleanInput);',
      '            } else if (cleanInput.length() == 1) {',
      '                // Single character',
      '                parsedInput = cleanInput.charAt(0);',
      '            } else {',
      '                // Try to parse as number, otherwise use as string',
      '                try {',
      '                    if (cleanInput.contains(".")) {',
      '                        if (paramType.contains("double")) {',
      '                            parsedInput = Double.parseDouble(cleanInput);',
      '                        } else if (paramType.contains("float")) {',
      '                            parsedInput = Float.parseFloat(cleanInput);',
      '                        } else {',
      '                            parsedInput = Double.parseDouble(cleanInput);',
      '                        }',
      '                    } else {',
      '                        if (paramType.contains("long")) {',
      '                            parsedInput = Long.parseLong(cleanInput);',
      '                        } else if (paramType.contains("int")) {',
      '                            parsedInput = Integer.parseInt(cleanInput);',
      '                        } else {',
      '                            parsedInput = Integer.parseInt(cleanInput);',
      '                        }',
      '                    }',
      '                } catch (NumberFormatException e) {',
      '                    parsedInput = cleanInput; // Use as string',
      '                }',
      '            }',
      '',
      '            // Call the solution method with parsed input',
      '            Object result;',
      '            if (paramType.equals("String")) {',
      `                result = solution.${methodName}((String) parsedInput);`,
      '            } else if (paramType.equals("int[]")) {',
      `                result = solution.${methodName}((int[]) parsedInput);`,
      '            } else if (paramType.equals("String[]")) {',
      `                result = solution.${methodName}((String[]) parsedInput);`,
      '            } else if (paramType.equals("double[]")) {',
      `                result = solution.${methodName}((double[]) parsedInput);`,
      '            } else if (paramType.equals("boolean[]")) {',
      `                result = solution.${methodName}((boolean[]) parsedInput);`,
      '            } else if (paramType.equals("List<Integer>")) {',
      `                result = solution.${methodName}((List<Integer>) parsedInput);`,
      '            } else if (paramType.equals("List<String>")) {',
      `                result = solution.${methodName}((List<String>) parsedInput);`,
      '            } else if (paramType.equals("List<Double>")) {',
      `                result = solution.${methodName}((List<Double>) parsedInput);`,
      '            } else if (paramType.equals("List<Boolean>")) {',
      `                result = solution.${methodName}((List<Boolean>) parsedInput);`,
      '            } else if (paramType.equals("int")) {',
      `                result = solution.${methodName}((Integer) parsedInput);`,
      '            } else if (paramType.equals("double")) {',
      `                result = solution.${methodName}((Double) parsedInput);`,
      '            } else if (paramType.equals("float")) {',
      `                result = solution.${methodName}((Float) parsedInput);`,
      '            } else if (paramType.equals("long")) {',
      `                result = solution.${methodName}((Long) parsedInput);`,
      '            } else if (paramType.equals("boolean")) {',
      `                result = solution.${methodName}((Boolean) parsedInput);`,
      '            } else if (paramType.equals("char")) {',
      `                result = solution.${methodName}((Character) parsedInput);`,
      '            } else {',
      '                // Default fallback - try to cast to String',
      `                result = solution.${methodName}((String) parsedInput);`,
      '            }',
      '            System.out.println(result);',
      '        } catch (Exception e) {',
      '            System.err.println("Error: " + e.getMessage());',
      '        }',
      '    }',
      '',
      '    static class Solution {',
      `        ${solutionContent}`,
      '    }',
      '}'
    ].join('\n');

    console.log('📝 [JAVA] Generated code length:', fullCode.length);
    console.log('📝 [JAVA] Generated code preview:', fullCode.substring(0, 500) + '...');
    
    // Prepare test cases
    const testCases = problem.testcases || [];
    console.log(`🧪 [JAVA] Processing ${testCases.length} test cases`);
    
    let allOutputs = '';
    let passedTests = 0;
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const input = testCase.input;
      const expectedOutput = testCase.output;
      
      console.log(`🧪 [JAVA] Running test case ${i + 1}/${testCases.length}`);
      console.log(`📥 [JAVA] Test case ${i + 1} input:`, input);
      console.log(`📥 [JAVA] Test case ${i + 1} expected output:`, expectedOutput);
      
      // Create the run command using heredoc to avoid escaping issues
      const runCommand = `cat > Main.java << 'EOF'
${fullCode}
EOF
javac Main.java && echo '${input}' | java Main`;
      
      console.log('🔧 [JAVA] Run command length:', runCommand.length);
      
      // Pull image if needed
      await pullImage(docker, JAVA_IMAGE);
      
      // Create and start container
      container = await createContainer(docker, JAVA_IMAGE, ['/bin/sh', '-c', runCommand]);
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
        
        console.log(`📊 [JAVA] Test ${i + 1} - Raw response: "${codeResponse}"`);
        console.log(`📊 [JAVA] Test ${i + 1} - Trimmed response: "${trimmedResponse}"`);
        console.log(`📊 [JAVA] Test ${i + 1} - Expected: "${trimmedExpected}"`);
        console.log(`📊 [JAVA] Test ${i + 1} - Match: ${trimmedResponse === trimmedExpected ? '✅ PASS' : '❌ FAIL'}`);
        
        if (trimmedResponse === trimmedExpected) {
          passedTests++;
          console.log(`✅ [JAVA] Test ${i + 1} passed!`);
        } else {
          console.log(`❌ [JAVA] Test ${i + 1} failed!`);
        }
        allOutputs += `${trimmedResponse}\n`;
        console.log(`📝 [JAVA] Added to allOutputs: "${trimmedResponse}"`);
        
              } catch (error) {
          if (error instanceof Error) {
            console.log(`❌ [JAVA] Test ${i + 1} error:`, error.message);
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
    console.log(`✅ [JAVA] Execution completed: ${passedTests}/${testCases.length} tests passed`);
    console.log(`📊 [JAVA] Final status: ${status}`);
    console.log(`📝 [JAVA] Final output:`, allOutputs);
    console.log(`📝 [JAVA] Output length:`, allOutputs.length);
    
    return { output: allOutputs, status };
    
  } catch (error) {
    console.error('❌ [JAVA] Execution error:', error);
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
        console.error('❌ [JAVA] Failed to remove container:', error);
      }
    }
  }
}