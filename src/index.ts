import fastify from 'fastify';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from '@fastify/cors';
import submissionRoutes from './routes/submissionRoutes';
import { setupBullBoard } from './bullboard';
import { websocketService } from './services/websocketService';
import { submissionQueue } from './queues/submissionQueue';
import Docker from 'dockerode';

dotenv.config();

console.log('🚀 [SUBMISSION-SERVICE] Starting Submission Service...');
console.log('🔧 [SUBMISSION-SERVICE] Environment variables loaded');
console.log('🔧 [SUBMISSION-SERVICE] JWT_SECRET:', process.env.JWT_SECRET || 'your_jwt_secret');
console.log('🔧 [SUBMISSION-SERVICE] PROBLEM_SERVICE_URL:', process.env.PROBLEM_SERVICE_URL || 'http://localhost:5000/api/problems');

const app = fastify({ logger: true });

const PORT = Number(process.env.PORT) || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/leetcode-clone';

// Register CORS with WebSocket support
app.register(cors, {
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173', 'https://vibecode-ui-8z5x.vercel.app', 'https://vibecode-ui-dz9c.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'user-id'],
  exposedHeaders: ['Content-Type', 'Authorization']
});

console.log('✅ [SUBMISSION-SERVICE] CORS configured');

// Handle OPTIONS preflight requests globally for all routes
app.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') {
    console.log('🔄 [SUBMISSION-SERVICE] Handling OPTIONS preflight request for:', request.url);
    reply.header('Access-Control-Allow-Origin', request.headers.origin || '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, user-id');
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    reply.status(200).send();
    return;
  }
});

// Request logging middleware
app.addHook('onRequest', async (request, reply) => {
  console.log(`📨 [SUBMISSION-SERVICE] ${request.method} ${request.url} - ${new Date().toISOString()}`);
  console.log(`📨 [SUBMISSION-SERVICE] Headers:`, JSON.stringify(request.headers, null, 2));
  if (request.body && Object.keys(request.body as any).length > 0) {
    console.log(`📨 [SUBMISSION-SERVICE] Body:`, JSON.stringify(request.body, null, 2));
  }
});

// Health check endpoint
app.get('/health', async (request, reply) => {
  console.log('🏥 [SUBMISSION-SERVICE] Health check requested');
  return { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'submission-service',
    websocket: 'available'
  };
});

// WebSocket update endpoint for worker
app.post('/api/websocket/update', async (request, reply) => {
  console.log('📡 [SUBMISSION-SERVICE] WebSocket update request received');
  const { userId, submissionId, data } = request.body as any;
  
  if (!userId || !submissionId || !data) {
    console.log('❌ [SUBMISSION-SERVICE] Missing required fields in WebSocket update');
    return reply.status(400).send({ error: 'Missing required fields' });
  }
  
  console.log(`📡 [SUBMISSION-SERVICE] HTTP update request for user ${userId}, submission ${submissionId}`);
  websocketService.sendSubmissionUpdate(userId, submissionId, data);
  
  return { success: true, message: 'Update sent' };
});

app.register(submissionRoutes);
setupBullBoard(app);

// Test Docker connection at startup
async function testDockerConnection() {
  try {
    console.log('🔍 [SUBMISSION-SERVICE] Testing Docker connection...');
    const docker = new Docker();
    const info = await docker.info();
    console.log('✅ [SUBMISSION-SERVICE] Docker connection successful');
    console.log('🐳 [SUBMISSION-SERVICE] Docker version:', info.ServerVersion);
    console.log('💾 [SUBMISSION-SERVICE] Available memory:', Math.round(info.MemTotal / 1024 / 1024), 'MB');
    
    // Test pulling a small image
    console.log('📦 [SUBMISSION-SERVICE] Testing image pull...');
    await docker.pull('hello-world:latest');
    console.log('✅ [SUBMISSION-SERVICE] Image pull test successful');
    
  } catch (error) {
    console.error('❌ [SUBMISSION-SERVICE] Docker connection failed:', error);
    console.error('💡 [SUBMISSION-SERVICE] Make sure Docker is running and accessible');
    process.exit(1);
  }
}

console.log('🔗 [SUBMISSION-SERVICE] Connecting to MongoDB...');
console.log('🔗 [SUBMISSION-SERVICE] MONGO_URI:', MONGO_URI);

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ [SUBMISSION-SERVICE] Connected to MongoDB');
    
    // Test Docker connection
    await testDockerConnection();
    
    // Start the server
    try {
      await app.listen({ port: PORT, host: '0.0.0.0' });
      console.log(`🚀 [SUBMISSION-SERVICE] Submission service running on port ${PORT}`);
      console.log(`🔗 [SUBMISSION-SERVICE] Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 [SUBMISSION-SERVICE] Submission endpoints: http://localhost:${PORT}/api/submissions`);
      console.log(`🔗 [SUBMISSION-SERVICE] WebSocket update endpoint: http://localhost:${PORT}/api/websocket/update`);
      
      // Initialize WebSocket service AFTER server starts
      websocketService.initialize(app);
      
      console.log('✅ [SUBMISSION-SERVICE] WebSocket server is ready');
    } catch (err) {
      console.error('❌ [SUBMISSION-SERVICE] Failed to start server:', err);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('❌ [SUBMISSION-SERVICE] MongoDB connection failed:', err);
    process.exit(1);
  });
