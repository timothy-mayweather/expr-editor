/// <reference path="./declarations.d.ts" />
// @ts-ignore
import './wasm_exec.js';
// @ts-ignore
import wasmManifest from './expr_linter.manifest';

let wasmInitializing: Promise<void> | null = null;
let wasmReady = false;

const DB_NAME = 'WasmCacheDB';
const STORE_NAME = 'wasm_store';
const WASM_KEY = 'expr_wasm';

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

interface CachedItem {
    file: string;
    version: string;
    fileVersion: string;
    hash: string;
    buffer: ArrayBuffer;
}

async function deleteCachedWasm(): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(WASM_KEY);
}

async function getCachedWasm(): Promise<ArrayBuffer | null> {
    try {
        const db = await openDB();
        const item: CachedItem | undefined = await new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(WASM_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
        });

        if (!item) return null; // Cache miss

        if (item.version !== wasmManifest.version) {
            deleteCachedWasm().then(()=>{console.log("Outdated wasm cleaned up successfully.")}); // Fire and forget cleanup
            return null;
        }

        return item.buffer;
    } catch {
        return null;
    }
}

async function cacheWasm(buffer: ArrayBuffer): Promise<void> {
    try {
        const db = await openDB();
        const item: CachedItem = {
            ...wasmManifest,
            buffer
        };
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(item, WASM_KEY);
    } catch (err) {
        console.warn('Failed to save to IndexedDB:', err);
    }
}

export async function getWasmBuffer(): Promise<ArrayBuffer> {
    // 1. Try loading from IndexedDB cache first
    const cachedBuffer = await getCachedWasm();
    if (cachedBuffer) {
        return cachedBuffer
    }

    const wasmUrl = "/" + wasmManifest.fileVersion;

    console.log('🌐 Fetching WASM from URL:', wasmManifest.fileVersion);
    const response = await fetch(wasmUrl);

    if (!response.ok) {
        throw new Error(`Failed to fetch WASM from ${wasmUrl}: ${response.statusText}`);
    }

    // Decompress if URL ends with .gz using native DecompressionStream
    const decompressedStream = response.body!.pipeThrough(new DecompressionStream('gzip'));
    const decompressedResponse = new Response(decompressedStream);
    const wasmBuffer = await decompressedResponse.arrayBuffer();

    // 4. Cache uncompressed ArrayBuffer asynchronously in IndexedDB for next time
    cacheWasm(wasmBuffer).then(() => {
        console.log("Wasm cached successfully.")
    }).catch(err => {
        console.warn("Failed to cache WASM:", err);
    }); //Fire and forget

    return wasmBuffer
}

/**
 * Initializes the WebAssembly module for the expression linter.
 * It decodes the bundled base64 WASM binary and instantiates it.
 * This must be called and awaited before the linter can be used.
 * 
 * @returns A promise that resolves when the WASM module is fully loaded and running.
 */
export async function initWasm(): Promise<void> {
    if (wasmReady) return;
    if (!wasmInitializing) {
        wasmInitializing = new Promise<void>(async (resolve, reject) => {
            try {
                const go = new (globalThis as any).Go();

                const wasmBuffer = await getWasmBuffer();

                const { instance } = await WebAssembly.instantiate(wasmBuffer, go.importObject);
                go.run(instance);
                wasmReady = true;
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }
    return wasmInitializing;
}

/**
 * Checks if the WebAssembly module has been successfully loaded and is ready for use.
 * 
 * @returns True if the WASM module is ready, otherwise false.
 */
export function isWasmReady() {
    return wasmReady;
}
