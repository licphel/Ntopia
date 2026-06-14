const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendCode, generateCode, setCode } = require('../mail');
const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 1, message: { error: '60秒内只能发送一次' } });

router.post('/send', limiter, async (req, res) => {
  const { email } = req.body;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, error: '邮箱格式错误' });
  const code = generateCode();
  setCode(email, code);
  try {
    await sendCode(email, code);
    console.log(`Email sent: ${email}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('Email error:', e.message);
    console.log(`[DEV] code=${code} email=${email}`);
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
