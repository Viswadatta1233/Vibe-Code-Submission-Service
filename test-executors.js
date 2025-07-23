const { runPython } = require('./dist/executors/pythonExecutor');
const { runJava } = require('./dist/executors/javaExecutor');
const { runCpp } = require('./dist/executors/cppExecutor');

// Sample problem structure
const validParenthesesProblem = {
  title: "Valid Parentheses",
  description: "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.",
  difficulty: "easy",
  testcases: [
    { input: "\"()\"", output: "true" },
    { input: "\"()[]{}\"", output: "true" },
    { input: "\"(]\"", output: "false" },
    { input: "\"([)]\"", output: "false" },
    { input: "\"{[]}\"", output: "true" }
  ],
  codeStubs: [
    {
      language: "PYTHON",
      startSnippet: "class Solution:\n",
      userSnippet: "    def isValid(self, s):\n        # your code here",
      endSnippet: ""
    },
    {
      language: "JAVA",
      startSnippet: "public class Solution {",
      userSnippet: "    public boolean isValid(String s) {\n        // your code here\n    }",
      endSnippet: "}"
    },
    {
      language: "CPP",
      startSnippet: "#include <stack>\n#include <string>\nclass Solution {\npublic:",
      userSnippet: "    bool isValid(std::string s) {\n        // your code here\n    }",
      endSnippet: "\n};"
    }
  ]
};

const maxSubArrayProblem = {
  title: "Maximum Subarray",
  description: "Given an integer array nums, find the contiguous subarray which has the largest sum and return its sum.",
  difficulty: "Medium",
  testcases: [
    { input: "[-2,1,-3,4,-1,2,1,-5,4]", output: "6" },
    { input: "[1]", output: "1" },
    { input: "[5,4,-1,7,8]", output: "23" }
  ],
  codeStubs: [
    {
      language: "PYTHON",
      startSnippet: "class Solution:\n",
      userSnippet: "    def maxSubArray(self, nums):\n        # your code here",
      endSnippet: ""
    },
    {
      language: "JAVA",
      startSnippet: "public class Solution {",
      userSnippet: "    public int maxSubArray(int[] nums) {\n        // your code here\n    }",
      endSnippet: "}"
    },
    {
      language: "CPP",
      startSnippet: "#include <vector>\nclass Solution {\npublic:",
      userSnippet: "    int maxSubArray(std::vector<int>& nums) {\n        // your code here\n    }",
      endSnippet: "\n};"
    }
  ]
};

// Sample solutions
const validParenthesesSolution = {
  python: `        stack = []
        brackets = {')': '(', '}': '{', ']': '['}
        
        for char in s:
            if char in brackets.values():
                stack.append(char)
            elif char in brackets:
                if not stack or stack.pop() != brackets[char]:
                    return False
        
        return len(stack) == 0`,
  
  java: `        Stack<Character> stack = new Stack<>();
        Map<Character, Character> brackets = new HashMap<>();
        brackets.put(')', '(');
        brackets.put('}', '{');
        brackets.put(']', '[');
        
        for (char c : s.toCharArray()) {
            if (brackets.containsValue(c)) {
                stack.push(c);
            } else if (brackets.containsKey(c)) {
                if (stack.isEmpty() || stack.pop() != brackets.get(c)) {
                    return false;
                }
            }
        }
        
        return stack.isEmpty();`,
  
  cpp: `        std::stack<char> stack;
        std::unordered_map<char, char> brackets = {
            {')', '('},
            {'}', '{'},
            {']', '['}
        };
        
        for (char c : s) {
            if (brackets.find(c) == brackets.end()) {
                stack.push(c);
            } else {
                if (stack.empty() || stack.top() != brackets[c]) {
                    return false;
                }
                stack.pop();
            }
        }
        
        return stack.empty();`
};

const maxSubArraySolution = {
  python: `        max_sum = current_sum = nums[0]
        
        for num in nums[1:]:
            current_sum = max(num, current_sum + num)
            max_sum = max(max_sum, current_sum)
        
        return max_sum`,
  
  java: `        int maxSum = nums[0];
        int currentSum = nums[0];
        
        for (int i = 1; i < nums.length; i++) {
            currentSum = Math.max(nums[i], currentSum + nums[i]);
            maxSum = Math.max(maxSum, currentSum);
        }
        
        return maxSum;`,
  
  cpp: `        int maxSum = nums[0];
        int currentSum = nums[0];
        
        for (int i = 1; i < nums.size(); i++) {
            currentSum = std::max(nums[i], currentSum + nums[i]);
            maxSum = std::max(maxSum, currentSum);
        }
        
        return maxSum;`
};

async function testExecutor(executorName, executor, problem, solution, language) {
  console.log(`\n🧪 Testing ${executorName} with ${problem.title}...`);
  
  try {
    const result = await executor(problem, solution);
    console.log(`✅ ${executorName} execution successful:`);
    console.log(`📤 Output: ${result.output}`);
    console.log(`📊 Status: ${result.status}`);
    
    // Parse and validate results
    const lines = result.output.trim().split('\n');
    const testResults = [];
    
    for (let i = 0; i < problem.testcases.length; i++) {
      const line = lines[i];
      if (line && line.startsWith(`TEST_${i + 1}:`)) {
        const output = line.substring(`TEST_${i + 1}:`.length);
        const expected = problem.testcases[i].output;
        const passed = output === expected;
        
        testResults.push({
          testCase: i + 1,
          input: problem.testcases[i].input,
          expected,
          actual: output,
          passed
        });
        
        console.log(`  Test ${i + 1}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        if (!passed) {
          console.log(`    Expected: ${expected}, Got: ${output}`);
        }
      } else {
        console.log(`  Test ${i + 1}: ❌ NO OUTPUT`);
      }
    }
    
    const passedCount = testResults.filter(r => r.passed).length;
    const totalCount = testResults.length;
    console.log(`📊 Summary: ${passedCount}/${totalCount} tests passed`);
    
    return passedCount === totalCount;
    
  } catch (error) {
    console.error(`❌ ${executorName} execution failed:`, error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Executor Tests...\n');
  
  const tests = [
    {
      name: 'Python Valid Parentheses',
      executor: runPython,
      problem: validParenthesesProblem,
      solution: validParenthesesSolution.python,
      language: 'PYTHON'
    },
    {
      name: 'Java Valid Parentheses',
      executor: runJava,
      problem: validParenthesesProblem,
      solution: validParenthesesSolution.java,
      language: 'JAVA'
    },
    {
      name: 'C++ Valid Parentheses',
      executor: runCpp,
      problem: validParenthesesProblem,
      solution: validParenthesesSolution.cpp,
      language: 'CPP'
    },
    {
      name: 'Python Max Subarray',
      executor: runPython,
      problem: maxSubArrayProblem,
      solution: maxSubArraySolution.python,
      language: 'PYTHON'
    },
    {
      name: 'Java Max Subarray',
      executor: runJava,
      problem: maxSubArrayProblem,
      solution: maxSubArraySolution.java,
      language: 'JAVA'
    },
    {
      name: 'C++ Max Subarray',
      executor: runCpp,
      problem: maxSubArrayProblem,
      solution: maxSubArraySolution.cpp,
      language: 'CPP'
    }
  ];
  
  let passedTests = 0;
  let totalTests = tests.length;
  
  for (const test of tests) {
    const passed = await testExecutor(
      test.name,
      test.executor,
      test.problem,
      test.solution,
      test.language
    );
    
    if (passed) {
      passedTests++;
    }
    
    // Add delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n📊 Final Results:');
  console.log(`✅ Passed: ${passedTests}/${totalTests}`);
  console.log(`❌ Failed: ${totalTests - passedTests}/${totalTests}`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Executors are working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Please check the implementation.');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  runAllTests,
  testExecutor,
  validParenthesesProblem,
  maxSubArrayProblem,
  validParenthesesSolution,
  maxSubArraySolution
}; 