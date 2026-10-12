'use strict';
// A namespace for another server/ module that is required on first use, not
// when this file loads. server.js loads the modules in the order the old
// single file ran them (middleware and routes register in that order); a plain
// require() at the top of a module would pull its neighbour's routes in early.
// Reads and writes go straight to the other module's live exports.
module.exports = function lazy(id) {
  let mod = null;
  const get = () => mod || (mod = require(id));
  return new Proxy({}, {
    get: (_, key) => get()[key],
    set: (_, key, value) => { get()[key] = value; return true; },
  });
};
