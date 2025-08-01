import { type FastifyRequest, type FastifyReply } from 'fastify';
import Submission from '../models/Submission';
import axios from 'axios';
import { addSubmissionJob } from '../producers/submissionProducer';

const PROBLEM_SERVICE_URL ='https://vibecodepbs.duckdns.org/api/problems';

export async function createSubmission(request: FastifyRequest, reply: FastifyReply) {
  console.log('📝 [SUBMISSION] Create submission request received');
  console.log('📝 [SUBMISSION] Request URL:', request.url);
  console.log('📝 [SUBMISSION] Request method:', request.method);
  console.log('📝 [SUBMISSION] Request headers:', JSON.stringify(request.headers, null, 2));
  
  try {
    console.log('🔍 [SUBMISSION] Extracting user information...');
    // @ts-ignore
    const userId = request.user.userId;
    console.log('👤 [SUBMISSION] User ID from token:', userId);
    console.log('👤 [SUBMISSION] Full user object:', request.user);
    
    const problemId = (request.query as any).problemId;
    const { userCode, language } = request.body as any;
    
    console.log('📋 [SUBMISSION] Request parameters:', {
      problemId,
      language,
      userCodeLength: userCode ? userCode.length : 0
    });
    
    if (!problemId || !userCode || !language) {
      console.log('❌ [SUBMISSION] Missing required fields');
      console.log('❌ [SUBMISSION] problemId:', problemId);
      console.log('❌ [SUBMISSION] userCode:', userCode ? 'present' : 'missing');
      console.log('❌ [SUBMISSION] language:', language);
      return reply.status(400).send({ message: 'Missing required fields' });
    }
    
    // Fetch problem from Problem Service
    console.log('🔍 [SUBMISSION] Fetching problem from Problem Service:', `${PROBLEM_SERVICE_URL}/${problemId}`);
    const { data: problem } = await axios.get(`${PROBLEM_SERVICE_URL}/${problemId}`);
    
    if (!problem) {
      console.log('❌ [SUBMISSION] Problem not found');
      return reply.status(404).send({ message: 'Problem not found' });
    }
    
    console.log('✅ [SUBMISSION] Problem fetched successfully:', {
      problemId: problem._id,
      title: problem.title,
      codeStubsCount: problem.codeStubs ? problem.codeStubs.length : 0
    });
    
    // Find code stub for language
    const stub = problem.codeStubs.find((s: any) => s.language === language);
    if (!stub) {
      console.log('❌ [SUBMISSION] Code stub for language not found:', language);
      console.log('❌ [SUBMISSION] Available languages:', problem.codeStubs.map((s: any) => s.language));
      return reply.status(400).send({ message: 'Code stub for language not found' });
    }
    
    console.log('✅ [SUBMISSION] Code stub found for language:', language);
    
    // Store the complete code in the database (startSnippet + userCode + endSnippet)
    const codeForDb = (stub.startSnippet || '') + (userCode || '') + (stub.endSnippet || '');
    
    console.log('💾 [SUBMISSION] Creating submission in database...');
    const submission = new Submission({
      userId,
      problemId,
      code: codeForDb,
      language,
      status: 'Pending',
    });
    await submission.save();
    console.log(`✅ [SUBMISSION] Submission created: ${submission._id}`);
    
    // Add job to queue with problem data for generic execution
    console.log('🚀 [SUBMISSION] Adding job to queue...');
    addSubmissionJob({
      submissionId: submission._id,
      userId,
      problemId,
      language,
      userCode: userCode, // Send only user code, not full code
      problem: problem, // Send full problem data for generic execution
      testcases: problem.testcases
    }).catch(err => {
      console.error('❌ [SUBMISSION] Queue error:', err);
    });
    
    console.log(`✅ [SUBMISSION] Job added to queue: ${submission._id}`);
    return reply.status(201).send(submission);
  } catch (err: any) {
    console.error('❌ [SUBMISSION] Submission error:', err);
    console.error('❌ [SUBMISSION] Error message:', err.message);
    console.error('❌ [SUBMISSION] Error stack:', err.stack);
    return reply.status(500).send({ message: err.message });
  }
}

export async function getSubmissionById(request: FastifyRequest, reply: FastifyReply) {
  try {
    // @ts-ignore
    const userId = request.user.userId;
    const { id } = request.params as any;
    
    console.log('🔍 [SUBMISSION] Getting submission by ID:', id, 'for user:', userId);
    
    const submission = await Submission.findById(id);
    
    if (!submission) {
      console.log('❌ [SUBMISSION] Submission not found:', id);
      return reply.status(404).send({ message: 'Submission not found' });
    }
    
    // Check if user owns this submission
    if (submission.userId.toString() !== userId) {
      console.log('❌ [SUBMISSION] User not authorized to access submission:', userId, 'tried to access:', submission.userId);
      return reply.status(403).send({ message: 'Not authorized to access this submission' });
    }
    
    console.log('✅ [SUBMISSION] Submission retrieved successfully:', id);
    return reply.status(200).send(submission);
  } catch (err: any) {
    console.error('❌ [SUBMISSION] Get submission error:', err);
    return reply.status(500).send({ message: err.message });
  }
}

export async function getUserSubmissions(request: FastifyRequest, reply: FastifyReply) {
  try {
    // @ts-ignore
    const userId = request.user.userId;
    
    console.log('🔍 [SUBMISSION] Getting submissions for user:', userId);
    
    const submissions = await Submission.find({ userId }).sort({ createdAt: -1 });
    
    console.log('✅ [SUBMISSION] Retrieved', submissions.length, 'submissions for user:', userId);
    return reply.status(200).send(submissions);
  } catch (err: any) {
    console.error('❌ [SUBMISSION] Get user submissions error:', err);
    return reply.status(500).send({ message: err.message });
  }
}
