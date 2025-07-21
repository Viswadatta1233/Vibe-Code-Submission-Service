import type { FastifyInstance } from 'fastify';
import { createSubmission, getSubmissionById, getUserSubmissions } from '../controllers/submissionController';
import { authenticate } from '../middleware/authMiddleware';

export default async function submissionRoutes(fastify: FastifyInstance) {
  fastify.post('/api/submissions/create', { preHandler: [authenticate] }, createSubmission);
  fastify.get('/api/submissions/:id', { preHandler: [authenticate] }, getSubmissionById);
  fastify.get('/api/submissions/user', { preHandler: [authenticate] }, getUserSubmissions);
}
