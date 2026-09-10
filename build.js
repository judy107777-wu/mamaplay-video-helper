// 組裝單一 HTML：node build.js
// 產出兩份相同內容：docs/index.html（GitHub Pages 上線用）＋ 媽媽Play影片小幫手.html（本機離線用）
const fs = require('fs');
let html = fs.readFileSync('app-shell.html', 'utf8');
html = html.replace('/*__MP4MUXER__*/', () => fs.readFileSync('mp4muxer.min.js', 'utf8'));
let app = fs.readFileSync('app.js', 'utf8');
const logo = 'data:image/png;base64,' + fs.readFileSync('媽媽playLOGO.png').toString('base64');
app = app.replace('__LOGO_B64__', () => logo);
html = html.replace('/*__APP_JS__*/', () => app);
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/index.html', html);
fs.writeFileSync('媽媽Play影片小幫手.html', html);
console.log('built:', fs.statSync('docs/index.html').size, 'bytes → docs/index.html, 媽媽Play影片小幫手.html');
