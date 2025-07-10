import { type FastifyRequest, type FastifyReply } from 'fastify';
import Submission from '../models/Submission';
import axios from 'axios';
import { addSubmissionJob } from '../producers/submissionProducer';

const PROBLEM_SERVICE_URL = process.env.PROBLEM_SERVICE_URL || 'http://localhost:5000/api/problems';

export async function createSubmission(request: FastifyRequest, reply: FastifyReply) {
  try {
    console.log('Creating submission');
    // @ts-ignore
    const userId = request.user.userId;
    const problemId = (request.query as any).problemId;
    const { userCode, language } = request.body as any;
    if (!problemId || !userCode || !language) {
      console.log('Missing required fields');
      return reply.status(400).send({ message: 'Missing required fields' });
    }
    // Fetch problem from Problem Service
    console.log('Fetching problem from Problem Service:', `${PROBLEM_SERVICE_URL}/${problemId}`);
    const { data: problem } = await axios.get(`${PROBLEM_SERVICE_URL}/${problemId}`);
    if (!problem) {
      console.log('Problem not found');
      return reply.status(404).send({ message: 'Problem not found' });
    }
    // Find code stub for language
    const stub = problem.codeStubs.find((s: any) => s.language === language);
    if (!stub) {
      console.log('Code stub for language not found');
      return reply.status(400).send({ message: 'Code stub for language not found' });
    }
    // For Java, store only the user method as code in the DB, but for execution, expect the full method (with signature)
    const fullCode = (stub.startSnippet || '') + (userCode || '') + (stub.endSnippet || '');
    const isJava = language === 'JAVA';
    const isCpp = language === 'CPP';
    const isPython = language === 'PYTHON';
    
    // For Java, C++, and Python, only send the user method to the executor; for others, combine with stubs
    let codeForJob = userCode;
    if (language !== 'JAVA' && language !== 'CPP' && language !== 'PYTHON') {
      codeForJob = (stub.startSnippet || '') + (userCode || '') + (stub.endSnippet || '');
    }
    
    // Debug logging for C++ and Python submissions
    if (language === 'CPP' || language === 'PYTHON') {
      console.log(`🔍 ${language} Submission Debug:`);
      console.log('📥 User code received:', userCode);
      console.log('🔧 Code for job:', codeForJob);
      console.log('📋 Start snippet:', stub.startSnippet);
      console.log('📋 End snippet:', stub.endSnippet);
    }
    
    const codeForDb = (stub.startSnippet || '') + (userCode || '') + (stub.endSnippet || '');
    const submission = new Submission({
      userId,
      problemId,
      code: codeForDb,
      language,
      status: 'Pending',
    });
    await submission.save();
    console.log(`Submission created: ${submission._id}`);
    // Preprocess testcases to ensure input format is as expected for Java
    const formattedTestcases = problem.testcases.map((t: any) => ({
      ...t,
      input: t.input.replace(/\],\s*/, '],') // ensures consistent split for Java
    }));
    // Add job to queue (fire-and-forget)
    addSubmissionJob({
      submissionId: submission._id,
      userId,
      problemId,
      language,
      fullCode: codeForJob,
      testcases: formattedTestcases
    }).catch(err => console.error('Queue error', err));
    console.log(`Job added to queue: ${submission._id}`);
    return reply.status(201).send(submission);
  } catch (err: any) {
    console.error('Submission error:', err);
    return reply.status(500).send({ message: err.message });
  }
}
