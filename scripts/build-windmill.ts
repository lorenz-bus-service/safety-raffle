// Stages the project for a Windmill workspace: one script per source file, in one folder, so the
// files' relative imports resolve as Windmill "shared logic" scripts. The entry script is create_tickets.
// Usage: node scripts/build-windmill.ts [output folder]   (default: windmill-dist)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'windmill-dist';
// Not needed in Windmill: the command line and the comparison with the earlier script.
const skip = new Set(['cli.ts', 'compare.ts']);
const rename: Record<string, string> = { 'windmill.ts': 'create_tickets.ts' };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const manifest: Record<string, string> = {};
for (const file of readdirSync('src').filter((name) => name.endsWith('.ts') && !skip.has(name)).sort()) {
  const content = readFileSync(join('src', file), 'utf8');
  const name = rename[file] ?? file;
  writeFileSync(join(out, name), content);
  manifest[name.replace(/\.ts$/, '')] = createHash('sha256').update(content).digest('hex');
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Staged ${Object.keys(manifest).length} scripts in ${out}/`);
