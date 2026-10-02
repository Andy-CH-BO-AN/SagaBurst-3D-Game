# HTML 報告格式

架構審查報告以單一 HTML 檔案呈現，放在作業系統的暫存目錄。Tailwind 與 Mermaid 都從 CDN 載入。Mermaid 適合可靠地呈現圖狀關係；自行製作的 div 與行內 SVG 則適合更有編排感的視覺呈現（量體圖、剖面圖）。兩者搭配使用；不要所有圖都依賴 Mermaid，否則容易流於制式。

## 範本

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <title>{{專案名稱}}的架構審查</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      /* 補上 Tailwind 不容易直接表達的少量樣式：
         接縫虛線、帶有手繪感的箭頭等。 */
      body { margin: 0; color: #1e293b; background: #fafaf9; font-family: system-ui, sans-serif; }
      main { max-width: 64rem; margin: auto; padding: 3rem 1.5rem; }
      body h1 { font-size: 2.5rem; line-height: 1.25; }
      body h2 { font-size: 1.5rem; line-height: 1.4; }
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## 頁首

列出專案名稱、日期及精簡圖例：實線方框代表模組，虛線代表接縫，紅色箭頭代表洩漏，粗框深色方塊代表深層模組。不要寫開場段落，直接進入候選項目。

## 候選項目卡片

讓圖承擔主要說明。文字要少、平易，直接使用 [`codebase-design` 技能](../codebase-design/SKILL.md)的詞彙。

每個候選項目使用一個 `<article>`：

- **標題**：簡短，點出如何深化，例如「整併訂單受理流程」。
- **徽章列**：推薦程度（「強烈推薦」用翠綠色、「值得探索」用琥珀色、「推測性」用灰藍色），加上依賴類別標籤（「行程內」、「可在本機替代」、「埠與轉接器」、「模擬」）。
- **檔案**：用等寬字體列出，套用 `font-mono text-sm`。
- **修改前／修改後圖**：卡片的主角，分成兩欄並排。見下方圖形模式。
- **問題**：一句話，說明痛點。
- **解法**：一句話，說明改變。
- **收益**：條列，每項不超過六個詞，中文也保持同樣精簡。例如「測試集中在同一介面」、「定價邏輯不再洩漏」、「刪除四個淺層封裝」。
- **ADR 提示**（適用時）：以琥珀色底框呈現一行說明。

不要加入大段解釋。如果一張圖需要一整段文字才能看懂，就重畫。

## 圖形模式

選用適合候選項目的模式，搭配不同模式，不要讓每張圖看起來都一樣。視覺變化也是這份報告的目的之一。

### Mermaid 關係圖（依賴關係與呼叫流程的主力）

當重點是「X 呼叫 Y，Y 再呼叫 Z，看看這有多混亂」時，使用 Mermaid 的 `flowchart` 或 `graph`。將圖放進有 Tailwind 樣式的卡片，讓它融入版面。使用 `classDef` 把洩漏標成紅色，把深層模組標成深色。時序圖則適合呈現「修改前來回六次，修改後一次」。

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[訂單處理] --> B[訂單驗證]
      B --> C[訂單儲存]
      C -.洩漏.-> D[定價端]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### 手工方框與箭頭（Mermaid 排版不合需求時）

用有邊框與標籤的 `<div>` 表示模組。箭頭使用行內 SVG 的 `<line>` 或 `<path>`，以絕對定位放在相對定位的容器上。若希望「修改後」呈現為粗框的深層模組，內部細節則淡化成灰色，適合採用此模式；Mermaid 不容易表達這種視覺分量。

### 剖面圖（適合呈現層層堆疊的淺層模組）

堆疊橫條（`h-12 border-l-4`），顯示一次呼叫經過的層次。修改前是六個幾乎不做事的薄層；修改後是一個厚實區塊，標明整併後的職責。

### 量體圖（適合呈現介面與實作一樣寬的情況）

每個模組用兩個矩形表示：一個代表介面面積，一個代表實作。修改前，介面矩形幾乎與實作矩形同高，表示淺層；修改後，介面矩形變矮，實作矩形較高，表示深層。

### 呼叫圖收合

修改前，以巢狀方框呈現函式呼叫樹。修改後，將同一棵樹收合到一個方框內，把如今變成內部細節的呼叫淡化顯示。

## 樣式指引

- 偏向編輯排版風格，保留充足留白。標題可用襯線字體；`font-serif` 搭配石色與灰藍色很合適。
- 節制使用顏色：一種重點色（翠綠或靛藍），加上表示洩漏的紅色與表示警示的琥珀色。
- 圖形高度約 320px，讓修改前後的圖能舒服地並排，不需要捲動。
- 圖中的模組標籤使用 `text-xs uppercase tracking-wider`，呈現示意圖的感覺。
- 唯一的腳本是 Tailwind CDN 與 Mermaid 的 ESM 匯入。報告其餘部分維持靜態，不加入應用程式邏輯，也不加入 Mermaid 本身渲染以外的互動。

## 首選建議

使用一張較大的卡片，放候選項目名稱、一句選它的原因，以及連到該卡片的頁內連結。只需要這些。

## 語氣

使用平易、精簡的中文；架構相關的名詞與動詞直接採用 `codebase-design` 技能的用語。精簡不代表可以任意更換術語。

**必須精確使用：** 模組、介面、實作、深度、深層、淺層、接縫、轉接器、槓桿效益、局部性。

**不要替換成：** 元件、服務、單元（指模組時）；API、簽章（指介面時）；邊界（指接縫時）；層、封裝（實際指模組時）。

**符合風格的措辭：**

- 「訂單受理模組是淺層的：介面複雜度幾乎等同實作。」
- 「定價邏輯跨越接縫洩漏。」
- 「深化：一個介面，一個測試位置。」
- 「兩個轉接器讓接縫有存在的理由：正式環境用 HTTP，測試用記憶體實作。」

**收益條列**要用詞彙表中的術語點出收穫，例如「局部性：錯誤集中在同一模組」、「槓桿效益：一個介面支援 N 個呼叫點」、「介面縮小，實作吸收封裝」。不要寫「更容易維護」或「程式碼更乾淨」；這些說法不在詞彙表內，也沒有具體說明價值。

不要含糊保留、冗長鋪陳，或寫「值得注意的是……」。能改成條列的句子，就改成條列；能刪的條列，就刪。如果某個術語不在 `codebase-design` 的詞彙表中，先找現有詞彙，再考慮創造新詞。

## 交付檢查

Tailwind CDN 會注入 reset；自訂標題樣式須使用足夠 specificity（例如 `body h1`），避免載入後被重設成內文字級。檢查 Mermaid 已產生 SVG、卡片數符合內容、桌面／窄視窗無水平溢位。若 CLI 不允許 `file:` URL，可暫用僅綁定 localhost、只供應報告的 HTTP server，驗證後關閉該 server 與本次 QA session；報告仍保留在暫存目錄，不搬進遊戲 repo。
