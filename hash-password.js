// Utility sekali-jalan: bikin password hash buat login, tanpa nyimpen plaintext.
// Pakai: node hash-password.js
const { hashPassword } = require('./auth');

function askHidden(query) {
  return new Promise(resolve => {
    process.stdout.write(query);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let input = '';
    const onData = char => {
      const code = char.charCodeAt(0);
      if (char === '\n' || char === '\r' || code === 4) { // Enter / Ctrl-D
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (code === 3) { // Ctrl-C
        process.exit();
      } else if (code === 127) { // Backspace
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const username = await askHidden('Username login: ');
  const password = await askHidden('Password login: ');
  const { salt, hash } = hashPassword(password);
  console.log('\nTempel field ini ke dalam config.json (jangan timpa host/user/password DB yang sudah ada):\n');
  console.log(JSON.stringify({ loginUser: username, passwordSalt: salt, passwordHash: hash }, null, 2));
})();
