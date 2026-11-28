// Writes the cross-language test vectors: npm run vectors -w @mirror-studio/protocol
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVectors } from '../src/vectors'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors')
mkdirSync(dir, { recursive: true })
for (const [file, content] of Object.entries(buildVectors())) writeFileSync(join(dir, file), JSON.stringify(content, null, 2) + '\n')
console.log(`vectors written to ${dir}`)
