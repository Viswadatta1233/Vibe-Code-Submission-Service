import type { FastifyInstance } from 'fastify';
import { createSubmission } from '../controllers/submissionController';
import { authenticate } from '../middleware/authMiddleware';

export default async function submissionRoutes(fastify: FastifyInstance) {
  fastify.post('/api/submissions/create', { preHandler: [authenticate] }, createSubmission);
}
