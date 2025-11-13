const express = require('express');
const router = express.Router();
const lineService = require('../services/lineService');

// LINE webhook endpoint
router.post('/', async (req, res) => {
  try {
    const signature = req.get('x-line-signature');
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    if (!lineService.constructor.verifySignature(signature, body, process.env.LINE_CHANNEL_SECRET)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid signature'
      });
    }

    const events = req.body.events || [];
    
    if (events.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No events to process'
      });
    }

    // Handle webhook events
    await lineService.handleWebhook(events);

    res.status(200).json({
      success: true,
      message: 'Events processed successfully'
    });

  } catch (error) {
    console.error('LINE webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook'
    });
  }
});

// Health check for LINE webhook
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'LINE webhook is healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;