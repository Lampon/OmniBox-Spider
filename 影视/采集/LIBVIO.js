// @name LIBVIO
// @author 梦
// @description 刮削：未接入，弹幕：未接入，嗅探：不需要（直链优先，必要时客户端解析兜底）
// @dependencies
// @version 1.2.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/openclaw/影视/采集/LIBVIO.js

const http = require("http");
const https = require("https");
const { URL } = require("url");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = "https://www.libvio.mov";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_PAGE_SIZE = 12;

const CLASS_LIST = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "剧集" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "15", type_name: "日韩剧" },
    { type_id: "16", type_name: "欧美剧" }
];

const FILTERS = {
    "1": {
        genre: ["喜剧", "爱情", "恐怖", "动作", "科幻", "剧情", "战争", "警匪", "犯罪", "动画", "奇幻", "武侠", "冒险", "枪战", "悬疑", "惊悚", "经典", "青春", "文艺", "微电影", "古装", "历史", "运动", "农村", "儿童", "网络电影"],
        area: ["中国大陆", "中国香港", "中国台湾", "美国", "法国", "英国", "日本", "韩国", "德国", "泰国", "印度", "意大利", "西班牙", "加拿大", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "2": {
        genre: ["古装", "战争", "青春偶像", "喜剧", "家庭", "犯罪", "动作", "奇幻", "剧情", "历史", "经典", "乡村", "情景", "商战", "网剧", "其他"],
        area: ["中国大陆", "中国台湾", "中国香港", "韩国", "日本", "美国", "泰国", "英国", "新加坡", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "4": {
        genre: ["情感", "科幻", "热血", "推理", "搞笑", "冒险", "萝莉", "校园", "动作", "机战", "运动", "战争", "少年", "少女", "社会", "原创", "亲子", "益智", "励志", "其他"],
        area: ["中国大陆", "日本", "欧美", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "15": {
        genre: ["悬疑", "爱情", "科幻", "青春", "偶像", "喜剧", "古装", "武侠", "家庭", "犯罪", "动作", "奇幻", "剧情", "历史", "经典", "乡村", "情景", "商战", "网剧", "其他"],
        area: ["韩国", "日本", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "16": {
        genre: ["悬疑", "科幻", "青春", "偶像", "喜剧", "犯罪", "动作", "奇幻", "剧情", "历史", "经典", "乡村", "情景", "商战", "网剧", "其他"],
        area: ["美国", "英国", "泰国", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    }
};

const SORT_OPTIONS = [
    { name: "最新", value: "time" },
    { name: "人气", value: "hits" },
    { name: "评分", value: "score" }
];

async function requestText(url, options = {}) {
    const target = new URL(fixUrl(url));
    const lib = target.protocol === "https:" ? https : http;
    const headers = {
        "User-Agent": UA,
        "Referer": `${HOST}/`,
        "Origin": HOST,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        ...(options.headers || {})
    };

    return await new Promise((resolve, reject) => {
        const req = lib.request(target, {
            method: options.method || "GET",
            headers,
            timeout: options.timeout || 15000,
        }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8");
                if (res.statusCode !== 200) {
                    reject(new Error(`请求失败: ${res.statusCode} ${target.href}`));
                    return;
                }
                resolve(body);
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy(new Error(`请求超时: ${target.href}`));
        });
        req.end();
    });
}


module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function logInfo(message, data = null) {
    OmniBox.log("info", `[LIBVIO] ${data ? `${message}: ${safeJson(data)}` : message}`);
}

function logError(message, error) {
    OmniBox.log("error", `[LIBVIO] ${message}: ${error?.message || error}`);
}

function safeJson(data) {
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function stripTags(text = "") {
    return String(text)
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function fixUrl(url = "") {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//")) return `https:${url}`;
    return url.startsWith("/") ? `${HOST}${url}` : `${HOST}/${url}`;
}

function encodePlayId(payload) {
    return Buffer.from(JSON.stringify(payload || {}), "utf8").toString("base64");
}

function decodePlayId(playId = "") {
    try {
        return JSON.parse(Buffer.from(playId, "base64").toString("utf8"));
    } catch {
        return {};
    }
}

function buildFilterList(categoryId) {
    const preset = FILTERS[String(categoryId)] || {};
    const list = [];
    if (preset.genre?.length) {
        list.push({
            key: "genre",
            name: "剧情",
            init: "",
            value: [{ name: "全部", value: "" }, ...preset.genre.map((item) => ({ name: item, value: item }))]
        });
    }
    if (preset.area?.length) {
        list.push({
            key: "area",
            name: "地区",
            init: "",
            value: [{ name: "全部", value: "" }, ...preset.area.map((item) => ({ name: item, value: item }))]
        });
    }
    list.push({
        key: "year",
        name: "年份",
        init: "",
        value: [{ name: "全部", value: "" }, ...buildYearOptions()]
    });
    if (preset.lang?.length) {
        list.push({
            key: "lang",
            name: "语言",
            init: "",
            value: [{ name: "全部", value: "" }, ...preset.lang.map((item) => ({ name: item, value: item }))]
        });
    }
    list.push({
        key: "sort",
        name: "排序",
        init: "time",
        value: SORT_OPTIONS.map((item) => ({ name: item.name, value: item.value }))
    });
    return list;
}

function buildYearOptions() {
    const current = new Date().getFullYear();
    const list = [];
    for (let year = current; year >= 1998; year -= 1) {
        list.push({ name: String(year), value: String(year) });
    }
    return list;
}

function getCategoryBasePath(categoryId, page = 1) {
    const cid = encodeURIComponent(String(categoryId));
    return page > 1 ? `/show/${cid}--------${page}---.html` : `/type/${cid}.html`;
}

function parseFilterGroups(html = "") {
    const groups = [];
    const ulRegex = /<ul class="clearfix">([\s\S]*?)<\/ul>/g;
    let match;
    while ((match = ulRegex.exec(html))) {
        const block = match[1];
        const title = stripTags(block.match(/<li><span>([^<]+)：<\/span><\/li>/)?.[1] || "");
        if (!title) continue;
        const items = [...block.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((item) => ({
            name: stripTags(item[2]),
            href: fixUrl(item[1]),
        })).filter((item) => item.name && item.href);
        if (items.length) groups.push({ title, items });
    }
    return groups;
}

function mapFilterTitleToKey(title = "") {
    const text = String(title || "").trim();
    if (text.includes("剧情") || text.includes("类型")) return "genre";
    if (text.includes("地区")) return "area";
    if (text.includes("年份")) return "year";
    if (text.includes("语言")) return "lang";
    if (text.includes("排序") || text.includes("时间") || text.includes("人气") || text.includes("评分")) return "sort";
    return "";
}

function normalizeFilterValue(key, value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (key === "sort") {
        if (["最新", "时间", "time"].includes(raw)) return "time";
        if (["人气", "热门", "hits"].includes(raw)) return "hits";
        if (["评分", "高分", "score"].includes(raw)) return "score";
    }
    return raw;
}

function resolveFilterHref(groups, key, value) {
    const normalizedValue = normalizeFilterValue(key, value);
    const targetNames = new Set();
    if (!normalizedValue) {
        targetNames.add("全部");
        if (key === "sort") {
            targetNames.add("时间");
            targetNames.add("最新");
        }
    } else if (key === "sort") {
        if (normalizedValue === "time") {
            targetNames.add("时间");
            targetNames.add("最新");
        } else if (normalizedValue === "hits") {
            targetNames.add("人气");
            targetNames.add("热门");
        } else if (normalizedValue === "score") {
            targetNames.add("评分");
            targetNames.add("高分");
        }
    } else {
        targetNames.add(normalizedValue);
    }

    for (const group of groups) {
        if (mapFilterTitleToKey(group.title) !== key) continue;
        const found = group.items.find((item) => targetNames.has(item.name));
        if (found?.href) return found.href;
    }
    return "";
}

async function resolveCategoryUrl(categoryId, page, filters = {}) {
    let currentUrl = fixUrl(getCategoryBasePath(categoryId, page));
    const order = ["genre", "area", "year", "lang", "sort"];

    for (const key of order) {
        const html = await fetchHtml(currentUrl);
        const groups = parseFilterGroups(html);
        const targetHref = resolveFilterHref(groups, key, filters[key]);
        if (targetHref) currentUrl = targetHref;
    }

    return currentUrl;
}

function buildSearchPath(keyword, page = 1) {
    const pageSeg = page > 1 ? String(page) : "";
    return `/search/------------${pageSeg}---.html?wd=${encodeURIComponent(keyword)}`;
}

async function fetchHtml(url) {
    return String(await requestText(url));
}

function parseVodList(html = "") {
    const results = [];
    const regex = /<div class="stui-vodlist__box">([\s\S]*?)<\/div>\s*<\/li>/g;
    let match;
    while ((match = regex.exec(html))) {
        const block = match[1];
        const href = block.match(/href="([^"]*\/detail\/\d+\.html)"/);
        const title = block.match(/title="([^"]+)"/);
        const pic = block.match(/data-original="([^"]+)"/);
        const remark = block.match(/<span class="pic-text[^>]*">([\s\S]*?)<\/span>/);
        const score = block.match(/<span class="pic-tag[^>]*">([\s\S]*?)<\/span>/);
        if (!href || !title) continue;
        results.push({
            vod_id: fixUrl(href[1]),
            vod_name: stripTags(title[1]),
            vod_pic: fixUrl(pic?.[1] || ""),
            vod_remarks: stripTags(remark?.[1] || score?.[1] || ""),
            vod_score: stripTags(score?.[1] || "")
        });
    }
    return results;
}

function parseMetaItems(html = "") {
    return ensureArray(html.match(/<span class="meta-item">([\s\S]*?)<\/span>/g)).map((item) => stripTags(item));
}

function inferDriveTypeFromSourceName(name = "") {
    const raw = String(name || "").toLowerCase();
    if (raw.includes("百度")) return "baidu";
    if (raw.includes("天翼")) return "tianyi";
    if (raw.includes("夸克")) return "quark";
    if (raw === "uc" || raw.includes("uc")) return "uc";
    if (raw.includes("115")) return "115";
    if (raw.includes("迅雷")) return "xunlei";
    if (raw.includes("阿里")) return "ali";
    if (raw.includes("123")) return "123pan";
    return raw;
}

function parseNetdiskSources(html = "", detailUrl = "") {
    const blocks = [...html.matchAll(/<div class="playlist-panel\s+netdisk-panel">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g)];
    const sources = [];

    for (const matched of blocks) {
        const block = matched[1] || "";
        const sourceName = stripTags(block.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || "网盘");
        const episodes = [...block.matchAll(/<a class="netdisk-item"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span class="netdisk-name">([\s\S]*?)<\/span>[\s\S]*?<span class="netdisk-url">([\s\S]*?)<\/span>/g)].map((item, index) => {
            const shareUrl = stripTags(item[3] || item[1] || "").trim();
            const epName = stripTags(item[2] || "网盘资源").trim() || `资源${index + 1}`;
            const driveType = inferDriveTypeFromSourceName(sourceName);
            return {
                name: epName,
                playId: encodePlayId({
                    mode: "pan",
                    url: fixUrl(item[1] || shareUrl),
                    shareUrl,
                    flag: sourceName,
                    driveType,
                    from: detailUrl,
                })
            };
        }).filter((item) => decodePlayId(item.playId)?.shareUrl);

        if (episodes.length) {
            sources.push({ name: sourceName, episodes });
        }
    }

    return sources;
}

function decodePlayerUrl(url = "", encrypt = 0) {
    let value = String(url || "").trim();
    const mode = Number(encrypt || 0);
    if (!value) return "";
    try {
        if (mode === 1) {
            value = unescape(value);
        } else if (mode === 2) {
            value = unescape(Buffer.from(value, "base64").toString("utf8"));
        }
    } catch (error) {
        logError("播放地址解码失败", error);
    }
    return value.replace(/\\\//g, "/");
}

function buildPlayUrl(rawUrl = "") {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return `https:${value}`;
    return fixUrl(value);
}

function emptyPlay(flag = "LIBVIO") {
    return { parse: 0, flag, urls: [] };
}

function emptyPage(page = 1) {
    return { page, pagecount: 0, total: 0, limit: DEFAULT_PAGE_SIZE, list: [] };
}

async function home(params, context) {
    try {
        logInfo("home 进入", { params, from: context?.from || "web" });
        const html = await fetchHtml("/");
        const list = parseVodList(html).slice(0, 24);
        const classes = CLASS_LIST.map((item) => ({ ...item }));
        const filters = {};
        for (const item of classes) {
            filters[item.type_id] = buildFilterList(item.type_id);
        }
        logInfo("home 完成", { classCount: classes.length, listCount: list.length });
        return { class: classes, filters, list };
    } catch (error) {
        logError("home 失败", error);
        return { class: [], filters: {}, list: [] };
    }
}

async function category(params, context) {
    const categoryId = String(params?.categoryId || "1");
    const page = Number(params?.page || 1);
    const filters = params?.filters || {};
    try {
        const finalUrl = await resolveCategoryUrl(categoryId, page, filters);
        logInfo("category 请求", { categoryId, page, filters, path: finalUrl.replace(HOST, ""), from: context?.from || "web" });
        const html = await fetchHtml(finalUrl);
        const list = parseVodList(html);
        const hasNext = html.includes(`>${page + 1}<`) || html.includes(`-${page + 1}---`) || html.includes(`下一页`);
        const pagecount = list.length === DEFAULT_PAGE_SIZE && hasNext ? page + 1 : (page > 1 || list.length ? page : 0);
        logInfo("category 完成", { categoryId, page, listCount: list.length, pagecount });
        return {
            page,
            pagecount,
            total: pagecount ? pagecount * DEFAULT_PAGE_SIZE : list.length,
            limit: DEFAULT_PAGE_SIZE,
            filters: buildFilterList(categoryId),
            list
        };
    } catch (error) {
        logError("category 失败", error);
        return { ...emptyPage(page), filters: buildFilterList(categoryId) };
    }
}

async function detail(params, context) {
    const videoId = String(params?.videoId || "").trim();
    if (!videoId) return { list: [] };
    try {
        logInfo("detail 请求", { videoId, from: context?.from || "web" });
        const html = await fetchHtml(videoId);
        const name = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || "");
        const poster = fixUrl(html.match(/class="lazyload"[^>]*data-original="([^"]+)"/)?.[1] || html.match(/data-original="([^"]+)"/)?.[1] || "");
        const intro = stripTags(html.match(/<span class="detail-content"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "");
        const score = stripTags(html.match(/<span class="score">([^<]+)<\/span>/)?.[1] || "");
        const metaItems = parseMetaItems(html);
        const typeName = metaItems[0] || "";
        const area = metaItems[1] || "";
        const year = metaItems[2]?.replace(/[^\d]/g, "") || "";
        const remarks = metaItems[5] || html.match(/<span class="pic-text[^>]*">([\s\S]*?)<\/span>/)?.[1] || "";
        const actor = metaItems.find((item) => item.startsWith("主演："))?.replace(/^主演：/, "") || "";
        const director = metaItems.find((item) => item.startsWith("导演："))?.replace(/^导演：/, "") || "";

        const sourceMatches = [...html.matchAll(/<div class="playlist-panel">([\s\S]*?)<\/ul>/g)];
        const collectSources = sourceMatches.map((matched) => {
            const block = matched[1];
            const sourceName = stripTags(block.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || "播放");
            const episodes = [...block.matchAll(/href="([^"]*\/play\/[^\"]+\.html)"[^>]*>([\s\S]*?)<\/a>/g)].map((item) => ({
                name: stripTags(item[2]),
                playId: encodePlayId({
                    mode: "collect",
                    url: fixUrl(item[1]),
                    flag: sourceName,
                    name: stripTags(item[2])
                })
            }));
            return { name: sourceName, episodes };
        }).filter((item) => item.episodes.length);
        const netdiskSources = parseNetdiskSources(html, videoId);
        const vod_play_sources = [...collectSources, ...netdiskSources];

        logInfo("detail 完成", { videoId, sourceCount: vod_play_sources.length, episodeCount: vod_play_sources.reduce((n, item) => n + item.episodes.length, 0) });
        return {
            list: [{
                vod_id: videoId,
                vod_name: name,
                vod_pic: poster,
                type_name: typeName,
                vod_year: year,
                vod_area: area,
                vod_actor: actor,
                vod_director: director,
                vod_content: intro,
                vod_douban_score: score.replace(/分$/, ""),
                vod_remarks: stripTags(remarks),
                vod_play_sources
            }]
        };
    } catch (error) {
        logError("detail 失败", error);
        return { list: [] };
    }
}

async function search(params, context) {
    const keyword = String(params?.keyword || "").trim();
    const page = Number(params?.page || 1);
    if (!keyword) return emptyPage(page);
    try {
        const path = buildSearchPath(keyword, page);
        logInfo("search 请求", { keyword, page, path, quick: params?.quick ? 1 : 0, from: context?.from || "web" });
        const html = await fetchHtml(path);
        const list = parseVodList(html);
        const pagecount = list.length === DEFAULT_PAGE_SIZE ? page + 1 : page;
        logInfo("search 完成", { keyword, page, listCount: list.length, pagecount });
        return {
            page,
            pagecount,
            total: list.length + (pagecount > page ? DEFAULT_PAGE_SIZE : 0),
            limit: DEFAULT_PAGE_SIZE,
            list
        };
    } catch (error) {
        logError("search 失败", error);
        return emptyPage(page);
    }
}

async function play(params, context) {
    const flag = String(params?.flag || "LIBVIO");
    const playId = String(params?.playId || "").trim();
    if (!playId) return emptyPlay(flag);
    try {
        const meta = decodePlayId(playId);
        const playPageUrl = meta.url;
        const playFlag = String(meta.flag || flag || "LIBVIO");
        if (!playPageUrl) return emptyPlay(playFlag);

        if (meta.mode === "pan") {
            const shareUrl = String(meta.shareUrl || "").trim();
            const panUrl = shareUrl || playPageUrl;
            logInfo("play 网盘线路", { panUrl, flag: playFlag, driveType: meta.driveType || "", from: context?.from || "web" });
            return {
                parse: 0,
                flag: playFlag,
                urls: [{ name: meta.name || "网盘资源", url: `push://${panUrl}` }]
            };
        }

        logInfo("play 请求", { playPageUrl, flag: playFlag, from: context?.from || "web" });
        const html = await fetchHtml(playPageUrl);
        const playerJson = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})<\/script>/)?.[1];
        if (!playerJson) {
            logInfo("play 未找到 player_aaaa", { playPageUrl });
            return {
                parse: 1,
                flag: playFlag,
                header: {
                    Referer: `${HOST}/`,
                    Origin: HOST,
                    "User-Agent": UA
                },
                urls: [{ name: meta.name || "播放", url: playPageUrl }]
            };
        }

        const player = JSON.parse(playerJson);
        const realUrl = buildPlayUrl(decodePlayerUrl(player.url, player.encrypt));
        if (realUrl && /^https?:\/\//i.test(realUrl)) {
            logInfo("play 直链完成", { playPageUrl, from: player.from, finalUrl: realUrl });
            return {
                parse: 0,
                flag: playFlag,
                header: {
                    Referer: `${HOST}/`,
                    Origin: HOST,
                    "User-Agent": UA
                },
                urls: [{ name: meta.name || "播放", url: realUrl }]
            };
        }

        logInfo("play 使用嗅探兜底", { playPageUrl, from: player.from, decodedUrl: realUrl });
        return {
            parse: 1,
            flag: playFlag,
            header: {
                Referer: `${HOST}/`,
                Origin: HOST,
                "User-Agent": UA
            },
            urls: [{ name: meta.name || "播放", url: playPageUrl }]
        };
    } catch (error) {
        logError("play 失败", error);
        return emptyPlay(flag);
    }
}
