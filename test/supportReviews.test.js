const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const databaseJs = fs.readFileSync('database.js', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');
const landingHtml = fs.readFileSync('public/index.html', 'utf8');

test('support ticket and review schema is text-only and constrained', () => {
  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS support_tickets/);
  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS support_ticket_messages/);
  assert.match(databaseJs, /CHECK\(author_role IN \('USER', 'ADMIN'\)\)/);
  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS user_reviews/);
  assert.match(databaseJs, /rating INTEGER NOT NULL CHECK\(rating BETWEEN 1 AND 5\)/);
  assert.match(databaseJs, /published INTEGER NOT NULL DEFAULT 0/);
  assert.match(appHtml, /id="ticket-message"[^>]*maxlength="5000"/);
  assert.doesNotMatch(appHtml, /<input\b[^>]*type=["']file["']/i);
});

test('ticket endpoints enforce wallet ownership, account ownership, and admin authorization', () => {
  assert.match(serverJs, /app\.get\('\/api\/user\/tickets', requireWalletSession/);
  assert.match(serverJs, /LOWER\(t\.wallet_address\) = LOWER\(\?\)/);
  assert.match(serverJs, /accounts WHERE id = \? AND LOWER\(wallet_address\) = LOWER\(\?\)/);
  assert.match(serverJs, /app\.post\('\/api\/user\/tickets\/:ticketId\/reply', sensitiveLimiter, requireWalletSession/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/tickets', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/tickets\/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /ticket\.status === 'CLOSED'/);
  assert.match(serverJs, /SET status = 'OPEN'/);
  assert.match(serverJs, /'NEEDS_INFO'/);
});

test('review submission and moderation are wallet-bound and admin-protected', () => {
  assert.match(serverJs, /app\.post\('\/api\/user\/reviews', sensitiveLimiter, requireWalletSession/);
  assert.match(serverJs, /rating < 1 \|\| rating > 5/);
  assert.match(serverJs, /published = 0/);
  assert.match(serverJs, /app\.get\('\/api\/reviews'/);
  assert.match(serverJs, /FROM user_reviews WHERE published = 1/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/reviews', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/reviews\/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
});

test('support and moderation views render action controls and visual ticket statuses', () => {
  assert.match(appHtml, /id="user-ticket-list"/);
  assert.match(appHtml, /id="admin-ticket-list"/);
  assert.match(appHtml, /id="admin-review-list"/);
  assert.match(appJs, /data-admin-ticket-action="REPLY"/);
  assert.match(appJs, /data-admin-ticket-action="CLOSE"/);
  assert.match(appJs, /data-review-action="\$\{Number\(review\.published\) \? 'HIDE' : 'PUBLISH'\}"/);
  assert.match(appCss, /\.support-status-open/);
  assert.match(appCss, /\.support-status-needs-info/);
  assert.match(appCss, /\.support-status-closed/);
});

test('public reviews use text nodes for user-provided content', () => {
  assert.match(landingHtml, /loadPublishedReviews/);
  assert.match(landingHtml, /username\.textContent=.*review\.username/);
  assert.match(landingHtml, /comment\.textContent=review\.comment/);
  assert.match(landingHtml, /stars\.textContent=.*review\.rating/);
  assert.doesNotMatch(landingHtml, /innerHTML\s*=\s*review\.(?:username|comment)/);
});
