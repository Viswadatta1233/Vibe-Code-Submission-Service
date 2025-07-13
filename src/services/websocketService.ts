import type { FastifyInstance } from 'fastify';
import { Server as IOServer, Socket } from 'socket.io';

interface SubmissionUpdateData {
  status: string;
  [key: string]: any;
}

class WebSocketService {
  private io: IOServer | null = null;
  private userSockets: Map<string, Socket> = new Map();
  private serverUrl: string = 'http://localhost:5001';

  initialize(fastify: FastifyInstance) {
    console.log('🔌 Initializing WebSocket service...');
    
    // Attach Socket.IO to the Fastify server
    this.io = new IOServer(fastify.server, {
      cors: { 
        origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173', 'https://vibecode-ui-8z5x.vercel.app'],
        credentials: true
      },
    });

    this.io.on('connection', (socket: Socket) => {
      console.log('🔗 Socket.IO client connected:', socket.id);

      socket.on('auth', (data: { userId: string }) => {
        if (data.userId) {
          socket.data.userId = data.userId;
          this.userSockets.set(data.userId, socket);
          console.log(`✅ User ${data.userId} authenticated and socket stored`);
          console.log(`📊 Total connected users: ${this.userSockets.size}`);
          socket.emit('connection', { message: 'Connected to submission service', userId: data.userId });
        } else {
          console.log('❌ Auth message received but userId is missing:', data);
        }
      });

      socket.on('disconnect', (reason: string) => {
        const userId = socket.data.userId;
        if (userId) {
          this.userSockets.delete(userId);
          console.log(`👋 User ${userId} disconnected, socket removed`);
          console.log(`📊 Total connected users: ${this.userSockets.size}`);
        }
        console.log('🔌 Socket.IO client disconnected:', socket.id, reason);
      });
    });
    
    console.log('✅ WebSocket service initialized successfully');
  }

  sendSubmissionUpdate(userId: string, submissionId: string, data: SubmissionUpdateData) {
    console.log(`📤 Attempting to send update to user ${userId} for submission ${submissionId}`);
    console.log(`📊 Current connected users: ${this.userSockets.size}`);
    console.log(`👥 Connected user IDs:`, Array.from(this.userSockets.keys()));
    
    const socket = this.userSockets.get(userId);
    if (socket) {
      socket.emit('submission_update', { submissionId, data });
      console.log(`✅ Sent submission update to user ${userId}:`, { submissionId, data });
    } else {
      console.log(`❌ No active socket found for user ${userId}`);
      console.log(`🔍 Available users:`, Array.from(this.userSockets.keys()));
      
      // Try to send via HTTP if socket not available locally
      this.sendUpdateViaHTTP(userId, submissionId, data);
    }
  }

  private async sendUpdateViaHTTP(userId: string, submissionId: string, data: SubmissionUpdateData) {
    try {
      console.log(`🌐 Attempting to send update via HTTP for user ${userId}`);
      
      // This would require an HTTP endpoint on the main server to broadcast to connected clients
      // For now, we'll just log that we can't send the update
      console.log(`⚠️ Cannot send update to user ${userId} - no local socket and no HTTP fallback configured`);
    } catch (error) {
      console.error(`❌ Error sending update via HTTP for user ${userId}:`, error);
    }
  }

  // Method to check if a user is connected
  isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  // Method to get all connected user IDs
  getConnectedUserIds(): string[] {
    return Array.from(this.userSockets.keys());
  }
}

export const websocketService = new WebSocketService();