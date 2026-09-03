import { readdir } from 'node:fs/promises';

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

export async function migrationFiles(directory = new URL('../migrations/', import.meta.url)): Promise<string[]> {
  return (await readdir(directory)).filter((name) => MIGRATION_NAME.test(name)).sort();
}
