const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const tab = req.query.tab || 'theme';
  res.render('settings', { title: '设置', tab });
});

module.exports = router;
