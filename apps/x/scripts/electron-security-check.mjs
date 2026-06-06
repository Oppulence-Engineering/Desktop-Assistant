#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, 'apps', 'main', 'src');
const constructorNames = ['BrowserWindow', 'WebContentsView'];
const disallowedPatterns = [
  { pattern: /\bnodeIntegration\s*:\s*true\b/g, message: 'nodeIntegration must not be true' },
  { pattern: /\bcontextIsolation\s*:\s*false\b/g, message: 'contextIsolation must not be false' },
  { pattern: /\bsandbox\s*:\s*false\b/g, message: 'sandbox must not be false' },
  { pattern: /\bwebSecurity\s*:\s*false\b/g, message: 'webSecurity must not be false' },
  { pattern: /\ballowRunningInsecureContent\s*:\s*true\b/g, message: 'allowRunningInsecureContent must not be true' },
  { pattern: /\benableRemoteModule\s*:\s*true\b/g, message: 'enableRemoteModule must not be true' },
];

const failures = [];

for (const file of walk(sourceRoot)) {
  if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const relative = path.relative(repoRoot, file);

  for (const { pattern, message } of disallowedPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      failures.push(`${relative}:${lineNumber(text, match.index)} ${message}`);
    }
  }

  for (const constructorName of constructorNames) {
    for (const block of constructorBlocks(text, constructorName)) {
      const webPreferences = propertyBlock(block.value, 'webPreferences');
      if (!webPreferences) {
        failures.push(`${relative}:${lineNumber(text, block.start)} ${constructorName} must declare webPreferences`);
        continue;
      }
      for (const required of [
        ['nodeIntegration', 'false'],
        ['contextIsolation', 'true'],
        ['sandbox', 'true'],
      ]) {
        const [key, expected] = required;
        const regex = new RegExp(`\\b${key}\\s*:\\s*${expected}\\b`);
        if (!regex.test(webPreferences)) {
          failures.push(`${relative}:${lineNumber(text, block.start)} ${constructorName} webPreferences must set ${key}: ${expected}`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Electron security check failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log('Electron security check: ok');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

function constructorBlocks(text, constructorName) {
  const out = [];
  const regex = new RegExp(`new\\s+${constructorName}\\s*\\(\\s*\\{`, 'g');
  for (const match of text.matchAll(regex)) {
    const braceStart = text.indexOf('{', match.index);
    const braceEnd = matchingBrace(text, braceStart);
    if (braceEnd >= 0) {
      out.push({ start: match.index, value: text.slice(braceStart, braceEnd + 1) });
    }
  }
  return out;
}

function propertyBlock(text, propertyName) {
  const regex = new RegExp(`\\b${propertyName}\\s*:\\s*\\{`, 'g');
  const match = regex.exec(text);
  if (!match) return '';
  const braceStart = text.indexOf('{', match.index);
  const braceEnd = matchingBrace(text, braceStart);
  if (braceEnd < 0) return '';
  return text.slice(braceStart, braceEnd + 1);
}

function matchingBrace(text, start) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      const newline = text.indexOf('\n', i + 2);
      if (newline < 0) break;
      i = newline;
      continue;
    }
    if (char === '/' && next === '*') {
      const commentEnd = text.indexOf('*/', i + 2);
      if (commentEnd < 0) return -1;
      i = commentEnd + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}
