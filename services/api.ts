// Fast API service using parallel proxy racing for banner + level info

const fetchWithTimeout = async (resource: string, options: RequestInit = {}, timeout = 5000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

const findValueRecursive = (obj: any, keyRegex: RegExp, searchInsideObject = false): string | undefined => {
    if (!obj || typeof obj !== 'object') return undefined;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const res = findValueRecursive(item, keyRegex, searchInsideObject);
            if (res) return res;
        }
        return undefined;
    }
    const keys = Object.keys(obj);
    for (const key of keys) {
        if (keyRegex.test(key)) {
            const val = obj[key];
            if (typeof val === 'string' && val.length > 4) return val;
            if (searchInsideObject && typeof val === 'object' && val !== null) {
                const innerUrl = findValueRecursive(val, /^(url|src|href|icon|img|image|link|pic|source)$/i, false);
                if (innerUrl) return innerUrl;
            }
        }
    }
    for (const key of keys) {
        if (typeof obj[key] === 'object') {
            const result = findValueRecursive(obj[key], keyRegex, searchInsideObject);
            if (result) return result;
        }
    }
    return undefined;
};

export const launchInstanceApi = async (targetUid: string, apiUrlPattern: string): Promise<string> => {
    let url = (apiUrlPattern || '').trim();
    if (!url) throw new Error("API URL not configured");
    if (!url.startsWith('http')) url = `https://${url}`;
    url = url.replace(/{target_uid}/g, targetUid);
    try { new URL(url); } catch { throw new Error("Invalid API URL Configuration"); }

    console.log(`[Launch API] Requesting: ${url}`);
    const response = await fetchWithTimeout(url, {}, 8000);
    const text = await response.text();
    console.log(`[Launch API] Status: ${response.status}, Response: ${text}`);
    if (!response.ok) throw new Error(`API Error: ${response.status} - ${text}`);
    return text || "Instance launched successfully";
};

export const deleteInstanceApi = async (targetUid: string, apiUrlPattern: string): Promise<string> => {
    let url = (apiUrlPattern || '').trim();
    if (!url) throw new Error("API URL not configured");
    if (!url.startsWith('http')) url = `https://${url}`;
    url = url.replace(/{target_uid}/g, targetUid);
    try { new URL(url); } catch { throw new Error("Invalid API URL Configuration"); }

    const response = await fetchWithTimeout(url, {}, 8000);
    const text = await response.text();
    if (!response.ok) throw new Error(`API Error: ${response.status} - ${text}`);
    return text || "Instance removed successfully";
};

// --- FAST Profile / Banner Fetching (parallel race) ---

const PROXIES: Array<(u: string) => string> = [
    (u) => u,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
];

const cacheBust = (u: string) => `${u}${u.includes('?') ? '&' : '?'}_t=${Date.now()}`;

// Simple in-memory cache (5s TTL) so repeated UI renders don't hammer endpoints
const cache = new Map<string, { t: number; data: any }>();
const TTL = 5000;

const getCached = (key: string) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL) return hit.data;
    return undefined;
};
const setCached = (key: string, data: any) => cache.set(key, { t: Date.now(), data });

// Race all proxies in parallel; return the first OK response text
const raceProxies = async (url: string, timeout = 4500): Promise<string> => {
    const attempts = PROXIES.map(p => (async () => {
        const res = await fetchWithTimeout(cacheBust(p(url)), {
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
        }, timeout);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const txt = await res.text();
        if (!txt) throw new Error('empty');
        return txt;
    })());
    return await Promise.any(attempts);
};

export const fetchProfileData = async (uid: string, apiUrlPattern?: string): Promise<any> => {
    const baseUrl = apiUrlPattern || "https://mehedi-x-banner.vercel.app/profile?uid={uid}";
    const url = baseUrl.replace(/{uid}/g, uid).replace(/{target_uid}/g, uid);

    if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)) {
        return { Banner: url, Avatar: "", Nickname: "" };
    }

    const cacheKey = `p:${url}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const text = await raceProxies(url, 4500);
        try {
            const json = JSON.parse(text);
            if (json && typeof json === 'object') {
                const banner = findValueRecursive(json, /.*(banner|background|cover|wall|header).*/i, true);
                const avatar = findValueRecursive(json, /.*(avatar|icon|image|pic|photo|profile).*/i, true);
                const nickname = findValueRecursive(json, /^(nickname|name|user_name|username|ign|player_name)$/i, false);
                const result = { Banner: banner || "", Avatar: avatar || "", Nickname: nickname || "" };
                setCached(cacheKey, result);
                return result;
            }
        } catch {
            if (text.trim().startsWith("http")) {
                const result = { Banner: text.trim(), Avatar: "", Nickname: "" };
                setCached(cacheKey, result);
                return result;
            }
        }
    } catch (e) {
        // all proxies failed
    }

    const fallback = { Banner: url, Avatar: "", Nickname: "" };
    return fallback;
};

export const fetchLevelInfo = async (uid: string, apiUrlPattern?: string): Promise<any> => {
    const baseUrl = apiUrlPattern || "https://mehedixlevel-info-nxt.vercel.app/level/{uid}";
    const url = baseUrl.replace(/{uid}/g, uid).replace(/{target_uid}/g, uid);

    const cacheKey = `l:${url}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const text = await raceProxies(url, 5000);
        try {
            const j = JSON.parse(text);
            if (j && typeof j === 'object') {
                setCached(cacheKey, j);
                return j;
            }
        } catch {
            // not JSON
        }
    } catch (e) {
        // all failed
    }
    return null;
};
