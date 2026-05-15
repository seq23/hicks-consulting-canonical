function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function retry(fn, { retries = 1, delayMs = 750, label = 'request' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      if (attempt > 0) await sleep(delayMs * attempt);
      return await fn(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`${label} failed`);
}

module.exports = { sleep, withTimeout, retry };
