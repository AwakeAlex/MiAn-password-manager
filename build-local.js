/**
 * 构建本地单文件 HTML
 * 将 CSS、JS、图标全部内联，移除 Service Worker 依赖，
 * 使得用户可以直接双击 .html 文件在浏览器中运行。
 */
const fs = require('fs')
const path = require('path')

const root = __dirname
const htmlPath = path.join(root, 'index.html')
const cssPath = path.join(root, 'styles.css')
const jsPath = path.join(root, 'app.js')
const iconPath = path.join(root, 'icon.svg')
const outDir = path.join(root, 'dist')
const outPath = path.join(outDir, 'mian-password-local.html')

function main() {
  let html = fs.readFileSync(htmlPath, 'utf-8')
  const css = fs.readFileSync(cssPath, 'utf-8')
  const js = fs.readFileSync(jsPath, 'utf-8')
  const iconSvg = fs.readFileSync(iconPath, 'utf-8').replace(/<\?xml[^?]*\?>/i, '').trim()

  // 1. 内联 CSS
  html = html.replace(/<link[^>]*stylesheet[^>]*>/, `<style>\n${css}\n</style>`)

  // 2. 处理 JS：内联图标、移除 Service Worker
  const inlineIcon = iconSvg.replace('<svg', '<svg class="unlock-logo"')
  let inlineJs = js.replace('<img src="icon.svg" class="unlock-logo" alt="logo" />', inlineIcon)
  inlineJs = inlineJs.replace(
    /if\s*\(\s*['"]serviceWorker['"]\s*in\s*navigator\s*\)\s*\{[\s\S]*?navigator\.serviceWorker\.register[\s\S]*?\.catch\(\(\)\s*=>\s*\{\}\)\s*\}/,
    '// 本地文件模式：不注册 Service Worker'
  )


  // 3. 内联 JS
  html = html.replace(/<script[^>]*src=["']app\.js["'][^>]*><\/script>/, `<script>\n${inlineJs}\n</script>`)

  // 4. 移除 manifest 和 icon 外部引用
  html = html.replace(/<link[^>]*rel=["']manifest["'][^>]*>\n?/, '')
  html = html.replace(/<link[^>]*rel=["']icon["'][^>]*>\n?/, '')

  // 5. 更新 description
  html = html.replace(/<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="密安密码本 - 本地单文件版" />')

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, html, 'utf-8')
  console.log('本地单文件 HTML 已生成：', outPath)
}

main()
