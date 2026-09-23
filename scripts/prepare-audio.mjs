/** Acquire licensed SFX for the game build without redistributing their source in Git. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const directory = fileURLToPath(new URL('../public/audio/collector/',import.meta.url));
const files = [
  {file:'select-click.mp3',url:'https://assets.mixkit.co/active_storage/sfx/1109/1109-preview.mp3',sha:'4473ef3397b4a35bb75520e637b827e9984ae1d09bbf27c7f7c72cacc17885f7'},
  {file:'small-win.wav',url:'https://assets.mixkit.co/active_storage/sfx/2020/2020.wav',sha:'469e9498c09f319d66036b7d7fb2969364889e7a492bd98ee489ce2702993b4d'},
];
const hash = data => createHash('sha256').update(data).digest('hex');
await mkdir(directory,{recursive:true});
for (const item of files) {
  const path = `${directory}/${item.file}`;
  try {if (hash(await readFile(path)) === item.sha) continue;} catch {}
  const response = await fetch(item.url,{signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Unable to download ${item.file}: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (hash(body) !== item.sha) throw new Error(`Sound checksum changed: ${item.file}. Review the source before updating it.`);
  await writeFile(path,body);
  console.log(`Prepared ${item.file}`);
}
