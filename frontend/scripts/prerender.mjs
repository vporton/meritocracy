import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '../.prerender/entry-server.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(root, 'dist')
const template = await readFile(join(outputDirectory, 'index.html'), 'utf8')

const routes = [
  '/',
  '/treasury',
  '/ban-voting',
  '/logs',
  '/audit-log',
  '/ban-voting/timing-plan',
  '/timing-plan',
  '/defense-panel',
  '/connect',
  '/verify-email',
  '/admin',
]

const serializePageData = (data) => JSON.stringify(data)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

for (const route of routes) {
  const { html, head, data } = await render(route)
  const document = template
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`)
    .replace('    <title>SciWard</title>\n', '')
    .replace(
      '</head>',
      `${head}\n<script id="__PRERENDER_DATA__" type="application/json">${serializePageData(data)}</script>\n  </head>`,
    )
  const outputFiles = route === '/'
    ? [join(outputDirectory, 'index.html')]
    : [
        join(outputDirectory, `${route.slice(1)}.html`),
        join(outputDirectory, route.slice(1), 'index.html'),
      ]

  for (const outputFile of outputFiles) {
    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, document)
  }
  console.log(`prerendered ${route} -> ${outputFiles.join(', ')}`)
}
