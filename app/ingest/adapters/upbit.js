"use strict";

const http = require("../http");
const { BROWSER_UA } = require("../config");

const URL =
  "https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=20&category=all";

const RE_LISTING = /디지털 자산 추가|마켓 추가|신규 거래지원|거래지원 개시/;
const RE_DELISTING = /거래지원 종료|상장 폐지|유의 종목 지정|투자유의/;
const RE_MAINTENANCE = /입출금|점검|일시 중단/;

function categorize(title, category) {
  if (title.indexOf("해제") !== -1) return null;
  if (RE_LISTING.test(title)) return "listing";
  if (RE_DELISTING.test(title)) return "delisting";
  if (category === "입출금" || RE_MAINTENANCE.test(title)) return "maintenance";
  return null;
}

function mapUpbit(json) {
  if (!json || json.success === false) {
    throw new Error("upbit: unsuccessful response");
  }
  const data = json && json.data;
  const notices = data && data.notices;
  if (!Array.isArray(notices) || notices.length === 0) {
    throw new Error("upbit: notices is not a non-empty array");
  }

  const items = [];
  for (const notice of notices) {
    if (!notice || notice.id == null) continue;
    const title = "[Upbit] " + String(notice.title || "");
    const url =
      "https://upbit.com/service_center/notice?id=" + encodeURIComponent(notice.id);
    const publishedAt = new Date(notice.first_listed_at || notice.listed_at);
    const hintTickers = [];
    const re = /\(([A-Z0-9]{2,15})\)/g;
    let m;
    while ((m = re.exec(title)) !== null) {
      if (hintTickers.indexOf(m[1]) === -1) hintTickers.push(m[1]);
    }
    items.push({
      sourceName: "upbit",
      sourceTier: 1,
      kind: "exchange",
      exchange: "Upbit",
      title,
      url,
      publishedAt,
      hintCategory: categorize(title, notice.category),
      hintTickers,
    });
  }
  return items;
}

async function run(ctx) {
  const conditional = !!(ctx && ctx.conditional);
  const res = await http.request(URL, {
    ua: "browser",
    timeoutMs: 15000,
    conditional,
  });
  if (res.notModified || res.status === 304) return [];
  const json =
    typeof res.json === "function" ? await res.json() : JSON.parse(res.text);
  return mapUpbit(json);
}

function make() {
  return {
    name: 'upbit', tier: 1, intervalMs: 10000,
    async run() {
      const res = await http.request('https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=20&category=all', { ua: BROWSER_UA, conditional: true, timeoutMs: 10000 });
      if (res.notModified) return [];
      return mapUpbit(res.json());
    },
  };
}

module.exports = { make, mapUpbit };