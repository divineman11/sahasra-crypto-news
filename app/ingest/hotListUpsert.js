'use strict';

// hotListUpsert.js -- F6: idempotent hot-list upsert via a single Lua script.
//
// The script removes any existing entry with the same decoded `.id`,
// pushes the new json to the head of the list, trims to the max length,
// publishes the new item, and returns 1. A retry of the same post can
// never create a second entry for it.

const SCRIPT = `--hotUpsert
local key = KEYS[1]
local id = ARGV[1]
local json = ARGV[2]
local max = tonumber(ARGV[3])

-- 1. Remove every list entry whose decoded .id equals ARGV[1]
local len = redis.call('LLEN', key)
local i = 0
while i < len do
  local entry = redis.call('LINDEX', key, i)
  if entry then
    local ok, decoded = pcall(cjson.decode, entry)
    if ok and type(decoded) == 'table' and decoded.id == id then
      redis.call('LREM', key, 0, entry)
      len = len - 1
    else
      i = i + 1
    end
  else
    i = i + 1
  end
end

-- 2. Push the new entry at the head
redis.call('LPUSH', key, json)

-- 3. Trim to the max length
redis.call('LTRIM', key, 0, max - 1)

-- 4. Publish the new item
redis.call('PUBLISH', 'news:new', json)

-- 5. Return 1
return 1
`;

const HOT_KEY = 'news:hot';
const MAX_LEN = 1000;

/**
 * Idempotently upsert a post into the hot list.
 *
 * @param {object} redis ioredis client (or MemoryRedis implementing the
 *   same script semantics, detected via the `--hotUpsert` marker).
 * @param {string} id   the post id
 * @param {string} json the serialized DTO to push
 * @returns {Promise<*>} the result of redis.eval (1 on success)
 */
async function hotUpsert(redis, id, json) {
  return redis.eval(SCRIPT, 1, HOT_KEY, id, json, MAX_LEN);
}

module.exports = { hotUpsert, SCRIPT, HOT_KEY, MAX_LEN };