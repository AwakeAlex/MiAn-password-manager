const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 5173
const ROOT = __dirname

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url)
  if (url === '/') url = '/index.html'
  const filePath = path.join(ROOT, url.split('?')[0])
  const ext = path.extname(filePath).toLowerCase()

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Service-Worker-Allowed': '/'
    })
    res.end(data)
  })
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
