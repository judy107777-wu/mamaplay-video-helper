// 端對端測試：npm test（先 build 再跑）
// 用本機安裝的 Google Chrome（含 H.264/AAC，與手機一致），素材取 _原始素材 第一支 mp4
// 流程：載入 → 兩段跳選（第二段 2x＋聚焦 1.5x）→ 移動模糊框 → 標題 → 輸出 → ffprobe 驗證 → 抽格目視
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'test-output');
const SRC_DIR = path.join(ROOT, '_原始素材');

(async () => {
  const src = process.argv[2] ||
    path.join(SRC_DIR, fs.readdirSync(SRC_DIR).filter(f => /\.(mp4|mov|webm)$/i.test(f)).sort()[0]);
  fs.mkdirSync(OUT, { recursive: true });
  console.log('素材:', path.relative(ROOT, src));

  const b = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none'],
  });
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text()); });
  p.on('pageerror', e => console.log('[pageerror]', String(e)));

  await p.goto(pathToFileURL(path.join(ROOT, 'docs', 'index.html')).href);
  await p.waitForTimeout(500);

  // 餵入測試影片
  const buf = fs.readFileSync(src);
  await p.evaluate(async ({ b64, name }) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    window.__file = new File([bin], name, { type: 'video/mp4', lastModified: new Date('2026-06-06T10:00:00').getTime() });
  }, { b64: buf.toString('base64'), name: path.basename(src) });

  // 完整流程：兩段跳選（第二段2x＋聚焦）＋移動模糊框＋標題
  const segments = [
    { in: 1.0, out: 5.0, speed: 1 },
    { in: 8.0, out: 14.0, speed: 2, zoom: { s: 1.5, cx: 0.35, cy: 0.40 } },
  ];
  const t0 = Date.now();
  const result = await p.evaluate(async (segments) => {
    const T = window.__test;
    await T.loadVideo(window.__file);
    T.S.segments = segments;
    T.S.blurs = [{
      id: 1,
      keys: [
        { t: 0, x: 0.10, y: 0.10, w: 0.30, h: 0.10 },
        { t: 10, x: 0.55, y: 0.20, w: 0.30, h: 0.10 },
      ],
      from: 0, to: 99,
    }];
    T.S.category = '小廚師烘焙夏令營';
    T.S.content = '咖哩蛋包飯';
    T.S.title = '畫上最愛的角色\n彩繪長條蛋糕'; T.S.pill = '和孩子一起輕鬆玩親子烘焙';
    T.S.titlePos = 'bot';
    T.S.colorOn = true;
    T.S.date = '20260606'; T.S.serial = '01';
    const r = await T.exportVideo(() => {});
    window.__blob = r.blob;
    return { size: r.blob.size, hasAudio: r.hasAudio, vCodecId: r.vCodecId };
  }, segments);
  console.log('EXPORT:', JSON.stringify(result), `耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 取回檔案
  const b64 = await p.evaluate(async () => {
    const u8 = new Uint8Array(await window.__blob.arrayBuffer());
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  });
  const outFile = path.join(OUT, 'out-test.mp4');
  fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
  await p.screenshot({ path: path.join(OUT, 'ui.png') });
  await b.close();

  // ffprobe 驗證：時長=Σ(out-in)/speed、1080×1920、30fps、含音訊
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outFile]).toString());
  const v = probe.streams.find(s => s.codec_type === 'video');
  const a = probe.streams.find(s => s.codec_type === 'audio');
  const expectDur = segments.reduce((sum, s) => sum + (s.out - s.in) / s.speed, 0);
  const dur = parseFloat(probe.format.duration);
  const checks = [
    ['影片編碼 H.264', v && v.codec_name === 'h264', v && v.codec_name],
    ['解析度 1080×1920', v && v.width === 1080 && v.height === 1920, v && `${v.width}×${v.height}`],
    ['30fps', v && v.r_frame_rate === '30/1', v && v.r_frame_rate],
    ['含 AAC 音訊', a && a.codec_name === 'aac', a ? a.codec_name : '無'],
    [`時長 ≈ ${expectDur}s`, Math.abs(dur - expectDur) < 0.15, dur.toFixed(3) + 's'],
  ];
  let ok = true;
  for (const [name, pass, actual] of checks) {
    console.log(`${pass ? '✔' : '✘'} ${name}（實際：${actual}）`);
    if (!pass) ok = false;
  }

  // 抽格目視：第一段（無聚焦）、第二段（聚焦＋模糊框移動後）
  for (const [t, name] of [[1.5, 'frame-seg1.png'], [5.5, 'frame-seg2-zoom.png']]) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', outFile, '-frames:v', '1', path.join(OUT, name)]);
  }
  console.log('輸出與抽格：test-output/');
  if (!ok) { console.error('FAIL：驗證未通過'); process.exit(1); }
  console.log('PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
