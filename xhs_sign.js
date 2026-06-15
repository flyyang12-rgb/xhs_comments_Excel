const fs = require('fs');

const originalLog = console.log;
console.log = () => {};
const signer = require('./xhs_main_260411.js');
console.log = originalLog;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse((input || '{}').replace(/^\uFEFF/, ''));
    const mutedLog = console.log;
    console.log = () => {};
    const result = signer.get_request_headers_params(
      payload.api,
      payload.data || '',
      payload.a1,
      payload.method || 'GET'
    );
    console.log = mutedLog;
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
});
