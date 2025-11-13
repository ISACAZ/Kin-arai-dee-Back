const express = require('express');
const router = express.Router();

// Customer routes will be added later
router.get('/profile', (req, res) => {
  res.json({ message: 'Customer routes coming soon' });
});

module.exports = router;