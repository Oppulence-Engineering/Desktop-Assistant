import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Point WorkDir at an isolated temp dir so loadMemoryConfig reads a known file.
// memory/config.ts is the only importer of ../config/config.js in this test's
// graph, so a minimal mock is safe.
const TEST_WORKDIR = vi.hoisted(() => '/tmp/rowboat-mem-cfg-test');
vi.mock('../config/config.js', () => ({ WorkDir: TEST_WORKDIR }));

import { MemoryConfig, loadMemoryConfig, indexDir } from './config.js';

const DEFAULTS = {
    enabled: true,
    model: 'text-embedding-3-small',
    dims: 0,
    batchSize: 64,
    maxMonthlyEmbedTokens: 0,
    maxPerNote: 2,
    recencyWeight: 0,
    snippetChars: 600,
    embedDimensions: 0,
    queryExpansion: false,
};

describe('MemoryConfig schema', () => {
    it('fills all defaults for an empty object', () => {
        expect(MemoryConfig.parse({})).toEqual(DEFAULTS);
    });

    it('falls back per-field on invalid values (never throws)', () => {
        const cfg = MemoryConfig.parse({
            enabled: 'yes', // not a boolean → true
            model: '', // empty → default model
            dims: -5, // negative → 0
            batchSize: 0, // not positive → 64
            maxMonthlyEmbedTokens: 1.5, // not an int → 0
        });
        expect(cfg).toEqual(DEFAULTS);
    });

    it('preserves valid values', () => {
        const cfg = MemoryConfig.parse({
            enabled: false,
            model: 'text-embedding-3-large',
            dims: 3072,
            batchSize: 32,
            maxMonthlyEmbedTokens: 1_000_000,
            maxPerNote: 5,
            recencyWeight: 0.25,
            snippetChars: 800,
            embedDimensions: 512,
            queryExpansion: true,
        });
        expect(cfg).toEqual({
            enabled: false,
            model: 'text-embedding-3-large',
            dims: 3072,
            batchSize: 32,
            maxMonthlyEmbedTokens: 1_000_000,
            maxPerNote: 5,
            recencyWeight: 0.25,
            snippetChars: 800,
            embedDimensions: 512,
            queryExpansion: true,
        });
    });

    it('coerces invalid new fields to their defaults', () => {
        const cfg = MemoryConfig.parse({
            maxPerNote: -1, // negative → default 2
            recencyWeight: 5, // out of [0,1] → default 0
            snippetChars: 0, // not positive → default 600
            embedDimensions: -10, // negative → default 0
            queryExpansion: 'yes', // not a boolean → default false
        });
        expect(cfg.maxPerNote).toBe(2);
        expect(cfg.recencyWeight).toBe(0);
        expect(cfg.snippetChars).toBe(600);
        expect(cfg.embedDimensions).toBe(0);
        expect(cfg.queryExpansion).toBe(false);
    });
});

describe('loadMemoryConfig', () => {
    const configFile = path.join(TEST_WORKDIR, 'config', 'index.json');
    const savedEnv = { ...process.env };

    beforeEach(() => {
        fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
        fs.mkdirSync(path.join(TEST_WORKDIR, 'config'), { recursive: true });
        delete process.env.SOLOMON_MEMORY_ENABLED;
        delete process.env.SOLOMON_MEMORY_MODEL;
    });
    afterEach(() => {
        fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
        process.env = { ...savedEnv };
    });

    it('returns defaults when no config file exists', () => {
        expect(loadMemoryConfig()).toEqual(DEFAULTS);
    });

    it('merges a partial config file over the defaults', () => {
        fs.writeFileSync(configFile, JSON.stringify({ dims: 768, batchSize: 16 }));
        expect(loadMemoryConfig()).toEqual({ ...DEFAULTS, dims: 768, batchSize: 16 });
    });

    it('coerces invalid field types to defaults (per-field)', () => {
        fs.writeFileSync(configFile, JSON.stringify({ enabled: 'x', dims: -1, batchSize: 0 }));
        expect(loadMemoryConfig()).toEqual(DEFAULTS);
    });

    it('falls back to defaults for a non-object config file', () => {
        fs.writeFileSync(configFile, JSON.stringify([1, 2, 3]));
        expect(loadMemoryConfig()).toEqual(DEFAULTS);
    });

    it('falls back to defaults for invalid JSON', () => {
        fs.writeFileSync(configFile, '{ not valid json');
        expect(loadMemoryConfig()).toEqual(DEFAULTS);
    });

    it('lets SOLOMON_MEMORY_ENABLED=false override an enabled file', () => {
        fs.writeFileSync(configFile, JSON.stringify({ enabled: true }));
        process.env.SOLOMON_MEMORY_ENABLED = 'false';
        expect(loadMemoryConfig().enabled).toBe(false);
    });

    it('lets SOLOMON_MEMORY_MODEL override the model', () => {
        process.env.SOLOMON_MEMORY_MODEL = 'my-custom-embedder';
        expect(loadMemoryConfig().model).toBe('my-custom-embedder');
    });

    it('lets SOLOMON_MEMORY_QUERY_EXPANSION enable query expansion', () => {
        process.env.SOLOMON_MEMORY_QUERY_EXPANSION = '1';
        expect(loadMemoryConfig().queryExpansion).toBe(true);
    });

    it('lets SOLOMON_MEMORY_RECENCY_WEIGHT override the recency weight (clamped)', () => {
        process.env.SOLOMON_MEMORY_RECENCY_WEIGHT = '0.3';
        expect(loadMemoryConfig().recencyWeight).toBe(0.3);
        process.env.SOLOMON_MEMORY_RECENCY_WEIGHT = '9'; // out of range → ignored
        expect(loadMemoryConfig().recencyWeight).toBe(0);
    });

    it('indexDir resolves under the work dir', () => {
        expect(indexDir()).toBe(path.join(TEST_WORKDIR, 'index'));
    });
});
