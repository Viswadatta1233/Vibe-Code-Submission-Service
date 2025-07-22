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
    console.log('🔍 [JAVA] Param type match:', paramTypeMatch);

    const paramType = paramTypeMatch ? paramTypeMatch[1] : 'String';
    console.log('🔍 [JAVA] Param type:', paramType);
    
    console.log('🔍 [JAVA] Extracted method name:', methodName);
    console.log('🔍 [JAVA] Method name:', methodName);
    console.log('🔍 [JAVA] Full parameter:', fullParam);
    console.log('🔍 [JAVA] Extracted parameter type:', paramType);
    console.log('🔍 [JAVA] Method name:', methodName);
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
      '        // Debug output that will be visible during compilation',
      '        System.out.println("DEBUG: Starting Java execution");',
      '',
      '        Scanner scanner = new Scanner(System.in);',
      '',
      '        // Read input',
      '        String input = scanner.nextLine();',
      '        scanner.close();',
      '',
      '        try {',
      '            // Create solution instance',
      '            Solution solution = new Solution();',
      '',
      '            // Parse input based on method signature',
      `            String paramType = "${paramType}";`,
      '            System.out.println("DEBUG: paramType = " + paramType);',
      '            System.out.println("DEBUG: raw input = " + input);',
      '',
      '            // Remove outer quotes if present',
      '            String cleanInput = input;',
      '            if (cleanInput.startsWith("\\"") && cleanInput.endsWith("\\"")) {',
      '                cleanInput = cleanInput.substring(1, cleanInput.length() - 1);',
      '            }',
      '            System.out.println("DEBUG: cleanInput = " + cleanInput);',
      '            System.out.println("DEBUG: cleanInput.length() = " + cleanInput.length());',
      '            System.out.println("DEBUG: cleanInput.startsWith(\\"[\\") = " + cleanInput.startsWith("["));',
      '            System.out.println("DEBUG: cleanInput.endsWith(\\"]\\") = " + cleanInput.endsWith("]"));',
      '            System.out.println("DEBUG: cleanInput.length() > 2 = " + (cleanInput.length() > 2));',
      '',
      '            Object parsedInput;',
      '',
      '            // First, check if this is a string input (most common case)',
      '            if (paramType.equals("String")) {',
      '                System.out.println("DEBUG: String parameter detected - using cleanInput directly");',
      '                // For String parameters, use the clean input directly',
      '                parsedInput = cleanInput;',
      '                System.out.println("DEBUG: String parameter detected, parsedInput = " + parsedInput);',
      '            } else if (cleanInput.startsWith("[") && cleanInput.endsWith("]") && cleanInput.length() > 2) {',
      '                System.out.println("DEBUG: Array input detected");',
      '                // Parse array/list input - only if it\'s actually an array (not just brackets)',
      '                String arrayContent = cleanInput.substring(1, cleanInput.length() - 1);',
      '                System.out.println("DEBUG: arrayContent = " + arrayContent);',
      '                if (arrayContent.isEmpty()) {',
      '                    System.out.println("DEBUG: Empty array detected");',
      '                    // Empty array - determine type from method signature',
      '                    if (paramType.equals("int[]")) {',
      '                        parsedInput = new int[0];',
      '                        System.out.println("DEBUG: Created empty int[]");',
      '                    } else if (paramType.equals("String[]")) {',
      '                        parsedInput = new String[0];',
      '                        System.out.println("DEBUG: Created empty String[]");',
      '                    } else if (paramType.equals("double[]")) {',
      '                        parsedInput = new double[0];',
      '                        System.out.println("DEBUG: Created empty double[]");',
      '                    } else if (paramType.equals("boolean[]")) {',
      '                        parsedInput = new boolean[0];',
      '                        System.out.println("DEBUG: Created empty boolean[]");',
      '                    } else if (paramType.equals("List<Integer>")) {',
      '                        parsedInput = new ArrayList<Integer>();',
      '                        System.out.println("DEBUG: Created empty List<Integer>");',
      '                    } else if (paramType.equals("List<String>")) {',
      '                        parsedInput = new ArrayList<String>();',
      '                        System.out.println("DEBUG: Created empty List<String>");',
      '                    } else if (paramType.equals("List<Double>")) {',
      '                        parsedInput = new ArrayList<Double>();',
      '                        System.out.println("DEBUG: Created empty List<Double>");',
      '                    } else if (paramType.equals("List<Boolean>")) {',
      '                        parsedInput = new ArrayList<Boolean>();',
      '                        System.out.println("DEBUG: Created empty List<Boolean>");',
      '                    } else {',
      '                        parsedInput = new int[0]; // default',
      '                        System.out.println("DEBUG: Created default empty int[]");',
      '                    }',
      '                } else {',
      '                    String[] elements = arrayContent.split(",");',
      '                    System.out.println("DEBUG: elements.length = " + elements.length);',
      '                    // Check if elements are quoted (strings) or numbers',
      '                    boolean isStringArray = elements[0].trim().startsWith("\\"") && elements[0].trim().endsWith("\\"");',
      '                    boolean isBooleanArray = elements[0].trim().equals("true") || elements[0].trim().equals("false");',
      '                    System.out.println("DEBUG: isStringArray = " + isStringArray);',
      '                    System.out.println("DEBUG: isBooleanArray = " + isBooleanArray);',
      '',
      '                    if (isStringArray) {',
      '                        System.out.println("DEBUG: Processing string array");',
      '                        // String array or List<String>',
      '                        if (paramType.equals("String[]")) {',
      '                            String[] stringArray = new String[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                String element = elements[i].trim();',
      '                                stringArray[i] = element.substring(1, element.length() - 1);',
      '                            }',
      '                            parsedInput = stringArray;',
      '                            System.out.println("DEBUG: Created String[] with " + stringArray.length + " elements");',
      '                        } else if (paramType.equals("List<String>")) {',
      '                            List<String> stringList = new ArrayList<>();',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                String element = elements[i].trim();',
      '                                stringList.add(element.substring(1, element.length() - 1));',
      '                            }',
      '                            parsedInput = stringList;',
      '                            System.out.println("DEBUG: Created List<String> with " + stringList.size() + " elements");',
      '                        } else {',
      '                            // Default to String array',
      '                            String[] stringArray = new String[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                String element = elements[i].trim();',
      '                                stringArray[i] = element.substring(1, element.length() - 1);',
      '                            }',
      '                            parsedInput = stringArray;',
      '                            System.out.println("DEBUG: Created default String[] with " + stringArray.length + " elements");',
      '                        }',
      '                    } else if (isBooleanArray) {',
      '                        System.out.println("DEBUG: Processing boolean array");',
      '                        // Boolean array or List<Boolean>',
      '                        if (paramType.equals("boolean[]")) {',
      '                            boolean[] boolArray = new boolean[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                boolArray[i] = Boolean.parseBoolean(elements[i].trim());',
      '                            }',
      '                            parsedInput = boolArray;',
      '                            System.out.println("DEBUG: Created boolean[] with " + boolArray.length + " elements");',
      '                        } else if (paramType.equals("List<Boolean>")) {',
      '                            List<Boolean> boolList = new ArrayList<>();',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                boolList.add(Boolean.parseBoolean(elements[i].trim()));',
      '                            }',
      '                            parsedInput = boolList;',
      '                            System.out.println("DEBUG: Created List<Boolean> with " + boolList.size() + " elements");',
      '                        } else {',
      '                            boolean[] boolArray = new boolean[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                boolArray[i] = Boolean.parseBoolean(elements[i].trim());',
      '                            }',
      '                            parsedInput = boolArray;',
      '                            System.out.println("DEBUG: Created default boolean[] with " + boolArray.length + " elements");',
      '                        }',
      '                    } else {',
      '                        System.out.println("DEBUG: Processing number array");',
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
      '                            System.out.println("DEBUG: hasDecimal = " + hasDecimal);',
      '',
      '                            if (hasDecimal) {',
      '                                System.out.println("DEBUG: Processing double array");',
      '                                // Double array or List<Double>',
      '                                if (paramType.equals("double[]")) {',
      '                                    double[] doubleArray = new double[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        doubleArray[i] = Double.parseDouble(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = doubleArray;',
      '                                    System.out.println("DEBUG: Created double[] with " + doubleArray.length + " elements");',
      '                                } else if (paramType.equals("List<Double>")) {',
      '                                    List<Double> doubleList = new ArrayList<>();',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        doubleList.add(Double.parseDouble(elements[i].trim()));',
      '                                    }',
      '                                    parsedInput = doubleList;',
      '                                    System.out.println("DEBUG: Created List<Double> with " + doubleList.size() + " elements");',
      '                                } else {',
      '                                    double[] doubleArray = new double[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        doubleArray[i] = Double.parseDouble(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = doubleArray;',
      '                                    System.out.println("DEBUG: Created default double[] with " + doubleArray.length + " elements");',
      '                                }',
      '                            } else {',
      '                                System.out.println("DEBUG: Processing int array");',
      '                                // Integer array or List<Integer>',
      '                                if (paramType.equals("int[]")) {',
      '                                    int[] intArray = new int[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        intArray[i] = Integer.parseInt(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = intArray;',
      '                                    System.out.println("DEBUG: Created int[] with " + intArray.length + " elements");',
      '                                } else if (paramType.equals("List<Integer>")) {',
      '                                    List<Integer> intList = new ArrayList<>();',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        intList.add(Integer.parseInt(elements[i].trim()));',
      '                                    }',
      '                                    parsedInput = intList;',
      '                                    System.out.println("DEBUG: Created List<Integer> with " + intList.size() + " elements");',
      '                                } else {',
      '                                    int[] intArray = new int[elements.length];',
      '                                    for (int i = 0; i < elements.length; i++) {',
      '                                        intArray[i] = Integer.parseInt(elements[i].trim());',
      '                                    }',
      '                                    parsedInput = intArray;',
      '                                    System.out.println("DEBUG: Created default int[] with " + intArray.length + " elements");',
      '                                }',
      '                            }',
      '                        } catch (NumberFormatException e) {',
      '                            System.out.println("DEBUG: NumberFormatException, falling back to String array");',
      '                            // Fallback to String array',
      '                            String[] stringArray = new String[elements.length];',
      '                            for (int i = 0; i < elements.length; i++) {',
      '                                stringArray[i] = elements[i].trim();',
      '                            }',
      '                            parsedInput = stringArray;',
      '                            System.out.println("DEBUG: Created fallback String[] with " + stringArray.length + " elements");',
      '                        }',
      '                    }',
      '                }',
      '            } else if (cleanInput.equals("true") || cleanInput.equals("false")) {',
      '                System.out.println("DEBUG: Boolean input detected");',
      '                // Boolean input',
      '                parsedInput = Boolean.parseBoolean(cleanInput);',
      '                System.out.println("DEBUG: parsedInput = " + parsedInput);',
      '            } else if (cleanInput.length() == 1) {',
      '                System.out.println("DEBUG: Single character input detected");',
      '                // Single character',
      '                parsedInput = cleanInput.charAt(0);',
      '                System.out.println("DEBUG: parsedInput = " + parsedInput);',
      '            } else {',
      '                System.out.println("DEBUG: Number or string input detected");',
      '                // Try to parse as number, otherwise use as string',
      '                try {',
      '                    if (cleanInput.contains(".")) {',
      '                        if (paramType.equals("double")) {',
      '                            parsedInput = Double.parseDouble(cleanInput);',
      '                            System.out.println("DEBUG: Parsed as double: " + parsedInput);',
      '                        } else if (paramType.equals("float")) {',
      '                            parsedInput = Float.parseFloat(cleanInput);',
      '                            System.out.println("DEBUG: Parsed as float: " + parsedInput);',
      '                        } else {',
      '                            parsedInput = Double.parseDouble(cleanInput);',
      '                            System.out.println("DEBUG: Parsed as default double: " + parsedInput);',
      '                        }',
      '                    } else {',
      '                        if (paramType.equals("long")) {',
      '                            parsedInput = Long.parseLong(cleanInput);',
      '                            System.out.println("DEBUG: Parsed as long: " + parsedInput);',
      '                        } else if (paramType.equals("int")) {',
      '                            parsedInput = Integer.parseInt(cleanInput);',
      '                            System.out.println("DEBUG: Parsed as int: " + parsedInput);',
      '                        } else {',
      '                            // Default fallback - use as string for String parameters',
      '                            parsedInput = cleanInput;',
      '                            System.out.println("DEBUG: Used as string: " + parsedInput);',
      '                        }',
      '                    }',
      '                } catch (NumberFormatException e) {',
      '                    System.out.println("DEBUG: NumberFormatException, using as string");',
      '                    parsedInput = cleanInput; // Use as string',
      '                    System.out.println("DEBUG: parsedInput = " + parsedInput);',
      '                }',
      '            }',
      '',
      '            System.out.println("DEBUG: Final parsedInput type: " + parsedInput.getClass().getSimpleName());',
      '            System.out.println("DEBUG: Final parsedInput value: " + parsedInput);',
      '',
      '            // Call the solution method with parsed input',
      '            Object result;',
      '            System.out.println("DEBUG: About to call method with paramType: " + paramType);',
      '            if (paramType.equals("String")) {',
      `                result = solution.${methodName}((String) parsedInput);`,
      '                System.out.println("DEBUG: Called with String cast");',
      '            } else if (paramType.equals("int[]")) {',
      `                result = solution.${methodName}((int[]) parsedInput);`,
      '                System.out.println("DEBUG: Called with int[] cast");',
      '            } else if (paramType.equals("String[]")) {',
      `                result = solution.${methodName}((String[]) parsedInput);`,
      '                System.out.println("DEBUG: Called with String[] cast");',
      '            } else if (paramType.equals("double[]")) {',
      `                result = solution.${methodName}((double[]) parsedInput);`,
      '                System.out.println("DEBUG: Called with double[] cast");',
      '            } else if (paramType.equals("boolean[]")) {',
      `                result = solution.${methodName}((boolean[]) parsedInput);`,
      '                System.out.println("DEBUG: Called with boolean[] cast");',
      '            } else if (paramType.equals("List<Integer>")) {',
      `                result = solution.${methodName}((List<Integer>) parsedInput);`,
      '                System.out.println("DEBUG: Called with List<Integer> cast");',
      '            } else if (paramType.equals("List<String>")) {',
      `                result = solution.${methodName}((List<String>) parsedInput);`,
      '                System.out.println("DEBUG: Called with List<String> cast");',
      '            } else if (paramType.equals("List<Double>")) {',
      `                result = solution.${methodName}((List<Double>) parsedInput);`,
      '                System.out.println("DEBUG: Called with List<Double> cast");',
      '            } else if (paramType.equals("List<Boolean>")) {',
      `                result = solution.${methodName}((List<Boolean>) parsedInput);`,
      '                System.out.println("DEBUG: Called with List<Boolean> cast");',
      '            } else if (paramType.equals("int")) {',
      `                result = solution.${methodName}((Integer) parsedInput);`,
      '                System.out.println("DEBUG: Called with Integer cast");',
      '            } else if (paramType.equals("double")) {',
      `                result = solution.${methodName}((Double) parsedInput);`,
      '                System.out.println("DEBUG: Called with Double cast");',
      '            } else if (paramType.equals("float")) {',
      `                result = solution.${methodName}((Float) parsedInput);`,
      '                System.out.println("DEBUG: Called with Float cast");',
      '            } else if (paramType.equals("long")) {',
      `                result = solution.${methodName}((Long) parsedInput);`,
      '                System.out.println("DEBUG: Called with Long cast");',
      '            } else if (paramType.equals("boolean")) {',
      `                result = solution.${methodName}((Boolean) parsedInput);`,
      '                System.out.println("DEBUG: Called with Boolean cast");',
      '            } else if (paramType.equals("char")) {',
      `                result = solution.${methodName}((Character) parsedInput);`,
      '                System.out.println("DEBUG: Called with Character cast");',
      '            } else {',
      '                // Default fallback - try to cast to String',
      `                result = solution.${methodName}((String) parsedInput);`,
      '                System.out.println("DEBUG: Called with default String cast");',
      '            }',
      '            System.out.println("DEBUG: Method call successful, result: " + result);',
      '            System.out.println(result);',
      '        } catch (Exception e) {',
      '            System.err.println("Error: " + e.getMessage());',
      '            e.printStackTrace();',
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
    
    // Debug: Test the first input to understand what's happening
    if (testCases.length > 0) {
      const firstInput = testCases[0].input;
      console.log('🔍 [JAVA] DEBUG: Testing first input:', firstInput);
      console.log('🔍 [JAVA] DEBUG: Input type:', typeof firstInput);
      console.log('🔍 [JAVA] DEBUG: Input length:', firstInput.length);
      console.log('🔍 [JAVA] DEBUG: Input starts with [:', firstInput.startsWith('['));
      console.log('🔍 [JAVA] DEBUG: Input ends with ]:', firstInput.endsWith(']'));
      console.log('🔍 [JAVA] DEBUG: Input starts with ":', firstInput.startsWith('"'));
      console.log('🔍 [JAVA] DEBUG: Input ends with ":', firstInput.endsWith('"'));
      
      // Simulate the cleanInput logic
      let cleanInput = firstInput;
      if (cleanInput.startsWith('"') && cleanInput.endsWith('"')) {
        cleanInput = cleanInput.substring(1, cleanInput.length - 1);
      }
      console.log('🔍 [JAVA] DEBUG: After quote removal:', cleanInput);
      console.log('🔍 [JAVA] DEBUG: Clean input starts with [:', cleanInput.startsWith('['));
      console.log('🔍 [JAVA] DEBUG: Clean input ends with ]:', cleanInput.endsWith(']'));
      console.log('🔍 [JAVA] DEBUG: Clean input length > 2:', cleanInput.length > 2);
      
      // Debug: Show the exact generated code for this test case
      console.log('🔍 [JAVA] DEBUG: Full generated code:');
      console.log(fullCode);
    }
    
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