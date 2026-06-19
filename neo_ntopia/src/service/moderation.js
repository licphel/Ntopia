// AI content moderation via DeepSeek API.
const config = require('../config');

const API_URL = 'https://api.deepseek.com/chat/completions';

const PROMPTS = {
  blog: `你是一个中文博客的内容审核助手。审核用户发布的文章是否合规、是否有实质内容。

审核标准：
1. 违法违规内容（政治敏感、色情、暴力、赌博、诈骗等）→ 直接拒绝
2. 垃圾灌水（无意义字符、重复粘贴、纯广告链接）→ 拒绝
3. 内容过短或质量过低（少于50个有效汉字，且无明显信息量）→ 拒绝
4. 正常的技术分享、生活记录、讨论交流 → 通过

请仅回复一个JSON对象，不要包含其他文字：
{"pass": true/false, "reason": "简短中文原因（10字以内）"}`,

  forum: `你是一个中文论坛的讨论审核助手。论坛区允许较随意的讨论，审核标准放宽。

审核标准：
1. 违法违规内容（政治敏感、色情、暴力、赌博、诈骗等）→ 直接拒绝
2. 纯垃圾灌水（无意义字符、重复粘贴、纯广告链接）→ 拒绝
3. 其他一切正常讨论、提问、闲聊、简短发言 → 通过

请仅回复一个JSON对象，不要包含其他文字：
{"pass": true/false, "reason": "简短中文原因（10字以内）"}`,

  comment: `你是一个中文社区的评论审核助手。评论审核仅关注合法合规性，不关注内容质量。

审核标准：
1. 违法违规内容（政治敏感、色情、暴力、赌博、诈骗等）→ 拒绝
2. 其他一切内容 → 通过

请仅回复一个JSON对象，不要包含其他文字：
{"pass": true/false, "reason": "简短中文原因（10字以内）"}`,
};

async function callAPI(systemPrompt, userText, timeout) {
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      console.error('[moderation] API error:', resp.status);
      return { pass: true };
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const json = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(json);
    return { pass: !!result.pass, reason: result.reason || '' };
  } catch (e) {
    console.error('[moderation] Error:', e.message);
    return { pass: true };
  }
}

const moderationService = {
  /** Check if moderation is enabled and configured. */
  isEnabled() {
    return config.ENABLE_MODERATION && !!config.DEEPSEEK_API_KEY;
  },

  /** Review a blog post or forum discussion. */
  async review(title, content, category) {
    if (!this.isEnabled()) return { pass: true };

    const isForum = category === 'forum';
    const prompt = isForum ? PROMPTS.forum : PROMPTS.blog;
    const text = `标题：${(title || '').slice(0, 200)}\n\n正文：${(content || '').slice(0, 3000)}`;
    const label = isForum ? '讨论' : '文章';

    return callAPI(prompt, `请审核以下${label}：\n\n${text}`, config.MODERATION_TIMEOUT);
  },

  /** Review a comment. */
  async reviewComment(content) {
    if (!this.isEnabled()) return { pass: true };

    const text = (content || '').slice(0, 1000);
    return callAPI(PROMPTS.comment, `请审核以下评论：\n\n${text}`, config.COMMENT_MODERATION_TIMEOUT);
  },
};

module.exports = moderationService;
