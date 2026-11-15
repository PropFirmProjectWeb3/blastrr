const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { CHAT_COOLDOWN_MS, MAX_CHAT_MESSAGE_LENGTH, moderateChatMessage } = require('../chatRules');

test('public chat moderation permits ordinary text and trims whitespace', () => {
  assert.deepEqual(moderateChatMessage('  BTC is moving today  '), {
    valid: true,
    message: 'BTC is moving today'
  });
  assert.deepEqual(moderateChatMessage(''), {
    valid: false,
    error: 'Enter a message before sending.'
  });
  assert.equal(moderateChatMessage('x'.repeat(MAX_CHAT_MESSAGE_LENGTH)).valid, true);
  assert.equal(moderateChatMessage('x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1)).valid, false);
  assert.equal(CHAT_COOLDOWN_MS, 60000);
});

test('public chat moderation blocks URLs, profanity, scam prompts, and control characters', () => {
  for (const message of [
    'https://example.com',
    'www.example.org',
    'visit crypto.scam',
    'open 192.168.1.100',
    'Join at sub.domain.example.io',
    'This is shit',
    'DM me for guaranteed profit',
    'Send me your recovery phrase',
    'Try this\u0007message'
  ]) {
    assert.equal(moderateChatMessage(message).valid, false, message);
  }
});

test('chat API, persistence, eligibility, and terminal surface are wired together', () => {
  const databaseJs = fs.readFileSync('database.js', 'utf8');
  const serverJs = fs.readFileSync('server.js', 'utf8');
  const appHtml = fs.readFileSync('public/app.html', 'utf8');
  const appJs = fs.readFileSync('public/js/app.js', 'utf8');
  const appCss = fs.readFileSync('public/css/app.css', 'utf8');
  const chatHtml = fs.readFileSync('public/chat.html', 'utf8');
  const chatJs = fs.readFileSync('public/js/chat.js', 'utf8');
  const chatCss = fs.readFileSync('public/css/chat.css', 'utf8');

  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS public_chat_messages/);
  assert.match(databaseJs, /idx_public_chat_market_created/);
  assert.match(databaseJs, /idx_public_chat_wallet_created/);
  assert.match(serverJs, /app\.get\('\/api\/chat\/messages'/);
  assert.match(serverJs, /app\.post\('\/api\/chat\/messages', sensitiveLimiter, requireWalletSession, requireUserNotSuspended/);
  assert.match(serverJs, /COALESCE\(NULLIF\(u\.username, ''\), 'Trader'\) AS username/);
  assert.match(serverJs, /getBattlePassLevel\(message\.battlepass_xp\)/);
  assert.match(serverJs, /refreshRiskBaselines\(accountId/);
  assert.match(serverJs, /refreshAccountLock\(account/);
  assert.match(serverJs, /Number\(account\.admin_frozen\) !== 1/);
  assert.match(serverJs, /INSERT INTO public_chat_messages[\s\S]*?WHERE NOT EXISTS/);
  assert.match(serverJs, /CHAT_COOLDOWN_MS/);
  assert.match(appHtml, /id="market-chat-messages"[^>]*role="log"/);
  assert.match(appHtml, /id="market-chat-form"/);
  assert.match(appHtml, /maxlength="500"/);
  assert.match(appJs, /function startMarketChat\(symbol, label\)/);
  assert.match(appJs, /function updateMarketChatControls\(\)/);
  assert.match(appJs, /function postMarketChatMessage\(event\)/);
  assert.match(appJs, /escapeHTML\(message\.body\)/);
  assert.match(appJs, /window\.open\(`\/chat\.html\?symbol=/);
  assert.match(appJs, /event\.origin !== window\.location\.origin/);
  assert.match(appJs, /message\.battlepass_level/);
  assert.match(appJs, /class="market-chat-player-card" role="tooltip"/);
  assert.match(chatHtml, /id="chat-messages"[^>]*role="log"/);
  assert.match(chatHtml, /id="chat-market"/);
  assert.match(chatJs, /event\.source !== window\.opener/);
  assert.match(chatJs, /Authorization: `Bearer \$\{state\.token\}`/);
  assert.match(chatJs, /class="chat-player-card" role="tooltip"/);
  assert.match(chatCss, /\.chat-player-card/);
  assert.match(appCss, /\.market-chat-messages/);
  assert.match(appCss, /\.market-chat-player-card/);

  const closeTrade = appJs.slice(appJs.indexOf('async function closeTrade('), appJs.indexOf('\n        async function ', appJs.indexOf('async function closeTrade(') + 1));
  assert.doesNotMatch(closeTrade, /confirm\(/);
});
