const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

let writeQueue = Promise.resolve();

function getLogPath() {
  return path.join(app.getPath('userData'), 'logs', 'launcher.log');
}

function writeLog(level, message, details) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message: String(message || 'Unknown error'),
    ...(details ? { details } : {})
  };
  const line = `${JSON.stringify(entry)}\n`;
  writeQueue = writeQueue
    .then(async () => {
      const file = getLogPath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, line, 'utf8');
    })
    .catch(() => {});
  return writeQueue;
}

function errorDetails(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    };
  }
  return { value: String(error) };
}

function logError(context, error) {
  const details = errorDetails(error);
  return writeLog('error', `${context}: ${details.message || details.value}`, details);
}

module.exports = { getLogPath, writeLog, logError };
