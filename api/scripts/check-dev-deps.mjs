// Fails early with a readable message when the API dependencies are missing
// (typical cause of "TS2688: Cannot find type definition file for 'node'").
import { existsSync } from 'node:fs'

const required = ['@types/node', 'typescript', 'tsx']
const missing = required.filter((name) => !existsSync(new URL(`../node_modules/${name}`, import.meta.url)))

if (missing.length > 0) {
  console.error(
    `\nDépendances de l'API manquantes (${missing.join(', ')}).\n` +
      `Lancez, depuis la racine du dépôt :  npm run setup:api\n` +
      `(équivalent de : npm --prefix api ci --include=dev)\n`,
  )
  process.exit(1)
}
