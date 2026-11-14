import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(rootDir, 'src', 'services', 'email', 'templates');
const targetDir = join(rootDir, 'dist', 'services', 'email', 'templates');

if (!existsSync(sourceDir)) {
  throw new Error(`Email template directory not found: ${sourceDir}`);
}

cpSync(sourceDir, targetDir, { recursive: true, force: true });
