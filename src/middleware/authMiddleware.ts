import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    request.log.warn('No token provided');
    return reply.status(401).send({ message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  const JWT_SECRET = 'your_jwt_secret';
  request.log.info({ token }, 'Received JWT token');
  request.log.info({ JWT_SECRET }, 'JWT_SECRET used for verification');
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // @ts-ignore
    request.user = decoded;
  } catch (err) {
    request.log.error({ err }, 'JWT verification failed');
    return reply.status(401).send({ message: 'Invalid token' });
  }
}
