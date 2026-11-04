import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('node_modules');
const packages = [];
const seen = new Set();

function inspectPackage(directory) {
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const key = `${manifest.name ?? path.basename(directory)}@${manifest.version ?? 'unknown'}`;
    if (seen.has(key)) return;
    seen.add(key);
    const license = typeof manifest.license === 'string'
      ? manifest.license
      : Array.isArray(manifest.licenses)
        ? manifest.licenses.map((item) => typeof item === 'string' ? item : item?.type).filter(Boolean).join(' OR ')
        : 'UNKNOWN';
    packages.push({ name: manifest.name ?? path.basename(directory), version: manifest.version ?? 'unknown', license });
  } catch {
    packages.push({ name: path.basename(directory), version: 'unknown', license: 'INVALID_MANIFEST' });
  }
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === '.bin') continue;
  const directory = path.join(root, entry.name);
  if (entry.name.startsWith('@')) {
    for (const scoped of fs.readdirSync(directory, { withFileTypes: true })) {
      if (scoped.isDirectory()) inspectPackage(path.join(directory, scoped.name));
    }
  } else inspectPackage(directory);
}

packages.sort((a, b) => a.name.localeCompare(b.name));
const counts = Object.create(null);
for (const item of packages) counts[item.license] = (counts[item.license] ?? 0) + 1;
fs.writeFileSync('dependency-licenses.json', JSON.stringify({ generatedAt: new Date().toISOString(), packageCount: packages.length, licenseCounts: counts, packages }, null, 2));
console.log(JSON.stringify({ packageCount: packages.length, licenseCounts: counts }, null, 2));
