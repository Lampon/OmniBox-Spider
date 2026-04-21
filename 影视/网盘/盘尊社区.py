# -*- coding: utf-8 -*-
# @name 盘尊社区
# @author 梦
# @description 网盘源：https://www.panzun.cc/ ，Python版，接入首页、分类、搜索、详情与播放，支持 a.7u9.cn 短链解析到真实网盘分享
# @version 1.0.5
# @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/盘尊社区.py
# @dependencies requests,curl_cffi

import json
import html
import os
import re
from urllib.parse import quote, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from spider_runner import OmniBox, run

try:
    import requests as py_requests
except Exception:
    py_requests = None

try:
    from curl_cffi import requests as curl_requests
except Exception:
    curl_requests = None


def split_config_list(value: str):
    return [item.strip() for item in str(value or "").replace(",", ";").split(";") if item.strip()]


# ==================== 配置区域开始 ====================
# 站点基础地址。
BASE_URL = str(os.environ.get("PANZUN_HOST") or "https://www.panzun.cc").rstrip("/")
# 站点 API 地址。
API_URL = f"{BASE_URL}/api"
# 默认请求头 UA。
UA = str(os.environ.get("PANZUN_UA") or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")
# SDK 缓存默认 TTL（秒）。
CACHE_EX_SECONDS = max(60, int(os.environ.get("PANZUN_CACHE_EX_SECONDS", "1800") or 1800))
# 网盘多线路白名单。
DRIVE_TYPE_CONFIG = [item.lower() for item in split_config_list(os.environ.get("DRIVE_TYPE_CONFIG", "quark;uc"))]
# 多线路展示名配置。
SOURCE_NAMES_CONFIG = split_config_list(os.environ.get("SOURCE_NAMES_CONFIG", "本地代理;服务端代理;直连"))
# 是否强制允许服务端代理。
EXTERNAL_SERVER_PROXY_ENABLED = str(os.environ.get("EXTERNAL_SERVER_PROXY_ENABLED", "false")).lower() == "true"
# 网盘源排序优先级。
DRIVE_ORDER = [item.lower() for item in split_config_list(os.environ.get("DRIVE_ORDER", "baidu;tianyi;quark;uc;115;xunlei;ali;123pan"))]
# ==================== 配置区域结束 ====================

CLASS_LIST = [
    {"type_id": "movies", "type_name": "影视"},
    {"type_id": "anime", "type_name": "动漫"},
    {"type_id": "variety-shows", "type_name": "综艺"},
    {"type_id": "yy", "type_name": "音乐"},
]

SHORT_SHARE_RE = re.compile(
    r'https?://(?:a\.7u9\.cn/s/[A-Za-z0-9]+|pan\.quark\.cn/s/[A-Za-z0-9]+|drive\.uc\.cn/s/[A-Za-z0-9]+|pan\.baidu\.com/s/[A-Za-z0-9_\-]+(?:\?pwd=[A-Za-z0-9]+)?|cloud\.189\.cn/t/[A-Za-z0-9]+|www\.aliyundrive\.com/s/[A-Za-z0-9]+|www\.alipan\.com/s/[A-Za-z0-9]+|115\.com/s/[A-Za-z0-9]+|pan\.xunlei\.com/s/[A-Za-z0-9]+|www\.123684\.com/s/[A-Za-z0-9]+|www\.123865\.com/s/[A-Za-z0-9]+|www\.123912\.com/s/[A-Za-z0-9]+|www\.123pan\.com/s/[A-Za-z0-9]+)',
    re.I,
)


def b64_encode(obj):
    import base64
    return base64.b64encode(json.dumps(obj, ensure_ascii=False).encode("utf-8")).decode("utf-8")


def b64_decode(raw):
    import base64
    try:
        return json.loads(base64.b64decode(str(raw or "")).decode("utf-8"))
    except Exception:
        return {}


async def log(level: str, message: str):
    try:
        await OmniBox.log(level, message)
    except Exception:
        pass


def clean_text(value: str) -> str:
    text = str(value or "")
    text = text.replace("<br />", "\n").replace("<br/>", "\n").replace("<br>", "\n")
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def abs_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if raw.startswith("//"):
        return f"https:{raw}"
    if raw.startswith("/"):
        return f"{BASE_URL}{raw}"
    return f"{BASE_URL}/{raw.lstrip('./')}"


async def request_json(url: str):
    await log("info", f"[盘尊][json] GET {url}")
    res = await OmniBox.request(url, {
        "method": "GET",
        "headers": {
            "User-Agent": UA,
            "Accept": "application/json",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": f"{BASE_URL}/",
        },
        "timeout": 20000,
    })
    status = int(res.get("statusCode") or 0)
    body = res.get("body", "")
    text = body.decode("utf-8", "ignore") if isinstance(body, (bytes, bytearray)) else str(body or "")
    if status != 200:
        raise RuntimeError(f"HTTP {status} @ {url}")
    return json.loads(text or "{}")


async def get_cached_json(key: str):
    try:
        value = await OmniBox.getCache(key)
        if not value:
            return None
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value
    except Exception:
        return None


async def set_cached_json(key: str, value, ex_seconds: int = CACHE_EX_SECONDS):
    try:
        await OmniBox.setCache(key, json.dumps(value, ensure_ascii=False), ex_seconds)
    except Exception:
        pass


async def fetch_discussions(tag_slug: str = "", offset: int = 0):
    cache_key = f"panzun:discussions:{tag_slug or 'all'}:{offset}"
    cached = await get_cached_json(cache_key)
    if cached:
        return cached
    if tag_slug:
        url = f"{API_URL}/discussions?filter[tag]={quote(tag_slug)}&page[offset]={offset}"
    else:
        url = f"{API_URL}/discussions?page[offset]={offset}"
    data = await request_json(url)
    await set_cached_json(cache_key, data)
    return data


async def search_discussions(keyword: str = "", offset: int = 0):
    cache_key = f"panzun:search:{keyword}:{offset}"
    cached = await get_cached_json(cache_key)
    if cached:
        return cached
    url = f"{API_URL}/discussions?filter[q]={quote(keyword)}&page[offset]={offset}"
    data = await request_json(url)
    await set_cached_json(cache_key, data)
    return data


async def fetch_discussion_detail(discussion_id: str):
    cache_key = f"panzun:detail:{discussion_id}"
    cached = await get_cached_json(cache_key)
    if cached:
        return cached
    url = f"{API_URL}/discussions/{discussion_id}"
    data = await request_json(url)
    await set_cached_json(cache_key, data)
    return data


def build_included_map(included=None):
    result = {}
    for item in list(included or []):
        item_type = str(item.get("type") or "")
        item_id = str(item.get("id") or "")
        if item_type and item_id:
            result[f"{item_type}:{item_id}"] = item
    return result


def map_discussion_card(item, included_map=None):
    included_map = included_map or {}
    attrs = item.get("attributes") or {}
    rel = item.get("relationships") or {}
    tags = ((rel.get("tags") or {}).get("data") or [])
    tag_names = []
    for tag_ref in tags:
        tag = included_map.get(f"tags:{tag_ref.get('id')}") or {}
        name = ((tag.get("attributes") or {}).get("name") or "").strip()
        if name:
            tag_names.append(name)
    user_ref = (rel.get("user") or {}).get("data") or {}
    user = included_map.get(f"users:{user_ref.get('id')}") or {}
    user_attrs = user.get("attributes") or {}
    return {
        "vod_id": str(item.get("id") or ""),
        "vod_name": clean_text(attrs.get("title") or ""),
        "vod_pic": str(user_attrs.get("avatarUrl") or ""),
        "vod_remarks": " | ".join([x for x in ["/".join(tag_names), str(attrs.get("createdAt") or "")[:10]] if x]),
    }


def shorten_text(value: str, limit: int = 400) -> str:
    text = str(value or "")
    text = text.replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def safe_headers_preview(headers, limit: int = 20) -> str:
    try:
        if headers is None:
            return "{}"
        if hasattr(headers, "items"):
            items = list(headers.items())[:limit]
            return json.dumps({str(k): str(v) for k, v in items}, ensure_ascii=False)
        if isinstance(headers, dict):
            items = list(headers.items())[:limit]
            return json.dumps({str(k): str(v) for k, v in items}, ensure_ascii=False)
    except Exception:
        pass
    return str(headers)


async def log_dump(prefix: str, status=None, location: str = "", final_url: str = "", headers=None, body: str = ""):
    await log("info", f"{prefix} status={status or 0} location={location} final={final_url}")
    await log("info", f"{prefix} headers={safe_headers_preview(headers)}")
    if body:
        await log("info", f"{prefix} body={shorten_text(body)}")


async def resolve_share_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    if not re.search(r"^https?://a\.7u9\.cn/s/", raw, re.I):
        return raw

    def is_real_share_url(value: str) -> bool:
        return bool(re.search(r"^https?://(?:pan\.quark\.cn|drive\.uc\.cn|pan\.baidu\.com|cloud\.189\.cn|www\.aliyundrive\.com|www\.alipan\.com|115\.com|pan\.xunlei\.com|www\.123684\.com|www\.123865\.com|www\.123912\.com|www\.123pan\.com)/", str(value or ""), re.I))

    simple_headers = {
        "User-Agent": "python-requests/2.31.0",
        "Accept": "text/html,*/*",
        "Accept-Encoding": "identity",
    }
    rich_headers = {
        "User-Agent": UA,
        "Referer": f"{BASE_URL}/",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    await log("info", f"[盘尊][resolve-share] start {raw}")

    if py_requests is not None:
        for mode, headers_in_use in (("requests-simple", simple_headers), ("requests-rich", rich_headers)):
            try:
                resp = py_requests.get(raw, headers=headers_in_use, timeout=20, allow_redirects=False)
                location = str(resp.headers.get("Location") or resp.headers.get("location") or "").strip()
                final_url = str(getattr(resp, "url", "") or "").strip()
                body = getattr(resp, "text", "") or ""
                await log_dump(f"[盘尊][resolve-share][{mode}]", int(resp.status_code or 0), location, final_url, resp.headers, body)
                if location:
                    await log("info", f"[盘尊][resolve-share] {raw} -> {location} ({mode}-location)")
                    return location
                if final_url and final_url != raw and is_real_share_url(final_url):
                    await log("info", f"[盘尊][resolve-share] {raw} -> {final_url} ({mode}-final)")
                    return final_url

                # 中间页接口解析：提取 _s / _v 后尝试请求 /api_v1_go_collect/info
                s_match = re.search(r"let\s+_s\s*=\s*'([^']+)'", body)
                v_match = re.search(r"let\s+_v\s*=\s*'([^']+)'", body)
                if s_match and v_match:
                    short_code = s_match.group(1).strip()
                    verify_code = v_match.group(1).strip()
                    cookies = resp.cookies.get_dict() if hasattr(resp, "cookies") else {}
                    cookie_header = "; ".join([f"{k}={v}" for k, v in cookies.items()])
                    await log("info", f"[盘尊][resolve-share] js-page s={short_code} v={verify_code} cookies={json.dumps(cookies, ensure_ascii=False)}")
                    api_candidates = [
                        (f"https://a.7u9.cn/api_v1_go_collect/info?u={quote(short_code)}&v={quote(verify_code)}", None),
                        (f"https://a.7u9.cn/api_v1_go_collect/info", {"u": short_code, "v": verify_code}),
                        (f"https://a.7u9.cn/api_v1_go_collect/info", {"s": short_code, "v": verify_code}),
                        (f"https://a.7u9.cn/api_v1_go_collect/info", {"code": short_code, "v": verify_code}),
                    ]
                    for api_url, form_data in api_candidates:
                        try:
                            if form_data is None:
                                api_resp = py_requests.get(api_url, headers={
                                    "User-Agent": headers_in_use.get("User-Agent") or UA,
                                    "Accept": "application/json, text/plain, */*",
                                    "X-Requested-With": "XMLHttpRequest",
                                    "Cookie": cookie_header,
                                }, timeout=20, allow_redirects=False)
                            else:
                                api_resp = py_requests.post(api_url, headers={
                                    "User-Agent": headers_in_use.get("User-Agent") or UA,
                                    "Accept": "application/json, text/plain, */*",
                                    "X-Requested-With": "XMLHttpRequest",
                                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                                    "Cookie": cookie_header,
                                }, data=form_data, timeout=20, allow_redirects=False)
                            api_text = getattr(api_resp, "text", "") or ""
                            api_location = str(api_resp.headers.get("Location") or api_resp.headers.get("location") or "").strip()
                            await log_dump("[盘尊][resolve-share][js-api]", int(api_resp.status_code or 0), api_location, str(getattr(api_resp, 'url', '') or ''), api_resp.headers, api_text)
                            if api_location and is_real_share_url(api_location):
                                await log("info", f"[盘尊][resolve-share] {raw} -> {api_location} (js-api-location)")
                                return api_location
                            candidates = re.findall(r"https?://(?:pan\.quark\.cn|drive\.uc\.cn|pan\.baidu\.com|cloud\.189\.cn|www\.aliyundrive\.com|www\.alipan\.com|115\.com|pan\.xunlei\.com|www\.123684\.com|www\.123865\.com|www\.123912\.com|www\.123pan\.com)[^\"'<>\s]+", api_text, re.I)
                            if candidates:
                                await log("info", f"[盘尊][resolve-share] {raw} -> {candidates[0]} (js-api-body)")
                                return candidates[0]
                            try:
                                api_json = api_resp.json()
                            except Exception:
                                api_json = None
                            if isinstance(api_json, dict):
                                for key in ("url", "data", "result", "jump", "link", "target"):
                                    val = api_json.get(key)
                                    if isinstance(val, str) and is_real_share_url(val):
                                        await log("info", f"[盘尊][resolve-share] {raw} -> {val} (js-api-json:{key})")
                                        return val
                                    if isinstance(val, dict):
                                        for sub_key in ("url", "link", "target"):
                                            sub_val = val.get(sub_key)
                                            if isinstance(sub_val, str) and is_real_share_url(sub_val):
                                                await log("info", f"[盘尊][resolve-share] {raw} -> {sub_val} (js-api-json:{key}.{sub_key})")
                                                return sub_val
                        except Exception as api_err:
                            await log("warn", f"[盘尊][resolve-share] js-api异常: {api_err}")
            except Exception as e:
                await log("warn", f"[盘尊][resolve-share] {raw} -> {mode}异常: {e}")

    if curl_requests is not None:
        for mode, headers_in_use in (("curl_cffi-simple", simple_headers), ("curl_cffi-rich", rich_headers)):
            try:
                session = curl_requests.Session(impersonate="chrome124")
                resp = session.get(raw, headers=headers_in_use, timeout=20, allow_redirects=False)
                location = str(getattr(resp, "headers", {}).get("Location") or getattr(resp, "headers", {}).get("location") or "").strip()
                final_url = str(getattr(resp, "url", "") or "").strip()
                status = int(getattr(resp, "status_code", 0) or 0)
                body = str(getattr(resp, "text", "") or "")
                await log_dump(f"[盘尊][resolve-share][{mode}]", status, location, final_url, getattr(resp, "headers", {}), body)
                if location:
                    await log("info", f"[盘尊][resolve-share] {raw} -> {location} ({mode}-location)")
                    return location
                if final_url and final_url != raw and is_real_share_url(final_url):
                    await log("info", f"[盘尊][resolve-share] {raw} -> {final_url} ({mode}-final)")
                    return final_url
            except Exception as e:
                await log("warn", f"[盘尊][resolve-share] {raw} -> {mode}异常: {e}")

    class NoRedirectHandler(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    try:
        opener = build_opener(NoRedirectHandler)
        req = Request(raw, headers={
            "User-Agent": UA,
            "Referer": f"{BASE_URL}/",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }, method="GET")
        try:
            resp = opener.open(req, timeout=20)
            status = int(getattr(resp, "status", 200) or 200)
            headers = dict(resp.headers.items()) if getattr(resp, "headers", None) else {}
            location = str(headers.get("Location") or headers.get("location") or "").strip()
            final_url = str(getattr(resp, "geturl", lambda: "")() or "").strip()
            body = ""
            try:
                body = resp.read().decode("utf-8", "ignore")
            except Exception:
                body = ""
            await log_dump("[盘尊][resolve-share][urllib]", status, location, final_url, headers, body)
            if location:
                await log("info", f"[盘尊][resolve-share] {raw} -> {location} (urllib-location)")
                return location
            if final_url and final_url != raw and is_real_share_url(final_url):
                await log("info", f"[盘尊][resolve-share] {raw} -> {final_url} (urllib-final)")
                return final_url
        except HTTPError as e:
            status = int(getattr(e, "code", 0) or 0)
            headers = dict(e.headers.items()) if getattr(e, "headers", None) else {}
            location = str(headers.get("Location") or headers.get("location") or "").strip()
            final_url = str(getattr(e, "geturl", lambda: "")() or "").strip()
            body = ""
            try:
                body = e.read().decode("utf-8", "ignore")
            except Exception:
                body = ""
            await log_dump("[盘尊][resolve-share][urllib]", status, location, final_url, headers, body)
            if location:
                await log("info", f"[盘尊][resolve-share] {raw} -> {location} (urllib-location)")
                return location
            if final_url and final_url != raw and is_real_share_url(final_url):
                await log("info", f"[盘尊][resolve-share] {raw} -> {final_url} (urllib-final)")
                return final_url
    except Exception as e:
        await log("warn", f"[盘尊][resolve-share] {raw} -> urllib异常: {e}")

    try:
        res = await OmniBox.request(raw, {
            "method": "GET",
            "headers": {
                "User-Agent": UA,
                "Referer": f"{BASE_URL}/",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
            "timeout": 20000,
            "redirect": False,
        })
        status = int(res.get("statusCode") or 0)
        headers = res.get("headers") or {}
        location = str(headers.get("location") or headers.get("Location") or "").strip()
        final_url = ""
        for key in ("x-final-url", "X-Final-Url", "x-response-url", "X-Response-Url"):
            maybe = str(headers.get(key) or "").strip()
            if maybe:
                final_url = maybe
                break
        body_raw = res.get("body", "")
        body = body_raw.decode("utf-8", "ignore") if isinstance(body_raw, (bytes, bytearray)) else str(body_raw or "")
        await log_dump("[盘尊][resolve-share][request]", status, location, final_url, headers, body)
        if location:
            await log("info", f"[盘尊][resolve-share] {raw} -> {location} (request-location)")
            return location
        if final_url and final_url != raw and is_real_share_url(final_url):
            await log("info", f"[盘尊][resolve-share] {raw} -> {final_url} (request-final)")
            return final_url
    except Exception as e:
        await log("warn", f"[盘尊][resolve-share] {raw} -> request异常: {e}")

    await log("warn", f"[盘尊][resolve-share] {raw} -> 保留原地址")
    return raw


async def get_drive_file_list(share_url: str, fid: str = "0"):
    return await OmniBox.getDriveFileList(share_url, fid)


async def get_drive_video_play_info(share_url: str, fid: str, route_type: str = "直连"):
    return await OmniBox.getDriveVideoPlayInfo(share_url, fid, route_type)


def normalize_items(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "list", "files", "data", "result"):
            value = data.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                for sub_key in ("items", "list", "files"):
                    sub_val = value.get(sub_key)
                    if isinstance(sub_val, list):
                        return sub_val
    return []


def infer_drive_type(value: str = "") -> str:
    raw = str(value or "").lower()
    if "pan.quark.cn" in raw or "quark" in raw:
        return "quark"
    if "drive.uc.cn" in raw or raw == "uc":
        return "uc"
    if "pan.baidu.com" in raw or "baidu" in raw:
        return "baidu"
    if "cloud.189.cn" in raw or "tianyi" in raw:
        return "tianyi"
    if "aliyundrive" in raw or "alipan" in raw or raw == "ali" or "aliyun" in raw:
        return "ali"
    if "115" in raw:
        return "115"
    if "xunlei" in raw:
        return "xunlei"
    if "123pan" in raw or "123684" in raw or "123865" in raw or "123912" in raw:
        return "123pan"
    return raw


def drive_display_name(drive_type: str = "") -> str:
    mapping = {
        "quark": "夸克",
        "uc": "UC",
        "baidu": "百度",
        "tianyi": "天翼",
        "ali": "阿里",
        "115": "115",
        "xunlei": "迅雷",
        "123pan": "123网盘",
    }
    return mapping.get(str(drive_type or "").lower(), "资源")


def get_base_url_host(context=None) -> str:
    ctx = context or {}
    base_url = str(ctx.get("baseURL") or "").strip()
    if not base_url:
        return ""
    try:
        return (urlparse(base_url).hostname or "").lower()
    except Exception:
        return base_url.lower()


def is_private_host(hostname: str = "") -> bool:
    host = str(hostname or "").lower()
    if not host:
        return False
    if host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        return True
    if re.match(r"^(10\.|192\.168\.|169\.254\.)", host):
        return True
    if re.match(r"^172\.(1[6-9]|2\d|3[0-1])\.", host):
        return True
    if host.endswith(".local") or host.endswith(".lan") or host.endswith(".internal") or host.endswith(".intra"):
        return True
    if ":" in host:
        return host.startswith("fc") or host.startswith("fd") or host.startswith("fe80")
    return False


def can_use_server_proxy(context=None) -> bool:
    if EXTERNAL_SERVER_PROXY_ENABLED:
        return True
    return is_private_host(get_base_url_host(context or {}))


def resolve_caller_source(params=None, context=None) -> str:
    return str((context or {}).get("from") or (params or {}).get("source") or "").lower()


def filter_source_names_for_caller(source_names=None, caller_source: str = "", context=None):
    filtered = list(source_names or [])
    allow_server_proxy = can_use_server_proxy(context or {})
    source = str(caller_source or "").lower()

    if source == "web":
        filtered = [name for name in filtered if name != "本地代理"]
    elif source == "emby":
        filtered = [name for name in filtered if name == "服务端代理"] if allow_server_proxy else [name for name in filtered if name != "服务端代理"]
    elif source == "uz":
        filtered = [name for name in filtered if name != "本地代理"]

    if not allow_server_proxy:
        filtered = [name for name in filtered if name != "服务端代理"]

    return filtered or ["直连"]


def get_route_types(context=None, drive_type: str = ""):
    normalized = infer_drive_type(drive_type)
    if normalized in DRIVE_TYPE_CONFIG:
        source = resolve_caller_source({}, context or {})
        return filter_source_names_for_caller(SOURCE_NAMES_CONFIG, source, context or {})
    return ["直连"]


def resolve_route_type(flag: str = "", caller_source: str = "", context=None) -> str:
    allow_server_proxy = can_use_server_proxy(context or {})
    route_type = "直连"
    if caller_source in ("web", "emby"):
        route_type = "服务端代理" if allow_server_proxy else "直连"
    if flag:
        route_type = flag.split("-")[-1] if "-" in flag else flag
    if not allow_server_proxy and route_type == "服务端代理":
        route_type = "直连"
    if caller_source == "uz" and route_type == "本地代理":
        route_type = "直连"
    return route_type


def sort_play_sources_by_drive_order(play_sources):
    if not isinstance(play_sources, list) or len(play_sources) <= 1 or not DRIVE_ORDER:
        return play_sources
    order_map = {name: idx for idx, name in enumerate(DRIVE_ORDER)}
    return sorted(play_sources, key=lambda item: order_map.get(infer_drive_type(item.get("name", "")), 10 ** 9))


def normalize_play_result(play_info, meta=None):
    meta = meta or {}
    if not isinstance(play_info, dict):
        play_info = {}
    urls = play_info.get("urls") if isinstance(play_info.get("urls"), list) else []
    url = play_info.get("url")

    if isinstance(url, list):
        urls = url
        url = ""

    normalized_urls = []
    if isinstance(urls, list):
        for idx, item in enumerate(urls, start=1):
            if isinstance(item, str):
                normalized_urls.append({"name": f"播放{idx}", "url": item})
            elif isinstance(item, dict):
                candidate = str(item.get("url") or item.get("src") or item.get("playUrl") or item.get("link") or item.get("file") or "").strip()
                if candidate:
                    normalized_urls.append({"name": str(item.get("name") or item.get("label") or item.get("title") or f"播放{idx}"), "url": candidate})
    if not normalized_urls and isinstance(url, str) and url:
        normalized_urls = [{"name": str(meta.get("name") or "播放"), "url": url}]
    final_url = str(url or "").strip()
    if not final_url and normalized_urls:
        final_url = str(normalized_urls[0].get("url") or "")

    return {
        **play_info,
        "parse": int(play_info.get("parse") or 0),
        "url": final_url,
        "urls": normalized_urls,
        "header": play_info.get("header") or {},
    }


async def collect_drive_videos(share_url: str, fid: str = "0", depth: int = 0, visited=None):
    if visited is None:
        visited = set()
    if depth > 3:
        return []
    key = f"{share_url}@@{fid}"
    if key in visited:
        return []
    visited.add(key)

    raw = await get_drive_file_list(share_url, fid)
    items = normalize_items(raw)
    videos = []
    for item in items:
        is_folder = bool(item.get("isFolder") or item.get("dir") or item.get("folder") or item.get("type") == "folder" or item.get("category") == "folder")
        file_id = str(item.get("fileId") or item.get("fid") or item.get("id") or item.get("shareId") or "")
        file_name = str(item.get("name") or item.get("file_name") or item.get("fileName") or item.get("title") or "").strip()
        if is_folder:
            if file_id:
                videos.extend(await collect_drive_videos(share_url, file_id, depth + 1, visited))
            continue
        lower_name = file_name.lower()
        is_video = bool(re.search(r"\.(mp4|mkv|avi|mov|wmv|flv|m4v|ts|m2ts|webm|mpg|mpeg)$", lower_name)) or str(item.get("mimeType") or "").startswith("video/")
        if is_video:
            videos.append({
                "fid": file_id,
                "name": file_name,
                "size": int(item.get("size") or item.get("file_size") or item.get("obj_size") or 0),
            })
    return videos


async def home(params=None, context=None):
    try:
        data = await fetch_discussions("", 0)
        included_map = build_included_map(data.get("included") or [])
        videos = [map_discussion_card(item, included_map) for item in list(data.get("data") or [])]
        videos = [item for item in videos if item.get("vod_id") and item.get("vod_name")][:20]
        await log("info", f"[盘尊][home] count={len(videos)}")
        return {"class": CLASS_LIST, "filters": {}, "list": videos}
    except Exception as e:
        await log("error", f"[盘尊][home] {e}")
        return {"class": CLASS_LIST, "filters": {}, "list": []}


async def category(params, context):
    try:
        category_id = str(params.get("categoryId") or params.get("type_id") or "movies")
        page = int(params.get("page") or 1)
        offset = max(0, (page - 1) * 20)
        data = await fetch_discussions(category_id, offset)
        included_map = build_included_map(data.get("included") or [])
        videos = [map_discussion_card(item, included_map) for item in list(data.get("data") or [])]
        videos = [item for item in videos if item.get("vod_id") and item.get("vod_name")]
        has_more = bool((data.get("links") or {}).get("next"))
        return {
            "page": page,
            "pagecount": page + 1 if has_more else page,
            "total": offset + len(videos) + (1 if has_more else 0),
            "list": videos,
        }
    except Exception as e:
        await log("error", f"[盘尊][category] {e}")
        return {"page": 1, "pagecount": 1, "total": 0, "list": []}


async def search(params, context):
    try:
        keyword = str(params.get("keyword") or params.get("wd") or "").strip()
        page = int(params.get("page") or 1)
        if not keyword:
            return {"page": 1, "pagecount": 1, "total": 0, "list": []}
        offset = max(0, (page - 1) * 20)
        data = await search_discussions(keyword, offset)
        included_map = build_included_map(data.get("included") or [])
        videos = [map_discussion_card(item, included_map) for item in list(data.get("data") or [])]
        videos = [item for item in videos if item.get("vod_id") and item.get("vod_name")]
        has_more = bool((data.get("links") or {}).get("next"))
        return {
            "page": page,
            "pagecount": page + 1 if has_more else page,
            "total": offset + len(videos) + (1 if has_more else 0),
            "list": videos,
        }
    except Exception as e:
        await log("error", f"[盘尊][search] {e}")
        return {"page": 1, "pagecount": 1, "total": 0, "list": []}


async def detail(params, context):
    try:
        discussion_id = str(params.get("videoId") or params.get("vod_id") or params.get("id") or "").strip()
        if not discussion_id:
            return {"list": []}
        data = await fetch_discussion_detail(discussion_id)
        included_map = build_included_map(data.get("included") or [])
        discussion = data.get("data") or {}
        attrs = discussion.get("attributes") or {}
        rel = discussion.get("relationships") or {}

        tags = list(((rel.get("tags") or {}).get("data") or []))
        tag_names = []
        for tag_ref in tags:
            tag = included_map.get(f"tags:{tag_ref.get('id')}") or {}
            name = ((tag.get("attributes") or {}).get("name") or "").strip()
            if name:
                tag_names.append(name)

        user_ref = (rel.get("user") or {}).get("data") or {}
        user = included_map.get(f"users:{user_ref.get('id')}") or {}
        user_attrs = user.get("attributes") or {}

        posts = list(((rel.get("posts") or {}).get("data") or []))
        first_post_ref = posts[0] if posts else {}
        first_post = included_map.get(f"posts:{first_post_ref.get('id')}") or {}
        content_html = str((first_post.get("attributes") or {}).get("contentHtml") or "")
        paragraphs = [clean_text(m) for m in re.findall(r"<p[^>]*>(.*?)</p>", content_html, re.S | re.I)]
        paragraphs = [item for item in paragraphs if item]
        content = "\n\n".join(paragraphs)

        share_links = []
        seen = set()
        for match in SHORT_SHARE_RE.findall(content_html):
            link = str(match or "").replace('"', '').replace("'", "").strip()
            if link and link not in seen:
                seen.add(link)
                share_links.append(link)

        resolved_links = []
        for link in share_links:
            resolved = await resolve_share_url(link)
            if resolved:
                resolved_links.append(resolved)
        share_links = list(dict.fromkeys(resolved_links))

        sources = []
        total_shares = len(share_links)
        for index, share_url in enumerate(share_links, start=1):
            drive_type = infer_drive_type(share_url)
            base_name = f"{drive_display_name(drive_type)}{index if total_shares > 1 else ''}"
            videos = await collect_drive_videos(share_url, "0")
            await log("info", f"[盘尊][detail] share={base_name} videos={len(videos)}")
            route_types = get_route_types(context, drive_type)
            if videos:
                for route_type in route_types:
                    episodes = []
                    for i, file in enumerate(videos, start=1):
                        play_meta = {
                            "kind": "drive",
                            "shareUrl": share_url,
                            "fid": str(file.get("fid") or ""),
                            "name": str(file.get("name") or f"文件{i}"),
                            "routeType": route_type,
                            "size": int(file.get("size") or 0),
                        }
                        episodes.append({
                            "name": play_meta["name"],
                            "playId": b64_encode(play_meta),
                            "size": play_meta["size"],
                        })
                    source_name = f"{base_name}-{route_type}" if len(route_types) > 1 else base_name
                    sources.append({"name": source_name, "episodes": episodes})
            else:
                sources.append({
                    "name": base_name,
                    "episodes": [{
                        "name": base_name,
                        "playId": b64_encode({"kind": "link", "url": share_url, "name": base_name}),
                    }],
                })

        item = {
            "vod_id": discussion_id,
            "vod_name": clean_text(attrs.get("title") or ""),
            "vod_pic": str(user_attrs.get("avatarUrl") or ""),
            "vod_content": content,
            "vod_remarks": " | ".join([x for x in ["/".join(tag_names), str(attrs.get("createdAt") or "")[:10]] if x]),
            "type_name": "/".join(tag_names),
            "vod_play_sources": sort_play_sources_by_drive_order(sources),
        }
        return {"list": [item]}
    except Exception as e:
        await log("error", f"[盘尊][detail] {e}")
        return {"list": []}


async def play(params, context):
    try:
        raw_play_id = str(params.get("playId") or params.get("id") or "")
        meta = b64_decode(raw_play_id)
        if meta.get("kind") == "link":
            await log("info", f"[盘尊][play] direct-link {meta.get('url') or ''}")
            return {
                "parse": 0,
                "url": str(meta.get("url") or ""),
                "urls": [{"name": str(meta.get("name") or "资源"), "url": str(meta.get("url") or "")}],
                "header": {},
            }
        if meta.get("kind") != "drive":
            return {"parse": 0, "url": "", "urls": [], "header": {}}

        caller_source = resolve_caller_source(params, context)
        route_type = resolve_route_type(str(params.get("flag") or meta.get("routeType") or ""), caller_source, context)
        await log("info", f"[盘尊][play] share={meta.get('shareUrl') or ''} fid={meta.get('fid') or ''} route={route_type}")
        play_info = await get_drive_video_play_info(str(meta.get("shareUrl") or ""), str(meta.get("fid") or ""), route_type)
        normalized = normalize_play_result(play_info, meta)
        await log("info", f"[盘尊][play] out parse={normalized.get('parse')} url={normalized.get('url') or ''} urls={len(normalized.get('urls') or [])}")
        return normalized
    except Exception as e:
        await log("error", f"[盘尊][play] {e}")
        return {"parse": 0, "url": "", "urls": [], "header": {}}


run({
    "home": home,
    "category": category,
    "search": search,
    "detail": detail,
    "play": play,
})
