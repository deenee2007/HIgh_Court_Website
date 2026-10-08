'use strict';
// Creates a super admin, or resets the password of an existing account.
//   npm run create-admin -- --email you@example.com --name "Your Name"
// The password is asked for on screen (or taken from ADMIN_PASSWORD).
const readline = require('readline');
const db = require('../src/db');
const auth = require('../src/auth');
const { newId } = require('../src/content');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : '';
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const email = String(arg('email')).trim().toLowerCase();
  const name = String(arg('name') || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: npm run create-admin -- --email you@example.com --name "Your Name"');
  await db.connect();
  const existing = await db.col('users').findOne({ email });
  const pw = process.env.ADMIN_PASSWORD || (await askHidden('New password: '));
  const problem = auth.passwordProblem(pw, { email });
  if (problem) throw new Error(problem);
  if (!process.env.ADMIN_PASSWORD && (await askHidden('Repeat password: ')) !== pw) throw new Error('The passwords do not match.');
  const passwordHash = await auth.hashPassword(pw);
  if (existing) {
    await db.col('users').updateOne({ _id: existing._id }, { $set: { passwordHash, role: 'superadmin', active: true, failedLogins: 0, lockUntil: null, ...(name ? { name } : {}) } });
    await db.col('sessions').deleteMany({ userId: existing._id });
    console.log(`Password reset. ${email} is now an active super admin.`);
  } else {
    await db.col('users').insertOne({ _id: newId(), name: name || email, email, passwordHash, role: 'superadmin', perms: {}, access: {}, active: true, createdAt: new Date() });
    console.log(`Super admin ${email} created.`);
  }
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
