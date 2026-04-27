'use strict';

function ts() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = {
  info:  (msg) => console.log(`[${ts()}] [INFO]  ${msg}`),
  error: (msg) => console.error(`[${ts()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${ts()}] [DEBUG] ${msg}`),
};
