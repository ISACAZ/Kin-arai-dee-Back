const lineService = require('./lineService');
const redis = require('../config/redis');

class NotificationService {
  constructor() {
    this.notificationQueue = [];
    this.isProcessing = false;
  }

  // Queue notification for processing
  async queueNotification(type, userId, data) {
    const notification = {
      id: Date.now() + Math.random(),
      type,
      userId,
      data,
      timestamp: new Date(),
      retries: 0,
      maxRetries: 3
    };

    this.notificationQueue.push(notification);
    console.log(`📝 Queued notification: ${type} for ${userId}`);

    // Process queue if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  // Process notification queue
  async processQueue() {
    if (this.isProcessing || this.notificationQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    console.log(`🔄 Processing ${this.notificationQueue.length} notifications`);

    while (this.notificationQueue.length > 0) {
      const notification = this.notificationQueue.shift();
      
      try {
        await this.sendNotification(notification);
      } catch (error) {
        console.error(`❌ Failed to send notification ${notification.id}:`, error);
        
        // Retry logic
        if (notification.retries < notification.maxRetries) {
          notification.retries++;
          this.notificationQueue.push(notification);
          console.log(`🔄 Retrying notification ${notification.id} (${notification.retries}/${notification.maxRetries})`);
        } else {
          console.error(`💀 Notification ${notification.id} failed permanently`);
        }
      }

      // Rate limiting - wait between notifications
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessing = false;
    console.log(`✅ Notification queue processed`);
  }

  // Send individual notification
  async sendNotification(notification) {
    const { type, userId, data } = notification;

    switch (type) {
      case 'order_confirmation':
        await lineService.sendOrderConfirmation(userId, data);
        break;
      
      case 'order_status_update':
        await lineService.sendOrderStatusUpdate(userId, data);
        break;
      
      case 'menu_update':
        await lineService.sendMenuUpdate(userId, data);
        break;
      
      case 'store_status':
        await lineService.sendStoreStatusUpdate(userId, data);
        break;
      
      default:
        console.warn(`⚠️ Unknown notification type: ${type}`);
    }
  }

  // Broadcast notification to multiple users
  async broadcastNotification(type, userIds, data) {
    console.log(`📢 Broadcasting ${type} to ${userIds.length} users`);
    
    for (const userId of userIds) {
      await this.queueNotification(type, userId, data);
    }
  }

  // Send order confirmation
  async sendOrderConfirmation(userId, orderData) {
    await this.queueNotification('order_confirmation', userId, orderData);
  }

  // Send order status update
  async sendOrderStatusUpdate(userId, statusData) {
    await this.queueNotification('order_status_update', userId, statusData);
  }

  // Send menu update
  async sendMenuUpdate(userId, updateData) {
    await this.queueNotification('menu_update', userId, updateData);
  }

  // Send store status update
  async sendStoreStatusUpdate(userId, statusData) {
    await this.queueNotification('store_status', userId, statusData);
  }

  // Broadcast menu update to all users
  async broadcastMenuUpdate(updateData) {
    try {
      const userIds = await lineService.getSubscribedUsers();
      await this.broadcastNotification('menu_update', userIds, updateData);
    } catch (error) {
      console.error('❌ Error broadcasting menu update:', error);
    }
  }

  // Broadcast store status to all users
  async broadcastStoreStatus(statusData) {
    try {
      const userIds = await lineService.getSubscribedUsers();
      await this.broadcastNotification('store_status', userIds, statusData);
    } catch (error) {
      console.error('❌ Error broadcasting store status:', error);
    }
  }

  // Get notification statistics
  getStats() {
    return {
      queueLength: this.notificationQueue.length,
      isProcessing: this.isProcessing,
      timestamp: new Date()
    };
  }
}

module.exports = new NotificationService();