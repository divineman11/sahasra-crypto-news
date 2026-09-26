import { redis } from "@/lib/redis";

const LUA = `
local items = redis.call("LRANGE", KEYS[1], 0, -1)
for i, s in ipairs(items) do
  local ok, obj = pcall(cjson.decode, s)
  if ok and type(obj) == "table" and obj.id == ARGV[1] then
    redis.call("LSET", KEYS[1], i - 1, ARGV[2])
    return i - 1
  end
end
return -1
`;

export async function updateHotList(id: string, json: string): Promise<void> {
  try {
    await redis.eval(LUA, 1, "news:hot", id, json);
  } catch (err) {
    console.error("hotList eval failed", err);
  }
  try {
    await redis.publish("news:update", json);
  } catch (err) {
    console.error("hotList publish failed", err);
  }
}