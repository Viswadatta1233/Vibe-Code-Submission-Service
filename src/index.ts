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

const app = fastify({ logger: true });

const PORT = Number(process.env.PORT) || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/leetcode-clone';

// Register CORS with WebSocket support
app.register(cors, {
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'user-id'],
  exposedHeaders: ['Content-Type', 'Authorization']
});

console.log('Initializing Submission Service...');

// Health check endpoint
app.get('/health', async (request, reply) => {
  return { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'submission-service',
    websocket: 'available'
  };
});

// WebSocket update endpoint for worker
app.post('/api/websocket/update', async (request, reply) => {
  const { userId, submissionId, data } = request.body as any;
  
  if (!userId || !submissionId || !data) {
    return reply.status(400).send({ error: 'Missing required fields' });
  }
  
  console.log(`📡 HTTP update request for user ${userId}, submission ${submissionId}`);
  websocketService.sendSubmissionUpdate(userId, submissionId, data);
  
  return { success: true, message: 'Update sent' };
});

app.register(submissionRoutes);
setupBullBoard(app);

// Test Docker connection at startup
async function testDockerConnection() {
  try {
    console.log('🔍 Testing Docker connection...');
    const docker = new Docker();
    const info = await docker.info();
    console.log('✅ Docker connection successful');
    console.log('🐳 Docker version:', info.ServerVersion);
    console.log('💾 Available memory:', Math.round(info.MemTotal / 1024 / 1024), 'MB');
    
    // Test pulling a small image
    console.log('📦 Testing image pull...');
    await docker.pull('hello-world:latest');
    console.log('✅ Image pull test successful');
    
  } catch (error) {
    console.error('❌ Docker connection failed:', error);
    console.error('💡 Make sure Docker is running and accessible');
    process.exit(1);
  }
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    
    // Test Docker connection
    await testDockerConnection();
    
    // Start the server
    try {
      await app.listen({ port: PORT, host: '0.0.0.0' });
      console.log(`🚀 Submission service running on port ${PORT} testing`);
      
      // Initialize WebSocket service AFTER server starts
      websocketService.initialize(app);
      
      console.log('✅ WebSocket server is ready');
      console.log('✅ Health check available at: http://localhost:5001/health');
console.log('✅ WebSocket update endpoint: http://localhost:5001/api/websocket/update');
    } catch (err) {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  });
