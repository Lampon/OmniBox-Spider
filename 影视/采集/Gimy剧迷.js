// @name Gimy剧迷
// @author 梦
// @description 影视站：Gimy / gimy.now / gimyai.tw，支持首页、分类、详情、搜索与播放页嗅探
// @dependencies cheerio
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/Gimy剧迷.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = "https://gimyai.tw";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

async function requestText(url, options = {}) {
  await OmniBox.log("info", `[Gimy剧迷][request] ${options.method || "GET"} ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: options.referer || `${BASE_URL}/`,
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 20000,
  });
  const statusCode = Number(res?.statusCode || 0);
  if (!res || statusCode !== 200) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  return getBodyText(res);
}

function absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value.replace(/^\.\//, "")}`;
}

function normalizeText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function toSearchComparable(value) {
  const map = {
    "鬥": "斗", "羅": "罗", "陸": "陆", "龍": "龙", "傳": "传", "說": "说", "絕": "绝", "劍": "剑", "塵": "尘",
    "動": "动", "態": "态", "畫": "画", "劇": "剧", "場": "场", "國": "国", "產": "产", "綜": "综", "藝": "艺",
    "電": "电", "視": "视", "連": "连", "續": "续", "線": "线", "萬": "万", "與": "与", "風": "风", "雲": "云",
    "後": "后", "開": "开", "關": "关", "門": "门", "書": "书", "貓": "猫", "馬": "马", "魚": "鱼", "鳥": "鸟",
    "來": "来", "時": "时", "會": "会", "愛": "爱", "戰": "战", "雙": "双", "無": "无", "盡": "尽", "順": "顺",
    "極": "极", "歲": "岁", "當": "当", "這": "这", "個": "个", "們": "们", "為": "为", "總": "总", "實": "实",
    "陰": "阴", "陽": "阳", "聖": "圣", "靈": "灵", "夢": "梦", "戀": "恋", "網": "网", "寶": "宝", "藍": "蓝",
    "覺": "觉", "經": "经", "萬": "万", "終": "终", "貝": "贝", "幾": "几", "體": "体", "頭": "头", "師": "师"
  };
  return String(value || "").split("").map((ch) => map[ch] || ch).join("");
}

function normalizeSearchKeyword(value) {
  return toSearchComparable(String(value || ""))
    .replace(/[\s\-_—–·•:：,，.。!?！？'"“”‘’()（）\[\]【】{}]/g, "")
    .toLowerCase();
}

function buildSearchTokens(keyword) {
  const base = normalizeSearchKeyword(keyword);
  if (!base) return [];
  const tokens = new Set([base]);
  const simplified = base
    .replace(/線上看|线上看|全集|連續劇|连续剧|電視劇|电视剧|動漫|动漫|電影|电影|綜藝|综艺/g, "")
    .trim();
  if (simplified) tokens.add(simplified);
  const digitStripped = simplified.replace(/第\d+[集季部篇]?$/g, "").replace(/\d+$/g, "");
  if (digitStripped) tokens.add(digitStripped);
  return [...tokens].filter(Boolean).sort((a, b) => b.length - a.length);
}

function scoreSearchResult(vodName, keyword) {
  const name = normalizeSearchKeyword(vodName);
  const tokens = buildSearchTokens(keyword);
  if (!name || !tokens.length) return 0;

  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (name === token) score = Math.max(score, 1000 + token.length);
    else if (name.startsWith(token)) score = Math.max(score, 800 + token.length);
    else if (name.includes(token)) score = Math.max(score, 600 + token.length);
    else if (token.includes(name) && name.length >= 2) score = Math.max(score, 450 + name.length);
  }
  return score;
}

function refineSearchResults(list, keyword) {
  const scored = list.map((item) => ({ item, score: scoreSearchResult(item.vod_name, keyword) }));
  const matched = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.vod_name || "").localeCompare(String(b.item.vod_name || ""), "zh-Hans-CN"))
    .map((entry) => entry.item);

  if (matched.length) return matched;

  const looseKeyword = normalizeSearchKeyword(keyword);
  const loose = list.filter((item) => normalizeSearchKeyword(item.vod_name).includes(looseKeyword));
  if (loose.length) return loose;

  return [];
}

function extractCards($) {
  const list = [];
  const seen = new Set();

  $("a[href*='/detail/']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const vod_id = absUrl(href);
    if (!/\/detail\/\d+\.html/i.test(vod_id) || seen.has(vod_id)) return;

    const title = normalizeText(
      $el.attr("title")
      || $el.find("img").attr("alt")
      || $el.find(".title, .video-text, .module-poster-item-title, h3, h4, h5").first().text()
      || $el.text()
    );
    if (!title) return;

    const pic = absUrl(
      $el.find("img").attr("data-original")
      || $el.find("img").attr("data-src")
      || $el.find("img").attr("src")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item").find("img").first().attr("data-original")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item").find("img").first().attr("data-src")
      || $el.closest(".module-item, li, .public-list-box, .video-item, .item").find("img").first().attr("src")
      || ""
    );
    const parentHtml = $el.closest("li, .module-item, .public-list-box, .video-item, .item, .module-poster-item, .myui-vodlist__box").html() || $el.parent().html() || "";
    const remarksMatch = String(parentHtml).match(/(?:更新至第?\d+集|更新第?\d+集|\(?\d+全\)?|全\d+集|已完結|已完结|HD中字|HD|TC|HC|搶先版|抢先版)/i);
    const vod_remarks = remarksMatch ? normalizeText(remarksMatch[0]) : "";

    seen.add(vod_id);
    list.push({ vod_id, vod_name: title, vod_pic: pic, vod_remarks });
  });

  return list;
}

function buildClassAndFilters() {
  return {
    class: [
      { type_id: "1", type_name: "电影" },
      { type_id: "2", type_name: "电视剧" },
      { type_id: "4", type_name: "动漫" },
      { type_id: "29", type_name: "综艺" },
      { type_id: "34", type_name: "短剧" },
      { type_id: "13", type_name: "陆剧" },
    ],
    filters: {
      "1": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "2": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "4": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "29": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "34": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
      "13": [
        { key: "by", name: "排序", init: "time", value: [{ name: "最新", value: "time" }, { name: "人气", value: "hits" }, { name: "评分", value: "score" }] },
      ],
    },
  };
}

async function home(params, context) {
  try {
    const config = buildClassAndFilters();
    const html = await requestText(`${BASE_URL}/`);
    const $ = cheerio.load(html);
    const list = extractCards($).slice(0, 24);
    await OmniBox.log("info", `[Gimy剧迷][home] 推荐数: ${list.length}`);
    return { class: config.class, filters: config.filters, list };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][home] ${e.message}`);
    const config = buildClassAndFilters();
    return { class: config.class, filters: config.filters, list: [] };
  }
}

async function category(params, context) {
  try {
    const page = Math.max(Number(params.page || 1) || 1, 1);
    const categoryId = String(params.categoryId || params.type_id || "2");
    const filters = params.filters || {};
    const by = String(filters.by || "time");
    const url = `${BASE_URL}/genre/${categoryId}.html${page > 1 || by !== "time" ? `?page=${page}&by=${encodeURIComponent(by)}` : ""}`;
    const html = await requestText(url);
    const $ = cheerio.load(html);
    const list = extractCards($);
    await OmniBox.log("info", `[Gimy剧迷][category] type=${categoryId} page=${page} list=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 20 ? 1 : 0),
      total: page * 20 + list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

function parsePlaySources($) {
  const tabs = [];
  $("#playTab a[href^='#con_playlist_']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const tabId = href.replace(/^#/, "");
    const name = normalizeText($el.text()) || tabId;
    if (tabId) tabs.push({ tabId, name });
  });

  const playSources = [];
  for (const tab of tabs) {
    const episodes = [];
    $(`#${tab.tabId} a[href*='/play/']`).each((_, a) => {
      const $a = $(a);
      const href = $a.attr("href") || "";
      const epName = normalizeText($a.text()) || "正片";
      if (!href) return;
      episodes.push({ name: epName, playId: absUrl(href) });
    });
    if (episodes.length) playSources.push({ name: tab.name, episodes });
  }
  return playSources;
}

function pickInfo(html, label) {
  const re = new RegExp(`<span[^>]*>${label}[：:]<\\/span>([\\s\\S]*?)<\\/li>`, "i");
  const m = String(html || "").match(re);
  if (!m) return "";
  return normalizeText(m[1]);
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "").trim();
    if (!videoId) return { list: [] };
    const url = /^https?:\/\//i.test(videoId) ? videoId : absUrl(videoId);
    const html = await requestText(url);
    const $ = cheerio.load(html);

    const vod_name = normalizeText($("h1.text-overflow, h1").first().text() || $("title").text().split("線上看")[0]);
    const vod_pic = absUrl($("meta[property='og:image']").attr("content") || $(".details-pic .video-pic").attr("style")?.match(/url\(([^)]+)\)/)?.[1] || $("img").first().attr("src") || "");
    const vod_content = normalizeText($(".switch-box .text, .details-content .text, .details-content, .detail-sketch").first().text() || $("meta[name='description']").attr("content") || "");
    const vod_remarks = pickInfo(html, "狀態") || pickInfo(html, "状态");
    const type_name = pickInfo(html, "類別") || pickInfo(html, "类别");
    const vod_year = pickInfo(html, "年代") || pickInfo(html, "年份");
    const vod_area = pickInfo(html, "國家/地區") || pickInfo(html, "国家/地区");
    const vod_actor = normalizeText($("li:contains('主演') a").map((_, el) => $(el).text()).get().join(" / "));
    const vod_director = normalizeText($("li:contains('導演') a, li:contains('导演') a").map((_, el) => $(el).text()).get().join(" / "));
    const vod_play_sources = parsePlaySources($);

    await OmniBox.log("info", `[Gimy剧迷][detail] ${url} 线路=${vod_play_sources.length}`);
    return {
      list: [{
        vod_id: url,
        vod_name,
        vod_pic,
        vod_content,
        vod_remarks,
        type_name,
        vod_year,
        vod_area,
        vod_actor,
        vod_director,
        vod_play_sources,
      }],
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.key || params.wd || "").trim();
    const page = Math.max(Number(params.page || 1) || 1, 1);
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const url = `${BASE_URL}/find/-------------.html?wd=${encodeURIComponent(keyword)}&page=${page}`;
    const html = await requestText(url);
    const $ = cheerio.load(html);
    const rawList = extractCards($);
    const list = refineSearchResults(rawList, keyword);
    await OmniBox.log("info", `[Gimy剧迷][search] keyword=${keyword} page=${page} raw=${rawList.length} filtered=${list.length}`);
    return {
      page,
      pagecount: page + (rawList.length >= 20 ? 1 : 0),
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params.playId || params.id || params.url || "").trim();
    if (!playId) return { parse: 0, urls: [], url: "", flag: "gimy", header: {}, headers: {} };

    const pageUrl = /^https?:\/\//i.test(playId) ? playId : absUrl(playId);
    const baseHeaders = { "User-Agent": UA, "Referer": pageUrl, "Origin": BASE_URL };
    await OmniBox.log("info", `[Gimy剧迷][play] start pageUrl=${pageUrl}`);

    let playerData = null;
    try {
      const html = await requestText(pageUrl, { referer: pageUrl });
      const m = html.match(/var\s+player_data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
      if (m) {
        await OmniBox.log("info", `[Gimy剧迷][play] player_data=${m[1].slice(0, 500)}`);
        playerData = JSON.parse(m[1]);
      }
    } catch (e) {
      await OmniBox.log("warn", `[Gimy剧迷][play] 读取播放页失败: ${e.message}`);
    }

    if (playerData && playerData.url) {
      const rawUrl = String(playerData.url || "");
      const playFrom = String(playerData.from || "");
      let parseBase = "https://play.gimyai.tw/v/";
      let referer = `https://play.gimyai.tw/v/?url=${encodeURIComponent(rawUrl)}`;

      if (["JD4K", "JD2K", "JDHG", "JDQM"].includes(playFrom)) {
        parseBase = "https://play.gimyai.tw/d/";
        referer = `https://play.gimyai.tw/d/?url=${encodeURIComponent(rawUrl)}&jctype=${encodeURIComponent(playFrom)}&next=${encodeURIComponent(`//${pageUrl}`)}`;
      } else if (playFrom === "NSYS") {
        parseBase = "https://play.gimyai.tw/n/";
        referer = `https://play.gimyai.tw/n/?url=${encodeURIComponent(rawUrl)}&jctype=${encodeURIComponent(playFrom)}&next=${encodeURIComponent(pageUrl)}`;
      }

      const parseUrl = `${parseBase}parse.php?url=${encodeURIComponent(rawUrl)}&_t=${Date.now()}`;
      await OmniBox.log("info", `[Gimy剧迷][play] parseUrl=${parseUrl}`);

      try {
        const parseText = await requestText(parseUrl, {
          referer,
          headers: {
            Accept: "application/json, text/plain, */*",
          },
        });
        await OmniBox.log("info", `[Gimy剧迷][play] parseResponse=${parseText.slice(0, 500)}`);
        let parseJson = null;
        try {
          parseJson = JSON.parse(parseText);
        } catch (_) {}

        const mediaUrl = String(parseJson?.url || parseJson?.video || parseJson?.playurl || "").trim();
        const mediaType = String(parseJson?.type || "").trim();
        if (mediaUrl) {
          const header = {
            "User-Agent": UA,
            Referer: referer,
            Origin: new URL(parseBase).origin,
          };
          return {
            parse: 0,
            url: mediaUrl,
            urls: [{ name: playFrom || "直链播放", url: mediaUrl }],
            header,
            headers: header,
            flag: mediaType || playFrom || "direct",
          };
        }
      } catch (e) {
        await OmniBox.log("warn", `[Gimy剧迷][play] parse.php failed: ${e.message}`);
      }
    }

    try {
      const sniffed = await OmniBox.sniffVideo(pageUrl, { "User-Agent": UA, "Referer": pageUrl });
      await OmniBox.log("info", `[Gimy剧迷][play] sniff result=${JSON.stringify(sniffed || {})}`);
      if (sniffed && sniffed.url) {
        const header = sniffed.header || baseHeaders;
        return {
          parse: 0,
          url: sniffed.url,
          urls: [{ name: "嗅探播放", url: sniffed.url }],
          header,
          headers: header,
          flag: "sniff",
        };
      }
    } catch (e) {
      await OmniBox.log("warn", `[Gimy剧迷][play] sniffVideo failed: ${e.message}`);
    }

    return {
      parse: 1,
      url: pageUrl,
      urls: [{ name: "播放页", url: pageUrl }],
      header: baseHeaders,
      headers: baseHeaders,
      flag: "page",
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy剧迷][play] ${e.message}`);
    return { parse: 0, urls: [], url: "", flag: "gimy", header: {}, headers: {} };
  }
}
