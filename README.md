# BFF 實作課：教學網站

GitHub Pages 靜態網站，放學員看的操作說明。網址：<https://tamaazhang.github.io/bff-ecp-course/>

| 檔案 | 內容 |
|---|---|
| `index.html` | 首頁：三個階段 |
| `stage1.html` | 階段一：Sheet 版（準備 A～D、查詢、新增修改刪除、自我練習） |
| `stage2.html` | 階段二：建立 ECP 單元 |
| `stage3.html` | 階段三：改接 ECP（準備中） |

## 怎麼改

`stage*.html` 是產生出來的，**不要直接改**：

1. 改 `src/stage*.html`（每個 `<section>` 是一個步驟，`data-min` 是預計分鐘數）。共用的版面、樣式、程式在 `src/layout.html`（樣式參考 Google Codelabs：左右方向鍵換頁、切頁滑動）。
2. 執行 `node build.mjs`。
3. commit、push，大約 1 分鐘後網站更新。

這個 repo 是**公開**的：不要放密碼、通行碼、ECP 安裝檔或授權。
