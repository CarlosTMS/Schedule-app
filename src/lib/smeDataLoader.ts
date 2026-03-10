/**
 * smeDataLoader.ts
 *
 * Fetches SME coverage data from the live API endpoint.
 * Results are cached in localStorage with a 24-hour TTL so the app
 * works offline and avoids hammering the server on every render.
 *
 * API: https://solweeks-academy-web.cfapps.us10.hana.ondemand.com/api/public/smes
 */

import type { SME } from './smeMatcher';
import staticSmeData from '../../solution-weeks-sme-coverage.json';

const API_URL = 'https://solweeks-academy-web.cfapps.us10.hana.ondemand.com/api/public/smes';
const CACHE_KEY = 'sme_data_cache';
const CACHE_DATE_KEY = 'sme_data_cache_date';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SMECacheStatus {
    source: 'api' | 'cache' | 'fallback';
    fetchedAt: string | null; // ISO date string
    lastUpdatedAt: string | null; // from API payload
    error?: string;
}

export interface SMEDataResult {
    smes: SME[];
    status: SMECacheStatus;
}

/** Returns today's date as a YYYY-MM-DD string in local time */
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Check if the cached data is still fresh (within CACHE_TTL_MS) */
const isCacheFresh = (): boolean => {
    const cachedDate = localStorage.getItem(CACHE_DATE_KEY);
    if (!cachedDate) return false;
    const age = Date.now() - new Date(cachedDate).getTime();
    return age < CACHE_TTL_MS;
};

/** Read cached SME list from localStorage */
const readCache = (): SME[] | null => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as SME[];
    } catch {
        return null;
    }
};

/** Write SME list to localStorage cache */
const writeCache = (smes: SME[]): void => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(smes));
        localStorage.setItem(CACHE_DATE_KEY, new Date().toISOString());
    } catch {
        // localStorage might be full; silently skip
    }
};

/**
 * Loads SME data. Priority:
 *   1. Fresh cache (< 24h old) — instant, no network
 *   2. Live API — fetched & cached for next time
 *   3. Stale cache — if API fails, use whatever we have
 */
export const loadSMEData = async (): Promise<SMEDataResult> => {
    // 1. Fresh cache hit
    if (isCacheFresh()) {
        const cached = readCache();
        if (cached) {
            return {
                smes: cached,
                status: {
                    source: 'cache',
                    fetchedAt: localStorage.getItem(CACHE_DATE_KEY),
                    lastUpdatedAt: null,
                },
            };
        }
    }

    // 2. Try live API
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const smes: SME[] = json.solution_weeks_sme_coverage ?? [];

        writeCache(smes);

        return {
            smes,
            status: {
                source: 'api',
                fetchedAt: new Date().toISOString(),
                lastUpdatedAt: json.last_updated_at ?? todayStr(),
            },
        };
    } catch (err) {
        // 3. Stale cache fallback
        const stale = readCache();
        if (stale) {
            return {
                smes: stale,
                status: {
                    source: 'cache',
                    fetchedAt: localStorage.getItem(CACHE_DATE_KEY),
                    lastUpdatedAt: null,
                    error: `Live fetch failed (${err}). Using cached data.`,
                },
            };
        }

        // 4. Ultimate fallback to local JSON file
        const staticSmes = staticSmeData.solution_weeks_sme_coverage as unknown as SME[];
        return {
            smes: staticSmes,
            status: {
                source: 'fallback',
                fetchedAt: new Date().toISOString(),
                lastUpdatedAt: null,
                error: `Live fetch failed and no cache found. Using local backup.`,
            },
        };
    }
};

/** Force a fresh fetch regardless of cache age (e.g. manual refresh button) */
export const forceFetchSMEData = async (): Promise<SMEDataResult> => {
    localStorage.removeItem(CACHE_DATE_KEY); // invalidate TTL
    return loadSMEData();
};
