import type { FastifyInstance } from 'fastify';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { submissionQueue } from './queues/submissionQueue';

export function setupBullBoard(app: FastifyInstance) {
  const serverAdapter = new FastifyAdapter();
  createBullBoard({
    queues: [new BullMQAdapter(submissionQueue)],
    serverAdapter,
  });
  app.register(serverAdapter.registerPlugin(), { prefix: '/admin/queues' });
}
