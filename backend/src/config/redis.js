const redis = require('redis');

const client = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      return new Error('Redis server refuses connection');
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error('Retry time exhausted');
    }
    if (options.attempt > 10) {
      return undefined;
    }
    return Math.min(options.attempt * 100, 3000);
  }
});

client.on('connect', () => {
  console.log('Connected to Redis');
});

client.on('error', (err) => {
  console.error('Redis error:', err);
});

// Helper functions
const redisHelpers = {
  // Cache menu items
  async cacheMenu(menuData, ttl = 3600) {
    try {
      await client.setex('menu:all', ttl, JSON.stringify(menuData));
    } catch (error) {
      console.error('Error caching menu:', error);
    }
  },

  // Get cached menu
  async getCachedMenu() {
    try {
      const cached = await client.get('menu:all');
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting cached menu:', error);
      return null;
    }
  },

  // Store order in progress
  async setOrderInProgress(orderId, orderData, ttl = 7200) {
    try {
      await client.setex(`order:${orderId}`, ttl, JSON.stringify(orderData));
    } catch (error) {
      console.error('Error caching order:', error);
    }
  },

  // Get order in progress
  async getOrderInProgress(orderId) {
    try {
      const cached = await client.get(`order:${orderId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting cached order:', error);
      return null;
    }
  },

  // Store store status
  async setStoreStatus(status) {
    try {
      await client.set('store:status', JSON.stringify(status));
    } catch (error) {
      console.error('Error caching store status:', error);
    }
  },

  // Get store status
  async getStoreStatus() {
    try {
      const cached = await client.get('store:status');
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting store status:', error);
      return null;
    }
  },

  // Invalidate cache
  async invalidateCache(pattern) {
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch (error) {
      console.error('Error invalidating cache:', error);
    }
  },

  // Store session data
  async setSession(sessionId, data, ttl = 86400) {
    try {
      await client.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
    } catch (error) {
      console.error('Error storing session:', error);
    }
  },

  // Get session data
  async getSession(sessionId) {
    try {
      const cached = await client.get(`session:${sessionId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }
};

module.exports = { client, ...redisHelpers };