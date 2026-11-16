const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const landingHtml = fs.readFileSync('public/index.html', 'utf8');
const careersHtml = fs.readFileSync('public/careers.html', 'utf8');
const careersCss = fs.readFileSync('public/css/careers.css', 'utf8');

test('homepage navigation groups links and includes Careers in header and footer', () => {
  assert.match(landingHtml, /<details class="nav-group">\s*<summary>Platform<\/summary>/);
  assert.match(landingHtml, /<details class="nav-group">\s*<summary>Resources<\/summary>/);
  assert.match(landingHtml, /<a href="careers\.html">Careers<\/a>/);
  assert.equal((landingHtml.match(/<details class="nav-group">/g) || []).length, 4);
  assert.match(landingHtml, /menuToggle\.addEventListener\("click"/);
  assert.match(landingHtml, /nav\.querySelectorAll\("a"\)\.forEach/);
  assert.match(landingHtml, /@media\(max-width:720px\)[\s\S]*?\.nav-group:not\(\[open\]\)>\.nav-group-menu\{display:none\}/);
});

test('careers page presents the creator partnerships role and application requirements', () => {
  assert.match(landingHtml, /<a href="careers\.html">Careers<\/a>/);
  assert.match(careersHtml, /<title>Careers \| Blastrr<\/title>/);
  assert.match(careersHtml, /Crypto Creator Partnerships &amp; Affiliate Specialist/);
  assert.match(careersHtml, /Remote \(Global \/ Asynchronous\)/);
  assert.match(careersHtml, /Full-time, part-time, or independent contractor/);
  assert.match(careersHtml, /Base pay \+ performance bonus \/ commission override/);
  assert.match(careersHtml, /two crypto trading creators under 50k followers/);
  assert.match(careersHtml, /three-sentence sample DM/);
  assert.match(careersHtml, /30–50/);
  assert.match(careersHtml, /10–15/);
  assert.equal((careersHtml.match(/href="https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLSfaEBrx--uf5K77FlII68SemyIqsisLoJa0XQa4Xy82ENNVhQ\/viewform\?usp=dialog"/g) || []).length, 2);
  assert.match(careersHtml, /target="_blank" rel="noopener noreferrer"/);
  assert.match(careersCss, /@media \(max-width: 650px\)/);
  assert.match(careersCss, /\.career-application \{[^}]*flex-direction: column/);
});
