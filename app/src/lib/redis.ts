import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  __redis?: Redis;
  __redisLastLog?: number;
};

function createRedis(): Redis {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  let lastLog = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastLog > 30_000) {
      lastLog = now;
      console.error("[redis] error:", err.message);
    }
  });
  return client;
}

export const redis: Redis = globalForRedis.__redis ?? createRedis();

if (process.env.NODE_ENV !== "production") globalForRedis.__redis = redis;