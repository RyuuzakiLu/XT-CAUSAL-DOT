/* 构建后核对简洁版 CSS 是否真的被 client.js 的页面样式挂载逻辑引用。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transform } from 'lightningcss'
const root = resolve(import.meta.dirname, '..')
const bundle = readFileSync(process.argv[2] ?? resolve(root, 'lib/client.js'), 'utf8')
const marker = bundle.indexOf('dot: 简洁版样式')
if (marker < 0) throw new Error('简洁版样式挂载代码缺失')
const mount = bundle.slice(Math.max(0, marker - 900), marker)
for (const name of ['messages', 'calendar-todo', 'work-page', 'lite']) {
  const file = `src/client/lite/${name}.module.css`
  const compiled = transform({ filename: `@xtcausal/dot-ui-shell/${file}`, code: readFileSync(resolve(root, file)), cssModules: { pattern: '[hash]_[local]' }, minify: true }).code.toString()
  const at = bundle.indexOf(JSON.stringify(compiled))
  const variable = at < 0 ? undefined : /(?:const|let|var)\s+([\w$]+)\s*=\s*$/.exec(bundle.slice(Math.max(0, at - 100), at))?.[1]
  if (!variable || !mount.includes(variable)) throw new Error(`${name} 样式没有被简洁版页面挂载`)
  console.log(`${name}: 已打包并挂载`)
}
