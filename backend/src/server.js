// src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const db = require('./config/database');
const redis = require('./config/redis');

// Import routes
const adminRoutes = require('./routes/admin');
const storeRoutes = require('./routes/store');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/order');
const customerRoutes = require('./routes/customer');
const lineWebhookRoutes = require('./routes/lineWebhook');

// Import middleware
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP'
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/customers', customerRoutes);
app.use('/webhook/line', lineWebhookRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware
app.use(errorHandler);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Join admin room for real-time updates
  socket.on('join_admin', (adminId) => {
    socket.join('admin_room');
    console.log(`Admin ${adminId} joined admin room`);
  });
  
  // Join customer room for order updates
  socket.on('join_customer', (customerId) => {
    socket.join(`customer_${customerId}`);
    console.log(`Customer ${customerId} joined customer room`);
  });
  
  // Join order room for specific order updates
  socket.on('join_order', (orderId) => {
    socket.join(`order_${orderId}`);
    console.log(`Joined order ${orderId} room`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully');
  
  server.close(() => {
    console.log('HTTP server closed');
    
    // Close database connection
    db.close().then(() => {
      console.log('Database connection closed');
      process.exit(0);
    }).catch(err => {
      console.error('Error closing database:', err);
      process.exit(1);
    });
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});