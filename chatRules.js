const MAX_CHAT_MESSAGE_LENGTH = 500;
const CHAT_COOLDOWN_MS = 60 * 1000;

const URL_PATTERN = /(?:https?:\/\/|ftp:\/\/|www\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b)/i;
const PROFANITY_PATTERN = /\b(?:asshole|bitch|cunt|dick|fuck(?:er|ing|ed|s)?|motherfucker|shit(?:ty|ting|s)?)\b/i;
const SCAM_PATTERN = /\b(?:seed phrase|recovery phrase|private key|contact me|message me|dm me|telegram|whatsapp|guaranteed (?:profit|returns?)|double your|send (?:me )?(?:funds|crypto|usdt)|wallet connect|claim (?:your )?(?:reward|airdrop))\b/i;

function moderateChatMessage(value) {
  if (typeof value !== 'string') return { valid: false, error: 'Enter a text message.' };
  const message = value.trim();
  if (!message) return { valid: false, error: 'Enter a message before sending.' };
  if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { valid: false, error: `Messages must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.` };
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) {
    return { valid: false, error: 'Messages cannot contain control characters.' };
  }
  if (URL_PATTERN.test(message)) return { valid: false, error: 'Links and URLs are not allowed in chat.' };
  if (PROFANITY_PATTERN.test(message)) return { valid: false, error: 'Please keep chat respectful.' };
  if (SCAM_PATTERN.test(message)) return { valid: false, error: 'This message was blocked by chat moderation.' };
  return { valid: true, message };
}

module.exports = {
  CHAT_COOLDOWN_MS,
  MAX_CHAT_MESSAGE_LENGTH,
  moderateChatMessage
};
