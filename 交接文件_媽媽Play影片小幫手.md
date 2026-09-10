# 媽媽Play 影片小幫手 — Claude Code 開發交接文件

版本：2026-07-24
狀態：第一階段原型已完成並在 Android 手機實測（部分問題已修復，最新版尚未在真機驗證）
交接內容：本文件＋原始碼壓縮包（`mamaplay-source.zip`）

---

## 1. 專案目標

老師課堂隨拍 10–30 秒直式側錄影片，在 Android 手機 Chrome 上一條龍完成：剪輯 → 調色 → 姓名模糊 → 標題 → 輸出 Reels 規格 MP4 → 複製文案 → 發布 FB 粉專/IG。全程單一網頁 App，無伺服器（第一階段）。

- 裝置：Android 手機 Chrome（桌面 Chrome 亦可用）
- 發布：FB 粉絲專頁＋IG 商業帳號（皆有 Graph API，第二階段做全自動發布）
- 雲端：Google Drive（第二階段自動上傳原始檔＋成品）
- 一天同一活動 1–5 支影片，單支操作目標 1–2 分鐘

## 2. 原始碼結構（zip 內）

| 檔案 | 說明 |
|---|---|
| `app-shell.html` | 頁面骨架：CSS＋HTML markup，含兩個注入點 `/*__MP4MUXER__*/` 與 `/*__APP_JS__*/` |
| `app.js` | 全部程式邏輯（未壓縮、含中文註解），內有 `__LOGO_B64__` 佔位符 |
| `mp4muxer.min.js` | mp4-muxer 5.2.2 min 版（npm `mp4-muxer`，esbuild --minify 產出） |
| `媽媽playLOGO.png` | 去背 logo 336×124，內嵌用（zip 解壓曾把檔名弄成亂碼，2026-09-10 已改回） |
| `build.js` | 組裝腳本：注入 muxer、app.js（logo 轉 dataURL 取代佔位符）→ 產出 `docs/index.html`（上線用）＋`媽媽Play影片小幫手.html`（本機離線用，不進 git） |
| `e2e.js` | Playwright 自動化測試（載入→剪兩段→加速→聚焦→模糊→標題→輸出→ffprobe 驗證→抽格） |
| `docs/index.html` | 組裝完成的單檔成品，GitHub Pages 由此發布 |
| `_原始素材/`、`媽媽play活動側錄剪輯範本/` | 測試素材與成品範例（含學員畫面，**.gitignore 排除，不上傳公開 repo**） |

組裝：`npm run build`。測試：`npm test`（見 §6）。

## 3. 已定案功能規格

### 3.1 三步驟流程（步驟籤直列在畫面左側）

**步驟1 剪輯**
- 多段跳選：片段清單「起→訖」，按「設起點／設終點」以目前播放位置設定；依時間序自動接成一支
- 每段獨立加速：1x／1.5x／2x／3x
- 每段獨立「聚焦」放大：關／1.3x／1.5x／2x，選倍率後直接拖曳畫面調整聚焦中心（錄影時不便靠近，後製拉近）
- 一鍵色彩預設「明亮微暖」：`brightness(1.07) saturate(1.08) sepia(0.12)`，可開關，無細部調整
- 姓名模糊框：手動框選＋關鍵影格追蹤（不同時間點拖框＝自動記錄追蹤點，線性內插）；「從此刻開始／到此刻結束」設定生效區間；「🔍放大」以框為中心放大 2.2 倍微調（可拖空白處移動視野）；◀▲▼▶＋－按鈕微調（一列排列）；輸出時模糊區自動外擴 12% 容錯

**步驟2 標題**
- 活動分類四預設（可於設定管理）：親子烘焙／小廚師烘焙夏令營／小廚師烘焙寒令營／生日包場烘焙派對
- 分類標語（藍綠色藥丸小框文字）：每分類有預設清單可勾選＋自由編輯；夏令營固定「小廚師烘焙手作夏令營」、寒令營固定「小廚師烘焙手作寒令營」；親子烘焙與包場派對各 5 句活潑標語（**尚未定案**，候選 10 選 5 見 §7，暫用前 5）
- 活動內容：手動輸入，記憶最近 3 組
- 主標題（橘框）：1–2 行，可含 emoji；預設自動帶入活動內容，手動改過即不再覆蓋；記憶最近 3 組
- 位置三選一固定中心點：上 1/3（y=20%）、置中（50%）、下 1/3（78%），即時預覽，貫穿全片

**步驟3 輸出**
- 檔名：`{分類}+{內容}_{YYYYMMDD}_{NN}_{原始|後製}.mp4`；日期預設影片檔案日期可改；流水號同分類+內容+日期自動遞增（本機記憶），可手動改
- 輸出 1080×1920、30fps、H.264 High `avc1.640028` 8Mbps＋AAC 128k、fastStart
- 完成卡：「⬇ 下載影片到手機」按鈕（**必須使用者親手點擊**，見 §5-1）、文案框（標題＋標語＋hashtag，`{活動名稱}` 代入活動內容）＋複製鈕、「分享影片」Web Share（可直接分享到 FB/IG App）、開啟 FB／IG／Google 相簿／Drive 資料夾連結、「做下一支影片」

### 3.2 標題視覺樣式（輸出與預覽共用同一 canvas 繪製函式）

- 橘框：`rgba(238,143,48,0.80)`、圓角 18px（1080 寬基準）、白字 `900 Noto Sans TC` 66px 起自動縮字、行高 1.38、置中、微陰影；文字下方向下延伸（＋標語高的 50%＋8px），讓文字與標語有舒適間隔
- 標語藥丸框：`rgba(106,178,188,0.92)`、兩端 100% 圓弧、白字 46px 起（最長句一行內自動縮字）、**上緣疊放 50% 在橘框下緣上**
- Logo：內嵌右下角，寬 19%，位置＝貼角基準（右 1.5%、下 1.2%）再向左向上各縮 logo 尺寸的 50%；設定頁可換圖

### 3.3 凍結版面（手機直式）

上半部固定不捲動：標題列 → ［步驟籤直列｜影片預覽（右上，高 31vh）］ → 時間軸（縮圖 28px＋片段色帶＋播放軸）→ 一列四鈕［↻更換(9:16最佳)｜秒數｜▶播放｜▶預覽］。下半部操作區獨立捲動。任何步驟都能按播放/預覽（輸出中鎖住）。

### 3.4 本機記憶 keys（localStorage，try/catch 包裝，失敗退記憶體）

`mp_cats`、`mp_pills`（各分類標語清單）、`mp_recentContents`、`mp_recentTitles`、`mp_tags`、`mp_logo`、`mp_serial`、`mp_drive`

## 4. 技術架構（已實作並驗證）

- 影片管線：主預覽 `<video>` 逐格 seek → Canvas 合成（聚焦裁切 drawImage 來源窗 → 調色 ctx.filter → 模糊區「縮小6倍再放大＋blur(4px)」→ 標題 canvas → logo）→ `VideoFrame` → WebCodecs `VideoEncoder` → mp4-muxer
- 時間映射：各段輸出長度 `(out-in)/speed` 累加成 plan；`tOut→(段,tSrc)` 查表，影像/音訊共用
- 音訊：整檔 `decodeAudioData` → 依映射線性重取樣（加速段音調變高，Reels 常態）→ `AudioEncoder`（`mp4a.40.2`，不支援時退 `opus`）
- 編碼背壓：`encodeQueueSize>6` 暫停 30ms；keyframe 每 90 格
- 聚焦輸出：來源窗 `winX=(cx-0.5/s)` 等；模糊座標同步轉換 `((r.x-winX)*s)` 並裁邊
- 測試掛勾：`window.__test`（loadVideo/exportVideo/renderTitleCanvas/S/store）

## 5. 已踩過的坑與修復（開發時務必保留這些行為）

1. **自動下載會被 Chrome 擋**：影片輸出完成後由程式自動 `a.click()` 下載，非使用者手勢觸發，Android Chrome 會顯示訊息但實際不存檔。→ 已改成完成後出現「下載影片」按鈕，由使用者點擊觸發。
2. **`el.style.display=''` 蓋不掉 CSS 規則**：完成卡 `#doneCard{display:none}` 是 CSS 規則，設 `''` 會回落到 none，導致成功畫面從未顯示。→ 用 `display='block'`。
3. **`transform-origin` 預設是中心**：縮放平移公式假設原點在左上，未設 `transform-origin:0 0` 時所有平移偏向中央（「放大只看得到正中央」的原因）。
4. **seek 到相同 currentTime 不觸發 `seeked`**：逐格 seek 迴圈必加「目標時間相同直接 resolve」防呆＋2 秒 timeout，否則卡死。
5. **輸出時不可另建 `<video>` 元件**：從檔案 App（content:// 頁面）開啟時，detached video 載入 blob 會失敗（「影片載入失敗」）。→ 直接重用畫面上已載入的預覽 video 元件抽格。
6. **WebCodecs 只在 secure context 存在**：https／file:///content:// 可用；測試時 `about:blank` 下 `VideoEncoder` 不存在。
7. **content:// 開啟＝獨立臨時來源**：localStorage 不可用或不持久，記憶功能失效 → 靠 store 的 try/catch 退記憶體不會壞，但重開即忘。**正式解法＝上線到固定網址**（第二階段）。
8. 開源 Chromium（Playwright 附的）無 H.264/AAC：測試用 VP9/Opus webm 素材，程式已有 codec fallback 偵測；手機正式版 Chrome 完整支援。

## 6. 測試方式

Windows 開發機（2026-09-10 起）：Node 24、ffmpeg 8.1、本機 Google Chrome。

```bash
npm install     # 只裝 playwright 套件；測試用本機 Chrome（channel:'chrome'），不需下載測試瀏覽器
npm test        # build → e2e；素材預設取 _原始素材/ 第一支，或 node e2e.js <影片路徑>
```

本機 Chrome 有 H.264/AAC，可直接用手機原始 mp4 測試（不必再轉 webm）。驗證項目：H.264、1080×1920、30fps、AAC、時長=Σ(out-in)/speed。輸出與抽格圖在 `test-output/`（不進 git），抽格用來目視檢查標題樣式、模糊位置、logo 位置。

e2e 涵蓋：兩段跳選＋2x＋聚焦 1.5x＋移動模糊框＋新標題樣式＋音訊。

（mp4-muxer、esbuild 只在要重新產生 `mp4muxer.min.js` 時才需要。）

## 7. 待辦與未定案

**立即（第一階段收尾）**
- [ ] 最新版在真機完整驗證（下載按鈕、Web Share 分享到 FB/IG、H.264 輸出品質）
- [ ] 分類標語 10 選 5 定案後更新 `DEFAULT_PILLS`（候選清單見對話記錄；親子烘焙第 1 句與包場第 1 句「賓主盡歡的歡樂派對」已確定要）
- [ ] **上線到固定網址**（GitHub Pages / Cloudflare Pages 免費即可）：解決三件事——更新不用傳檔、localStorage 正常保存、可「加入主畫面」像 App。這是目前所有檔案傳輸痛點的根治方案，建議最優先。

**第二階段**
- [ ] Google Drive OAuth：原始檔上傳「原始側錄」資料夾、成品上傳「完成影片」資料夾；流水號改查 Drive 實際檔案
- [ ] Meta Graph API：粉專＋IG Reels 自動發布（需可公開存取的影片 URL，Drive 直鏈可用；需引導使用者建 Meta 開發者 App、取粉專權杖，約 20–30 分鐘一次性設定）
- [ ] 完成畫面「開啟 Google 相簿」引導刪除原始檔（網頁無法代刪，系統限制）

**第三階段**
- [ ] 語音辨識字幕（Whisper），手寫風字幕樣式（參考範例影片「我們要趕進度了😳」）；錄音可用率低，優先度最低

## 8. 資產與參考

- 範例影片＋logo：使用者電腦 `D:\claud_project\媽媽play活動側錄量產影片剪輯`（6 支成品範例 1080×1920/30fps＋`媽媽playLOGO.png`）
- 成品樣式參考：範例影片內的橘框標題、右下 logo 浮水印
- Hashtag 模板：`#{活動名稱} #媽媽Play #台北親子烘焙 #3歲至15歲親子協作或8歲以上獨立製作 #專業親子烘焙老師帶領 #輕鬆逐步完成`

## 9. 給 Claude Code 的起手建議

1. 解壓 zip，`node build.js` 重現單檔成品，先跑 `node e2e.js` 確認環境
2. 第一件事做「上線到固定網址」（§7），之後所有迭代直接推上去，不再有檔案傳輸問題
3. 保留 §5 的所有防呆行為；改動標題/模糊/聚焦邏輯時，用 `window.__test` 掛勾寫回歸測試
