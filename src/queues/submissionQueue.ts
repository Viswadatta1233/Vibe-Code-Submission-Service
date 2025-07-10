import { Queue } from 'bullmq';
import { RedisOptions } from 'ioredis';

const redisOptions: RedisOptions = {
  host: process.env.REDIS_HOST || 'host.docker.internal',
  port: Number(process.env.REDIS_PORT) || 6379,
  // If using Docker for Redis on Windows, try host.docker.internal
  // host: process.env.REDIS_HOST || 'host.docker.internal',
};

export const submissionQueue = new Queue('submission-queue', {
  connection: redisOptions,
});

// Debug log to verify connection
console.log('BullMQ submissionQueue connecting to Redis:', redisOptions);
