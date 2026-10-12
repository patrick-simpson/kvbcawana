'use strict';
// A free TCP port for a test to bind, so suites never share a fixed number and
// scripts/run-tests.cjs can run them side by side.
//
// freePort() asks the OS for one (listen(0), read the real port, close) in a
// short child process, so it is synchronous and a suite can keep its
// `const PORT = ...` at the top of the file. The OS hands out ephemeral ports
// in rotation, so two suites that ask at the same moment do not get the same
// one; AWANA_TEST_PORT still overrides it for a suite run by hand.
const { execFileSync } = require('child_process');

function freePort(host = '127.0.0.1') {
  const out = execFileSync(process.execPath, ['-e',
    `const s = require('net').createServer(); s.listen(0, ${JSON.stringify(host)}, () => { process.stdout.write(String(s.address().port)); s.close(); });`,
  ], { encoding: 'utf8' });
  const port = Number(out);
  if (!Number.isInteger(port) || port < 1) throw new Error('could not get a free port: ' + out);
  return port;
}

module.exports = freePort;
