const fs = require('fs');

function readJson(path) {
  try {
    const data = fs.readFileSync(path, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error(`[readJson] Error reading ${path}:`, e.message);
    return null;
  }
}

function writeJson(path, data) {
  try {
    fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error(`[writeJson] Error writing ${path}:`, e.message);
    return false;
  }
}

// Wrappers for async/await usage
async function safeReadJson(path) {
  return readJson(path);
}

async function safeWriteJson(path, data) {
  return writeJson(path, data);
}

module.exports = {
  readJson,
  writeJson,
  safeReadJson,
  safeWriteJson
};
