#!/usr/bin/env node
/** Build a pinned host artifact, Python tool contract, and offline mobile engine. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = process.argv[2] && resolve(process.argv[2]);
const backend = process.argv[3] && resolve(process.argv[3]);
if (!web || !backend) throw Error('Usage: pnpm export:chat /path/bahulam-web /path/codekepler-backend');
execFileSync('pnpm', ['build'], {cwd:root,stdio:'inherit'});
const { chartCatalog, chartToolSchema } = await import('../packages/workplane-ui/dist/chat.js');
const contract = JSON.stringify({...chartCatalog,tool_schema:chartToolSchema},null,2)+'\n';
mkdirSync(resolve(root,'contracts'), {recursive:true});
writeFileSync(resolve(root,'contracts/chat-chart-v1.json'),contract);
writeFileSync(resolve(backend,'app/chat/workplane-chart-v1.json'),contract);
const pkg = JSON.parse(readFileSync(resolve(root,'packages/workplane-ui/package.json'),'utf8'));
mkdirSync(resolve(web,'vendor'),{recursive:true});
copyFileSync(resolve(root,'LICENSE'),resolve(root,'packages/workplane-ui/LICENSE'));
copyFileSync(resolve(root,'NOTICE'),resolve(root,'packages/workplane-ui/NOTICE'));
execFileSync('pnpm',['pack','--pack-destination',resolve(web,'vendor')],{cwd:resolve(root,'packages/workplane-ui'),stdio:'inherit'});
const archive = resolve(web,`vendor/bahulam-workplane-ui-${pkg.version}.tgz`);
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex').slice(0,12);
const name = `bahulam-workplane-ui-${pkg.version}-${digest}.tgz`;
renameSync(archive,resolve(web,'vendor',name));
for (const hostPackage of ['chat-render','chat-render-web','chat-render-mobile']) {
  const path = resolve(web,'packages',hostPackage,'package.json');
  const host = JSON.parse(readFileSync(path,'utf8'));
  host.dependencies['@bahulam/workplane-ui'] = `file:../../vendor/${name}`;
  writeFileSync(path,JSON.stringify(host,null,2)+'\n');
}
const bundle = await build({entryPoints:[resolve(root,'packages/workplane-ui/src/chat-browser.ts')],bundle:true,
 format:'iife',globalName:'WorkplaneChart',minify:true,write:false,platform:'browser',legalComments:'inline'});
writeFileSync(resolve(web,'packages/chat-render-mobile/src/workplane-chart-bundle.ts'),
 `// Generated from @bahulam/workplane-ui ${pkg.version}. Do not edit. Apache-2.0.\nexport const WORKPLANE_CHART_BUNDLE = ${JSON.stringify(bundle.outputFiles[0].text)};\n`);
console.log(`Exported Workplane ${pkg.version}. Pinned vendor/${name}; run pnpm install in the web repository.`);
