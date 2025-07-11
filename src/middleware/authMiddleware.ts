import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  console.log('🔐 [SUBMISSION-AUTH] Authentication middleware triggered');
  console.log('🔐 [SUBMISSION-AUTH] Request URL:', request.url);
  console.log('🔐 [SUBMISSION-AUTH] Request method:', request.method);
  console.log('🔐 [SUBMISSION-AUTH] Request headers:', JSON.stringify(request.headers, null, 2));
  
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ [SUBMISSION-AUTH] No valid authorization header found');
    console.log('❌ [SUBMISSION-AUTH] Auth header:', authHeader);
    request.log.warn('No token provided');
    return reply.status(401).send({ message: 'No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  console.log('🔑 [SUBMISSION-AUTH] Extracted token:', token ? `${token.substring(0, 20)}...` : 'null');
  
  const JWT_SECRET = 'your_jwt_secret';
  console.log('🔑 [SUBMISSION-AUTH] JWT_SECRET being used:', JWT_SECRET);
  
  request.log.info({ token: token ? `${token.substring(0, 20)}...` : 'null' }, 'Received JWT token');
  request.log.info({ JWT_SECRET }, 'JWT_SECRET used for verification');
  
  try {
    console.log('🔍 [SUBMISSION-AUTH] Attempting to verify JWT token...');
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    console.log('✅ [SUBMISSION-AUTH] JWT token verified successfully');
    console.log('🔍 [SUBMISSION-AUTH] Decoded token payload:', JSON.stringify(decoded, null, 2));
    
    // @ts-ignore
    request.user = decoded;
    console.log('✅ [SUBMISSION-AUTH] User object attached to request:', {
      userId: decoded.userId,
      role: decoded.role
    });
    
  } catch (err) {
    console.log('❌ [SUBMISSION-AUTH] JWT verification failed');
    console.log('❌ [SUBMISSION-AUTH] Error details:', err instanceof Error ? err.message : 'Unknown error');
    console.log('❌ [SUBMISSION-AUTH] Error stack:', err instanceof Error ? err.stack : 'No stack trace');
    request.log.error({ err }, 'JWT verification failed');
    return reply.status(401).send({ message: 'Invalid token' });
  }
}
