// Node 24: o mesmo comparador de versões do app, sem dependências de instalação.
export * from './publicar-downloads-core.ts';
import { main } from './publicar-downloads-core.ts';
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((erro) => { process.stderr.write(`${erro.message}\n`); process.exitCode = 1; });
}
