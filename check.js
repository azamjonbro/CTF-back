require('dotenv').config();
const bcrypt = require('bcryptjs');

// The bcrypt hash to verify (from your message)
const hash = '$2a$12$SEQg8WoSL5aKpDIkT7hm5u4/gakoPaAcTzEIBC7hC55GvLUHyHFTO';

// Candidate password can be provided as CLI arg or via .env variable CONFIM
const candidateFromArg = process.argv[2];
const candidateFromEnv = process.env.CONFIM;
const candidate = candidateFromArg || candidateFromEnv;

if (!candidate) {
 console.error('No candidate password provided. Pass it as an argument or set CONFIM in .env');
 console.error('Example: node check.js myGuessPassword');
 process.exit(2);
}

try {
 const match = bcrypt.compareSync(candidate, hash);
 if (match) {
  console.log('MATCH — provided candidate matches the hash');
 } else {
  console.log('NO MATCH — provided candidate does NOT match the hash');
 }
} catch (err) {
 console.error('Error while comparing:', err.message || err);
 process.exit(1);
}
