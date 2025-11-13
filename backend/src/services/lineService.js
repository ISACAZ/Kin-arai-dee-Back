const { Client } = require('@line/bot-sdk');
const axios = require('axios');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);

class LineService {
  constructor() {
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  }

  // ============ Order Related Messages ============

  // Send order confirmation message
  async sendOrderConfirmation(userId, orderData) {
    try {
      const { orderNumber, items, totalAmount, estimatedTime } = orderData;
      
      const message = {
        type: 'flex',
        altText: `ยืนยันออเดอร์ #${orderNumber}`,
        contents: {
          type: 'bubble',
          size: 'giga',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '🍽️ ยืนยันออเดอร์',
                weight: 'bold',
                size: 'xl',
                color: '#ffffff',
                align: 'center'
              },
              {
                type: 'text',
                text: `#${orderNumber}`,
                size: 'md',
                color: '#ffffff',
                align: 'center',
                margin: 'sm'
              }
            ],
            backgroundColor: '#27ACB2',
            paddingAll: 'lg',
            spacing: 'sm'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '📋 รายการอาหาร',
                weight: 'bold',
                size: 'lg',
                color: '#333333',
                margin: 'none'
              },
              {
                type: 'separator',
                margin: 'md'
              },
              // รายการอาหาร
              {
                type: 'box',
                layout: 'vertical',
                contents: items.slice(0, 8).map(item => ({ // จำกัด 8 รายการ
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: `${item.name}`,
                      flex: 3,
                      size: 'sm',
                      wrap: true,
                      color: '#666666'
                    },
                    {
                      type: 'text',
                      text: `x${item.quantity}`,
                      flex: 1,
                      align: 'center',
                      size: 'sm',
                      color: '#666666'
                    },
                    {
                      type: 'text',
                      text: `${item.total_price}฿`,
                      flex: 1,
                      align: 'end',
                      size: 'sm',
                      weight: 'bold',
                      color: '#27ACB2'
                    }
                  ],
                  margin: 'sm'
                })),
                margin: 'md',
                spacing: 'sm'
              },
              // แสดงจำนวนรายการเพิ่มเติม
              ...(items.length > 8 ? [{
                type: 'text',
                text: `และอีก ${items.length - 8} รายการ...`,
                size: 'xs',
                color: '#999999',
                align: 'center',
                margin: 'sm'
              }] : []),
              {
                type: 'separator',
                margin: 'lg'
              },
              // ยอดรวม
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: 'ยอดรวมทั้งหมด',
                    weight: 'bold',
                    size: 'lg',
                    flex: 1,
                    color: '#333333'
                  },
                  {
                    type: 'text',
                    text: `${totalAmount}฿`,
                    weight: 'bold',
                    size: 'xl',
                    align: 'end',
                    color: '#FF6B35'
                  }
                ],
                margin: 'md'
              },
              // เวลาโดยประมาณ
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '⏱️ เวลาโดยประมาณ',
                    flex: 1,
                    size: 'sm',
                    color: '#666666'
                  },
                  {
                    type: 'text',
                    text: `${estimatedTime} นาที`,
                    align: 'end',
                    size: 'sm',
                    weight: 'bold',
                    color: '#333333'
                  }
                ],
                margin: 'sm'
              }
            ],
            spacing: 'sm'
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '📱 ติดตามสถานะออเดอร์',
                  uri: `${this.frontendUrl}/order-status?order=${orderNumber}`
                },
                style: 'primary',
                color: '#27ACB2',
                height: 'sm'
              },
              {
                type: 'spacer',
                size: 'sm'
              },
              {
                type: 'text',
                text: 'ขอบคุณที่สั่งอาหารกับเรา! 🙏',
                size: 'xs',
                color: '#999999',
                align: 'center'
              }
            ],
            spacing: 'sm'
          }
        }
      };

      await client.pushMessage(userId, message);
      console.log(`✅ Order confirmation sent to ${userId} for order ${orderNumber}`);
    } catch (error) {
      console.error('❌ Error sending order confirmation:', error);
      throw error;
    }
  }

  // Send order status update
  async sendOrderStatusUpdate(userId, statusData) {
    try {
      const { orderNumber, status, statusMessage, estimatedTime } = statusData;
      
      // Status configurations
      const statusConfig = {
        'confirmed': {
          emoji: '✅',
          color: '#27ACB2',
          backgroundColor: '#E8F5F5',
          title: 'ยืนยันออเดอร์แล้ว'
        },
        'preparing': {
          emoji: '👨‍🍳',
          color: '#FF9500',
          backgroundColor: '#FFF4E6',
          title: 'กำลังเตรียมอาหาร'
        },
        'ready': {
          emoji: '🔔',
          color: '#FF6B35',
          backgroundColor: '#FFEBE6',
          title: 'อาหารพร้อมแล้ว!'
        },
        'completed': {
          emoji: '🎉',
          color: '#34C759',
          backgroundColor: '#E8F5E8',
          title: 'เสิร์ฟเรียบร้อย'
        },
        'cancelled': {
          emoji: '❌',
          color: '#FF3B30',
          backgroundColor: '#FFE6E6',
          title: 'ยกเลิกออเดอร์'
        }
      };

      const config = statusConfig[status] || statusConfig['confirmed'];
      
      let message;

      if (status === 'ready') {
        // Special urgent message for ready status
        message = {
          type: 'flex',
          altText: `${config.emoji} อาหารพร้อมแล้ว!`,
          contents: {
            type: 'bubble',
            header: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: '🔔 อาหารพร้อมแล้ว!',
                  weight: 'bold',
                  size: 'xl',
                  color: '#ffffff',
                  align: 'center'
                }
              ],
              backgroundColor: config.color,
              paddingAll: 'lg'
            },
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: `ออเดอร์ #${orderNumber}`,
                  weight: 'bold',
                  size: 'lg',
                  align: 'center',
                  color: '#333333'
                },
                {
                  type: 'spacer',
                  size: 'md'
                },
                {
                  type: 'text',
                  text: '🏃‍♂️ กรุณามารับอาหารที่ร้าน',
                  size: 'md',
                  align: 'center',
                  wrap: true,
                  color: '#666666'
                },
                {
                  type: 'text',
                  text: 'อาหารร้อนๆ รอคุณอยู่! 🍽️',
                  size: 'sm',
                  align: 'center',
                  color: '#999999',
                  margin: 'sm'
                }
              ],
              spacing: 'sm'
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  action: {
                    type: 'uri',
                    label: '📍 ดูที่ตั้งร้าน',
                    uri: `${this.frontendUrl}/location`
                  },
                  style: 'primary',
                  color: config.color
                }
              ]
            }
          }
        };
      } else {
        // Regular status update message
        message = {
          type: 'flex',
          altText: `${config.emoji} ${statusMessage}`,
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: config.emoji,
                      size: '3xl',
                      flex: 1,
                      align: 'center'
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      contents: [
                        {
                          type: 'text',
                          text: config.title,
                          weight: 'bold',
                          size: 'lg',
                          color: config.color
                        },
                        {
                          type: 'text',
                          text: `ออเดอร์ #${orderNumber}`,
                          size: 'md',
                          color: '#666666',
                          margin: 'sm'
                        }
                      ],
                      flex: 3
                    }
                  ],
                  backgroundColor: config.backgroundColor,
                  paddingAll: 'md',
                  cornerRadius: '8px'
                },
                ...(estimatedTime ? [{
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    {
                      type: 'text',
                      text: '⏰ เวลาโดยประมาณ',
                      flex: 1,
                      size: 'sm',
                      color: '#666666'
                    },
                    {
                      type: 'text',
                      text: `${estimatedTime} นาที`,
                      align: 'end',
                      size: 'sm',
                      weight: 'bold',
                      color: config.color
                    }
                  ],
                  margin: 'lg'
                }] : [])
              ],
              spacing: 'md'
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  action: {
                    type: 'uri',
                    label: '📱 ดูรายละเอียดออเดอร์',
                    uri: `${this.frontendUrl}/order-status?order=${orderNumber}`
                  },
                  style: 'link',
                  color: config.color
                }
              ]
            }
          }
        };
      }

      await client.pushMessage(userId, message);
      console.log(`✅ Status update sent to ${userId}: ${status} for order ${orderNumber}`);
    } catch (error) {
      console.error('❌ Error sending status update:', error);
      throw error;
    }
  }

  // ============ Menu Related Messages ============

  // Send menu update notification
  async sendMenuUpdate(userId, updateData) {
    try {
      const { item_name, message: updateMessage, stock_status, is_available } = updateData;
      
      let emoji = '📝';
      let color = '#27ACB2';
      
      if (!is_available || stock_status === 'out_of_stock') {
        emoji = '❌';
        color = '#FF3B30';
      } else if (stock_status === 'low_stock') {
        emoji = '⚠️';
        color = '#FF9500';
      } else if (is_available) {
        emoji = '✅';
        color = '#34C759';
      }
      
      const message = {
        type: 'flex',
        altText: `${emoji} อัพเดตเมนู: ${item_name}`,
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: `${emoji} อัพเดตเมนู`,
                weight: 'bold',
                size: 'lg',
                color: color
              },
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'text',
                text: item_name,
                size: 'md',
                weight: 'bold',
                color: '#333333',
                margin: 'md'
              },
              {
                type: 'text',
                text: updateMessage,
                size: 'sm',
                color: '#666666',
                wrap: true,
                margin: 'sm'
              }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '📋 ดูเมนูทั้งหมด',
                  uri: `${this.frontendUrl}/menu`
                },
                style: 'link',
                color: color
              }
            ]
          }
        }
      };
      
      await client.pushMessage(userId, message);
      console.log(`✅ Menu update sent to ${userId}: ${item_name}`);
    } catch (error) {
      console.error('❌ Error sending menu update:', error);
      throw error;
    }
  }

  // ============ Store Related Messages ============

  // Send store status update
  async sendStoreStatusUpdate(userId, statusData) {
    try {
      const { is_open, message: statusMessage } = statusData;
      
      const emoji = is_open ? '🟢' : '🔴';
      const color = is_open ? '#34C759' : '#FF3B30';
      const title = is_open ? 'ร้านเปิดแล้ว!' : 'ร้านปิดชั่วคราว';
      
      const message = {
        type: 'flex',
        altText: `${emoji} ${title}`,
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: `${emoji} ${title}`,
                weight: 'bold',
                size: 'xl',
                color: color,
                align: 'center'
              },
              {
                type: 'text',
                text: statusMessage || (is_open ? 'พร้อมรับออเดอร์แล้ว' : 'ขออภัยในความไม่สะดวก'),
                size: 'md',
                color: '#666666',
                align: 'center',
                wrap: true,
                margin: 'md'
              }
            ]
          },
          ...(is_open ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  action: {
                    type: 'uri',
                    label: '🛒 สั่งอาหารเลย',
                    uri: `${this.frontendUrl}/menu`
                  },
                  style: 'primary',
                  color: color
                }
              ]
            }
          } : {})
        }
      };
      
      await client.pushMessage(userId, message);
      console.log(`✅ Store status sent to ${userId}: ${is_open ? 'open' : 'closed'}`);
    } catch (error) {
      console.error('❌ Error sending store status:', error);
      throw error;
    }
  }

  // ============ Broadcast Messages ============

  // Broadcast to multiple users
  async broadcastMessage(userIds, message) {
    try {
      const promises = userIds.map(userId => 
        client.pushMessage(userId, message).catch(err => 
          console.error(`Failed to send to ${userId}:`, err)
        )
      );
      
      await Promise.all(promises);
      console.log(`✅ Broadcast sent to ${userIds.length} users`);
    } catch (error) {
      console.error('❌ Error broadcasting message:', error);
      throw error;
    }
  }

  // ============ Interactive Messages ============

  // Send main menu (Rich Menu)
  async sendMainMenu(userId) {
    try {
      const message = {
        type: 'flex',
        altText: 'เมนูหลัก',
        contents: {
          type: 'carousel',
          contents: [
            {
              type: 'bubble',
              hero: {
                type: 'image',
                url: 'https://via.placeholder.com/1024x682/27ACB2/FFFFFF?text=Menu',
                size: 'full',
                aspectRatio: '20:13',
                aspectMode: 'cover'
              },
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '📋 ดูเมนู',
                    weight: 'bold',
                    size: 'lg'
                  },
                  {
                    type: 'text',
                    text: 'เลือกดูเมนูอาหารทั้งหมด',
                    size: 'sm',
                    color: '#666666',
                    margin: 'md'
                  }
                ]
              },
              footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'button',
                    action: {
                      type: 'uri',
                      label: 'ดูเมนู',
                      uri: `${this.frontendUrl}/menu`
                    },
                    style: 'primary',
                    color: '#27ACB2'
                  }
                ]
              }
            },
            {
              type: 'bubble',
              hero: {
                type: 'image',
                url: 'https://via.placeholder.com/1024x682/FF6B35/FFFFFF?text=Order',
                size: 'full',
                aspectRatio: '20:13',
                aspectMode: 'cover'
              },
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '🛒 สั่งอาหาร',
                    weight: 'bold',
                    size: 'lg'
                  },
                  {
                    type: 'text',
                    text: 'สั่งอาหารออนไลน์ง่ายๆ',
                    size: 'sm',
                    color: '#666666',
                    margin: 'md'
                  }
                ]
              },
              footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'button',
                    action: {
                      type: 'uri',
                      label: 'สั่งเลย',
                      uri: `${this.frontendUrl}/order`
                    },
                    style: 'primary',
                    color: '#FF6B35'
                  }
                ]
              }
            }
          ]
        }
      };

      await client.pushMessage(userId, message);
      console.log(`✅ Main menu sent to ${userId}`);
    } catch (error) {
      console.error('❌ Error sending main menu:', error);
      throw error;
    }
  }

  // ============ Webhook Event Handlers ============

  // Handle all webhook events
  async handleWebhook(events) {
    try {
      const promises = events.map(event => this.handleEvent(event));
      await Promise.all(promises);
    } catch (error) {
      console.error('❌ Error handling webhook:', error);
      throw error;
    }
  }

  // Handle individual event
  async handleEvent(event) {
    try {
      const { type, source, message, postback } = event;
      const userId = source.userId;

      console.log(`📨 Received event: ${type} from ${userId}`);

      switch (type) {
        case 'message':
          if (message.type === 'text') {
            await this.handleTextMessage(userId, message.text);
          }
          break;
          
        case 'postback':
          await this.handlePostback(userId, postback);
          break;
          
        case 'follow':
          await this.handleFollow(userId);
          break;
          
        case 'unfollow':
          await this.handleUnfollow(userId);
          break;
          
        default:
          console.log(`⚠️ Unknown event type: ${type}`);
      }
    } catch (error) {
      console.error('❌ Error handling event:', error);
    }
  }

  // Handle text messages
  async handleTextMessage(userId, text) {
    try {
      const lowerText = text.toLowerCase().trim();
      
      // Command patterns
      if (lowerText.match(/^(hi|hello|สวัสดี|หวัดดี)/)) {
        await this.sendWelcomeMessage(userId);
      } else if (lowerText.match(/(เมนู|menu|อาหาร)/)) {
        await this.sendMainMenu(userId);
      } else if (lowerText.match(/(สถานะ|status|ออเดอร์|order)/)) {
        await this.sendOrderStatusHelp(userId);
      } else if (lowerText.match(/(ร้าน|เปิด|ปิด|shop|store)/)) {
        await this.sendCurrentStoreStatus(userId);
      } else if (lowerText.match(/(ช่วย|help|คำสั่ง)/)) {
        await this.sendHelpMessage(userId);
      } else if (lowerText.match(/^(ord|ORD)\d+/)) {
        // Order number pattern
        const orderNumber = text.match(/(ORD\d+)/i)?.[1];
        if (orderNumber) {
          await this.sendOrderStatusById(userId, orderNumber);
        }
      } else {
        // Default response
        await this.sendDefaultResponse(userId, text);
      }
    } catch (error) {
      console.error('❌ Error handling text message:', error);
      await this.sendErrorMessage(userId);
    }
  }

  // Handle postback actions
  async handlePostback(userId, postback) {
    try {
      const { data } = postback;
      const params = new URLSearchParams(data);
      const action = params.get('action');

      switch (action) {
        case 'view_menu':
          await this.sendMainMenu(userId);
          break;
        case 'order_status':
          await this.sendOrderStatusHelp(userId);
          break;
        case 'store_status':
          await this.sendCurrentStoreStatus(userId);
          break;
        case 'help':
          await this.sendHelpMessage(userId);
          break;
        default:
          console.log(`⚠️ Unknown postback action: ${action}`);
      }
    } catch (error) {
      console.error('❌ Error handling postback:', error);
    }
  }

  // Handle new followers
  async handleFollow(userId) {
    try {
      // Get user profile
      const profile = await client.getProfile(userId);
      
      // Save user to database
      const db = require('../config/database');
      await db.execute(`
        INSERT INTO customers (line_user_id, display_name)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE 
        display_name = VALUES(display_name),
        updated_at = CURRENT_TIMESTAMP
      `, [userId, profile.displayName]);

      console.log(`✅ New follower: ${profile.displayName} (${userId})`);

      // Send welcome message
      await this.sendWelcomeMessage(userId, profile.displayName);
      
    } catch (error) {
      console.error('❌ Error handling follow:', error);
    }
  }

  // Handle unfollows
  async handleUnfollow(userId) {
    try {
      console.log(`👋 User unfollowed: ${userId}`);
      // Optional: Update database to mark user as inactive
    } catch (error) {
      console.error('❌ Error handling unfollow:', error);
    }
  }

  // ============ Helper Messages ============

  // Send welcome message
  async sendWelcomeMessage(userId, displayName = '') {
    try {
      const greeting = displayName ? `สวัสดี ${displayName}! 👋` : 'สวัสดี! 👋';
      
      const message = {
        type: 'flex',
        altText: 'ยินดีต้อนรับ',
        contents: {
          type: 'bubble',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '🍽️ ยินดีต้อนรับ',
                weight: 'bold',
                size: 'xl',
                color: '#ffffff',
                align: 'center'
              }
            ],
            backgroundColor: '#27ACB2',
            paddingAll: 'lg'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: greeting,
                size: 'lg',
                weight: 'bold',
                align: 'center',
                color: '#333333'
              },
              {
                type: 'text',
                text: 'สั่งอาหารออนไลน์ง่ายๆ ผ่าน LINE\nพร้อมติดตามสถานะแบบเรียลไทม์',
                wrap: true,
                align: 'center',
                margin: 'md',
                color: '#666666'
              },
              {
                type: 'separator',
                margin: 'lg'
              },
              {
                type: 'text',
                text: '🎯 สิ่งที่คุณทำได้:',
                weight: 'bold',
                margin: 'lg',
                color: '#333333'
              },
              {
                type: 'text',
                text: '📋 ดูเมนูอาหารทั้งหมด\n🛒 สั่งอาหารออนไลน์\n📱 ติดตามสถานะออเดอร์\n🏪 เช็คสถานะร้าน',
                wrap: true,
                margin: 'sm',
                color: '#666666',
                size: 'sm'
              }
            ],
            spacing: 'sm'
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '🛒 เริ่มสั่งอาหาร',
                  uri: `${this.frontendUrl}/menu`
                },
                style: 'primary',
                color: '#27ACB2'
              },
              {
                type: 'button',
                action: {
                  type: 'postback',
                  label: '❓ ช่วยเหลือ',
                  data: 'action=help'
                },
                style: 'link',
                color: '#666666'
              }
            ],
            spacing: 'sm'
          }
        }
      };

      await client.pushMessage(userId, message);
      console.log(`✅ Welcome message sent to ${userId}`);
    } catch (error) {
      console.error('❌ Error sending welcome message:', error);
    }
  }

  // Send help message
  async sendHelpMessage(userId) {
    try {
      const message = {
        type: 'flex',
        altText: 'คำสั่งที่ใช้ได้',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '❓ คำสั่งที่ใช้ได้',
                weight: 'bold',
                size: 'lg',
                color: '#27ACB2'
              },
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '📋 "เมนู" หรือ "menu" - ดูเมนูอาหาร',
                    size: 'sm',
                    color: '#333333',
                    margin: 'md'
                  },
                  {
                    type: 'text',
                    text: '📱 "สถานะ" หรือ "ORD123" - เช็คออเดอร์',
                    size: 'sm',
                    color: '#333333',
                    margin: 'sm'
                  },
                  {
                    type: 'text',
                    text: '🏪 "ร้าน" หรือ "เปิด" - สถานะร้าน',
                    size: 'sm',
                    color: '#333333',
                    margin: 'sm'
                  },
                  {
                    type: 'text',
                    text: '👋 "สวัสดี" หรือ "hi" - ทักทาย',
                    size: 'sm',
                    color: '#333333',
                    margin: 'sm'
                  }
                ]
              }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '🛒 สั่งอาหารเลย',
                  uri: `${this.frontendUrl}/menu`
                },
                style: 'primary',
                color: '#27ACB2'
              }
            ]
          }
        }
      };

      await client.pushMessage(userId, message);
      console.log(`✅ Help message sent to ${userId}`);
    } catch (error) {
      console.error('❌ Error sending help message:', error);
    }
  }

  // Send current store status
  async sendCurrentStoreStatus(userId) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/api/store/status`);
      const storeData = response.data.data;
      
      const isOpen = storeData.is_open;
      const emoji = isOpen ? '🟢' : '🔴';
      const status = isOpen ? 'เปิดให้บริการ' : 'ปิดร้าน';
      const color = isOpen ? '#34C759' : '#FF3B30';
      
      let timeInfo = '';
      if (isOpen && storeData.opened_at) {
        const openTime = new Date(storeData.opened_at).toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit'
        });
        timeInfo = `\n🕐 เปิดเมื่อ: ${openTime}`;
      }
      
      const message = {
        type: 'flex',
        altText: `${emoji} สถานะร้าน: ${status}`,
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: `${emoji} สถานะร้าน`,
                weight: 'bold',
                size: 'xl',
                color: color,
                align: 'center'
              },
              {
                type: 'text',
                text: status,
                size: 'lg',
                weight: 'bold',
                align: 'center',
                color: '#333333',
                margin: 'md'
              },
              ...(timeInfo ? [{
                type: 'text',
                text: timeInfo,
                size: 'sm',
                color: '#666666',
                align: 'center',
                margin: 'sm'
              }] : []),
              {
                type: 'text',
                text: isOpen ? 'พร้อมรับออเดอร์แล้ว! 🍽️' : 'ขออภัยในความไม่สะดวก 🙏',
                size: 'sm',
                color: '#666666',
                align: 'center',
                margin: 'md'
              }
            ]
          },
          ...(isOpen ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  action: {
                    type: 'uri',
                    label: '🛒 สั่งอาหารเลย',
                    uri: `${this.frontendUrl}/menu`
                  },
                  style: 'primary',
                  color: '#27ACB2'
                }
              ]
            }
          } : {})
        }
      };
      
      await client.pushMessage(userId, message);
      console.log(`✅ Store status sent to ${userId}: ${status}`);
    } catch (error) {
      console.error('❌ Error sending store status:', error);
      await client.pushMessage(userId, {
        type: 'text',
        text: '❌ ไม่สามารถตรวจสอบสถานะร้านได้ในขณะนี้'
      });
    }
  }

  // Send order status help
  async sendOrderStatusHelp(userId) {
    try {
      const message = {
        type: 'flex',
        altText: 'วิธีเช็คสถานะออเดอร์',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '📱 เช็คสถานะออเดอร์',
                weight: 'bold',
                size: 'lg',
                color: '#27ACB2'
              },
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'text',
                text: 'วิธีเช็คสถานะ:',
                weight: 'bold',
                margin: 'md',
                color: '#333333'
              },
              {
                type: 'text',
                text: '1️⃣ พิมพ์หมายเลขออเดอร์ เช่น "ORD123"\n2️⃣ กดปุ่ม "ติดตามออเดอร์" ด้านล่าง\n3️⃣ รอรับการแจ้งเตือนแบบอัตโนมัติ',
                wrap: true,
                margin: 'sm',
                color: '#666666',
                size: 'sm'
              }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '📱 ติดตามออเดอร์',
                  uri: `${this.frontendUrl}/order-status`
                },
                style: 'primary',
                color: '#27ACB2'
              }
            ]
          }
        }
      };

      await client.pushMessage(userId, message);
      console.log(`✅ Order status help sent to ${userId}`);
    } catch (error) {
      console.error('❌ Error sending order status help:', error);
    }
  }

  // Send order status by ID
  async sendOrderStatusById(userId, orderNumber) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/api/orders/status?order_number=${orderNumber}`);
      const orderData = response.data.data;
      
      if (!orderData) {
        await client.pushMessage(userId, {
          type: 'text',
          text: `❌ ไม่พบออเดอร์ ${orderNumber}\nกรุณาตรวจสอบหมายเลขออเดอร์อีกครั้ง`
        });
        return;
      }

      // Send current status
      await this.sendOrderStatusUpdate(userId, {
        orderNumber: orderData.order_number,
        status: orderData.status,
        statusMessage: this.getStatusMessage(orderData.status),
        estimatedTime: orderData.estimated_time
      });

    } catch (error) {
      console.error('❌ Error getting order status:', error);
      await client.pushMessage(userId, {
        type: 'text',
        text: `❌ ไม่สามารถตรวจสอบออเดอร์ ${orderNumber} ได้\nลองใหม่อีกครั้งหรือติดต่อร้าน`
      });
    }
  }

  // Send default response
  async sendDefaultResponse(userId, text) {
    try {
      const message = {
        type: 'flex',
        altText: 'ไม่เข้าใจคำสั่ง',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '🤔 ไม่เข้าใจคำสั่ง',
                weight: 'bold',
                size: 'lg',
                color: '#FF9500',
                align: 'center'
              },
              {
                type: 'text',
                text: `คุณพิมพ์: "${text}"`,
                size: 'sm',
                color: '#666666',
                align: 'center',
                margin: 'md',
                wrap: true
              },
              {
                type: 'text',
                text: 'ลองพิมพ์คำสั่งใหม่ หรือกดปุ่มด้านล่าง',
                size: 'sm',
                color: '#666666',
                align: 'center',
                margin: 'sm'
              }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                action: {
                  type: 'postback',
                  label: '❓ ดูคำสั่งที่ใช้ได้',
                  data: 'action=help'
                },
                style: 'link',
                color: '#27ACB2'
              },
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '🛒 สั่งอาหาร',
                  uri: `${this.frontendUrl}/menu`
                },
                style: 'primary',
                color: '#27ACB2'
              }
            ],
            spacing: 'sm'
          }
        }
      };

      await client.pushMessage(userId, message);
      console.log(`✅ Default response sent to ${userId}`);
    } catch (error) {
      console.error('❌ Error sending default response:', error);
    }
  }

  // Send error message
  async sendErrorMessage(userId) {
    try {
      await client.pushMessage(userId, {
        type: 'text',
        text: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง\nหรือติดต่อทางร้านโดยตรง'
      });
    } catch (error) {
      console.error('❌ Error sending error message:', error);
    }
  }

  // ============ Utility Functions ============

  // Get status message in Thai
  getStatusMessage(status) {
    const messages = {
      'received': 'รับออเดอร์แล้ว',
      'confirmed': 'ยืนยันออเดอร์แล้ว',
      'preparing': 'กำลังเตรียมอาหาร',
      'ready': 'อาหารพร้อมแล้ว',
      'completed': 'เสิร์ฟเรียบร้อย',
      'cancelled': 'ยกเลิกออเดอร์'
    };
    return messages[status] || status;
  }

  // Get user profile
  async getUserProfile(userId) {
    try {
      return await client.getProfile(userId);
    } catch (error) {
      console.error('❌ Error getting user profile:', error);
      return null;
    }
  }

  // Verify webhook signature
  static verifySignature(signature, body, channelSecret) {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('SHA256', channelSecret)
      .update(body, 'utf8')
      .digest('base64');
    
    return signature === hash;
  }

  // Get all subscribed users (for broadcasting)
  async getSubscribedUsers() {
    try {
      const db = require('../config/database');
      const [users] = await db.execute(`
        SELECT DISTINCT line_user_id 
        FROM customers 
        WHERE line_user_id IS NOT NULL 
        AND line_user_id != ''
      `);
      
      return users.map(user => user.line_user_id);
    } catch (error) {
      console.error('❌ Error getting subscribed users:', error);
      return [];
    }
  }

  // Broadcast to all users
  async broadcastToAllUsers(message) {
    try {
      const userIds = await this.getSubscribedUsers();
      console.log(`📢 Broadcasting to ${userIds.length} users`);
      
      // Send in batches to avoid rate limiting
      const batchSize = 500; // LINE API limit
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        await this.broadcastMessage(batch, message);
        
        // Wait between batches
        if (i + batchSize < userIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log(`✅ Broadcast completed to ${userIds.length} users`);
    } catch (error) {
      console.error('❌ Error broadcasting to all users:', error);
      throw error;
    }
  }
}

module.exports = new LineService();