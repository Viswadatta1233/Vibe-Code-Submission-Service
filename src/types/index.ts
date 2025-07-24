export interface TestCase {
  input: string;
  output: string;
}

export interface CodeStub {
  language: string;
  startSnippet: string;
  userSnippet: string;
  endSnippet: string;
}

export interface Problem {
  title: string;
  testcases: TestCase[];
  codeStubs: CodeStub[];
}

export interface ExecutionResponse {
  output: string;
  status: string;
  error?: string;
}

export interface SubmissionData {
  submissionId: string;
  userId: string;
  problemId: string;
  language: string;
  userCode: string;
  problem: Problem;
  testcases: TestCase[];
} 