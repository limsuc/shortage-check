const DEFAULT_STOCKOUT_ITEMS = window.DEFAULT_STOCKOUT_ITEMS || [
  { maker: "동아에스티", productName: "아로틴정 10mg", expectedDate: "6월 30일" },
  { maker: "동아에스티", productName: "아로틴정 20mg", expectedDate: "7월 3일" },
  { maker: "대웅제약", productName: "아모렉스정 625mg", expectedDate: "7월 8일" },
  { maker: "서원파마", productName: "듀얼살탄정 40/5mg", expectedDate: "출하예정 미정" },
  { maker: "대원제약", productName: "브로나제장용정", expectedDate: "6월 8일" },
  { maker: "유한양행", productName: "페북트정40mg", expectedDate: "6월 5일" },
  { maker: "한독", productName: "클래리드정500mg", expectedDate: "6월 12일" },
];

const SAMPLE_CLIENT_ITEMS = [
  { clientName: "참사랑약품", phone: "010-0000-0000", contactName: "김대표", hospital: "맑은샘내과의원", productName: "아로틴정 10mg" },
  { clientName: "참사랑약품", phone: "010-0000-0000", contactName: "김대표", hospital: "맑은샘내과의원", productName: "아로틴정 20mg" },
  { clientName: "참사랑약품", phone: "", contactName: "", hospital: "맑은샘내과의원", productName: "아모렉스정 625mg" },
  { clientName: "참사랑약품", phone: "", contactName: "", hospital: "맑은샘내과의원", productName: "듀얼살탄정 40/5mg" },
  { clientName: "서울메디컬", phone: "010-1111-2222", contactName: "박대표", hospital: "우리내과", productName: "브로나제장용정" },
  { clientName: "서울메디컬", phone: "010-1111-2222", contactName: "박대표", hospital: "강남소아과", productName: "페북트정40mg" },
];

const state = {
  clients: [],
  stockouts: [],
  results: [],
  checked: false,
  filter: "all",
};

const $ = (selector) => document.querySelector(selector);

function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeProduct(value) {
  return clean(value).normalize("NFKC").toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
}

function productStem(value) {
  return clean(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*\s*(?:MG|ML|G|MCG|UG|IU|%|정|캡슐|T|C|B|관|병|포)?/g, "")
    .replace(/(?:PTP|일반|다회용|일회용|신형|구형|서방|장용)/g, "")
    .replace(/[^A-Z가-힣]/g, "");
}

function extractStrengthTokens(value) {
  const text = clean(value).normalize("NFKC").toUpperCase();
  const tokens = [];
  const strengthRe = /(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)\s*(MG|ML|G|MCG|UG|IU|%|정|캡슐|T|C|B|관|병|포)?/g;
  let match;
  while ((match = strengthRe.exec(text))) {
    const number = match[1];
    const unit = match[2] || "";
    tokens.push(unit ? `${number}${unit}` : number);
  }
  return [...new Set(tokens)];
}

function strengthsCompatible(clientProduct, stockoutProduct) {
  const clientTokens = extractStrengthTokens(clientProduct);
  if (!clientTokens.length) return true;
  const stockoutTokens = extractStrengthTokens(stockoutProduct);
  if (!stockoutTokens.length) return false;
  return clientTokens.every((token) => stockoutTokens.includes(token));
}

function isProductMatch(clientProduct, stockoutProduct) {
  const clientFull = normalizeProduct(clientProduct);
  const stockoutFull = normalizeProduct(stockoutProduct);
  const clientStem = productStem(clientProduct);
  const stockoutStem = productStem(stockoutProduct);

  if (clientFull.length >= 4 && stockoutFull.includes(clientFull)) return true;
  if (stockoutFull.length >= 4 && clientFull.includes(stockoutFull) && clientStem === stockoutStem && strengthsCompatible(clientProduct, stockoutProduct)) return true;
  return clientStem.length >= 4 && stockoutStem.includes(clientStem) && strengthsCompatible(clientProduct, stockoutProduct);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(clean(cell));
      cell = "";
    } else if (char === "\n") {
      row.push(clean(cell));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(clean(cell));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerIndex(headers, names) {
  const normalized = headers.map((header) => clean(header));
  return names.map((name) => normalized.indexOf(name)).find((index) => index >= 0) ?? -1;
}

function parseClientRows(rows) {
  const headers = rows[0] || [];
  const clientIndex = headerIndex(headers, ["사업자명", "거래처명", "업체명"]);
  const phoneIndex = headerIndex(headers, ["연락처", "핸드폰", "휴대폰", "전화번호"]);
  const contactIndex = headerIndex(headers, ["담당자명", "담당자"]);
  const hospitalIndex = headerIndex(headers, ["병의원명", "병원명", "요양기관명"]);
  const productIndex = headerIndex(headers, ["제품명", "품목", "품목명"]);

  if (clientIndex < 0 || hospitalIndex < 0 || productIndex < 0) {
    throw new Error("거래처 마스터에는 사업자명, 병의원명, 제품명 컬럼이 필요합니다.");
  }

  const seen = new Set();
  return rows
    .slice(1)
    .map((row) => ({
      clientName: clean(row[clientIndex]),
      phone: phoneIndex >= 0 ? clean(row[phoneIndex]) : "",
      contactName: contactIndex >= 0 ? clean(row[contactIndex]) : "",
      hospital: clean(row[hospitalIndex]),
      productName: clean(row[productIndex]),
    }))
    .filter((item) => item.clientName && item.hospital && item.productName)
    .filter((item) => {
      const key = [item.clientName, item.hospital, item.productName].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseStockoutRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0] || [];
  const makerIndex = headerIndex(headers, ["제약사", "제약사명", "회사명", "업체명"]);
  const productIndex = headerIndex(headers, ["품절 공지", "품절품목", "제품명", "품목명", "품목"]);
  const dateIndex = headerIndex(headers, ["출하예정", "출하예정일", "입고예정일", "예정일"]);

  const bodyRows = productIndex >= 0 ? rows.slice(1) : rows;
  return bodyRows
    .map((row) => ({
      maker: makerIndex >= 0 ? clean(row[makerIndex]) : clean(row[0]),
      productName: productIndex >= 0 ? clean(row[productIndex]) : clean(row[makerIndex >= 0 ? 1 : 0]),
      expectedDate: dateIndex >= 0 ? clean(row[dateIndex]) : clean(row[makerIndex >= 0 ? 2 : 1]) || "-",
    }))
    .filter((item) => item.productName);
}

async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  return new TextDecoder("utf-8").decode(buffer);
}

async function parseClientFile(file) {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".csv")) {
    throw new Error("현재 미리보기에서는 CSV 마스터 파일을 먼저 지원합니다. 예시 양식을 CSV로 저장해서 업로드해 주세요.");
  }
  const rows = parseCsv(await readFileText(file));
  const clients = parseClientRows(rows);
  if (!clients.length) throw new Error("거래처 마스터에서 유효한 데이터를 찾지 못했습니다.");
  return clients;
}

async function parseStockoutFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return parsePdfStockouts(file);
  if (!lower.endsWith(".csv") && !lower.endsWith(".txt")) {
    throw new Error("품절목록은 PDF, CSV, TXT 파일을 지원합니다.");
  }
  const rows = parseCsv(await readFileText(file));
  const stockouts = parseStockoutRows(rows);
  if (!stockouts.length) throw new Error("품절목록에서 유효한 품목을 찾지 못했습니다.");
  return stockouts;
}

async function parsePdfStockouts(file) {
  if (!window.StockoutPdfParser) throw new Error("PDF 품절목록 분석기를 불러오지 못했습니다.");

  const pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs";

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pageFragments = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const text = await page.getTextContent();
    pageFragments.push(
      text.items.map((item) => ({
        text: clean(item.str),
        x: item.transform[4],
        y: item.transform[5],
      })),
    );
  }

  const parsed = window.StockoutPdfParser.parsePages(pageFragments);
  const stockouts = parsed.items
    .map((item) => ({
      maker: clean(item.company),
      productName: clean(item.productName),
      expectedDate: clean(item.expectedDate) || "-",
    }))
    .filter((item) => item.productName);

  if (!stockouts.length) throw new Error("PDF에서 품절 품목을 찾지 못했습니다.");
  return stockouts;
}

function parseManualStockouts(text) {
  return text
    .split(/\r?\n/)
    .map((line) => clean(line))
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map(clean);
      if (parts.length >= 3) return { maker: parts[0], productName: parts[1], expectedDate: parts[2] || "-" };
      return { maker: "", productName: parts[0], expectedDate: parts[1] || "-" };
    })
    .filter((item) => item.productName);
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

function findMatches() {
  const matches = [];
  for (const client of state.clients) {
    const stockout = state.stockouts.find((item) => isProductMatch(client.productName, item.productName));
    if (stockout) matches.push({ client, stockout });
  }
  return matches;
}

function runMatch() {
  if (!state.clients.length) {
    alert("거래처 마스터 파일을 먼저 업로드해 주세요.");
    return;
  }
  if (!state.stockouts.length) {
    alert("품절목록을 불러오거나 직접 입력해 주세요.");
    return;
  }

  const grouped = new Map();
  for (const match of findMatches()) {
    const key = match.client.clientName;
    if (!grouped.has(key)) {
      grouped.set(key, {
        clientName: match.client.clientName,
        phone: match.client.phone,
        contactName: match.client.contactName,
        items: [],
      });
    }
    grouped.get(key).items.push({
      hospital: match.client.hospital,
      registeredProduct: match.client.productName,
      maker: match.stockout.maker || "-",
      noticeProduct: match.stockout.productName,
      expectedDate: match.stockout.expectedDate || "-",
    });
  }

  state.results = [...grouped.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "ko"));
  state.checked = true;
  state.filter = "all";
  render();
}

function rowsFromCard(card) {
  return [...card.querySelectorAll("tbody tr")].map((row) => {
    const [hospital, registeredProduct, maker, noticeProduct, expectedDate] = [...row.children].map((cell) => cell.textContent.trim());
    return { hospital, registeredProduct, maker, noticeProduct, expectedDate };
  });
}

function messageFromCard(card) {
  const clientName = card.querySelector("h3").textContent.trim();
  const rows = rowsFromCard(card);
  const lines = [
    `[${clientName} 품절 확인]`,
    `품절 영향 품목: 총 ${rows.length}건`,
    "",
  ];

  rows.forEach((row, index) => {
    lines.push(`${index + 1}. ${row.hospital}`);
    lines.push(`- 제약사: ${row.maker}`);
    lines.push(`- 등록 제품: ${row.registeredProduct}`);
    lines.push(`- 품절 제품: ${row.noticeProduct}`);
    lines.push(`- 출하 예정: ${row.expectedDate}`);
    if (index < rows.length - 1) lines.push("");
  });

  return lines.join("\n");
}

function allResultRows() {
  return state.results.flatMap((result) => result.items.map((row) => ({ clientName: result.clientName, ...row })));
}

function escapeCell(value) {
  return escapeHtml(value);
}

function stockoutExcelHtml(rows) {
  const tableRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeCell(row.clientName)}</td>
          <td>${escapeCell(row.hospital)}</td>
          <td>${escapeCell(row.registeredProduct)}</td>
          <td>${escapeCell(row.maker)}</td>
          <td>${escapeCell(row.noticeProduct)}</td>
          <td>${escapeCell(row.expectedDate)}</td>
        </tr>`,
    )
    .join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          table { border-collapse: collapse; font-family: Malgun Gothic, Arial, sans-serif; }
          th, td { border: 1px solid #d9e2ec; padding: 8px 10px; mso-number-format:"\\@"; }
          th { background: #eff6ff; color: #0f172a; font-weight: 700; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              <th>거래처</th>
              <th>병의원</th>
              <th>등록 제품</th>
              <th>제약사</th>
              <th>품절 공지</th>
              <th>출하예정</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>`;
}

function wrapCanvasText(context, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(" ");
  let line = "";
  let currentY = y;

  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (context.measureText(nextLine).width > maxWidth && line) {
      context.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = nextLine;
    }
  }
  context.fillText(line, x, currentY);
  return currentY + lineHeight;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

async function imageBlobFromCard(card) {
  const clientName = card.querySelector("h3").textContent.trim();
  const rows = rowsFromCard(card);
  const width = 900;
  const rowHeight = 132;
  const height = 180 + rows.length * rowHeight + 42;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  roundedRect(context, 28, 28, width - 56, height - 56, 22);
  context.fill();
  context.strokeStyle = "#e2e8f0";
  context.lineWidth = 2;
  context.stroke();

  context.fillStyle = "#2563eb";
  context.font = "700 22px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
  context.fillText("거래처품절확인", 58, 76);
  context.fillStyle = "#0f172a";
  context.font = "800 34px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
  context.fillText(`${clientName} 품절 영향 내역`, 58, 124);
  context.fillStyle = "#64748b";
  context.font = "400 18px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
  context.fillText(`총 ${rows.length}건 · 제약사와 출하예정일을 함께 확인하세요.`, 58, 158);

  let y = 194;
  rows.forEach((row, index) => {
    context.fillStyle = index % 2 === 0 ? "#ffffff" : "#f8fafc";
    roundedRect(context, 58, y, width - 116, rowHeight - 18, 16);
    context.fill();
    context.strokeStyle = "#e2e8f0";
    context.stroke();

    context.fillStyle = "#2563eb";
    context.font = "800 18px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
    context.fillText(`${index + 1}. ${row.hospital}`, 82, y + 34);
    context.fillStyle = "#0f172a";
    context.font = "700 20px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
    wrapCanvasText(context, `${row.maker} · ${row.noticeProduct}`, 82, y + 66, width - 260, 26);
    context.fillStyle = "#64748b";
    context.font = "400 16px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
    context.fillText(`등록 제품: ${row.registeredProduct}`, 82, y + 100);
    context.fillStyle = "#d97706";
    context.font = "800 18px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
    context.fillText(`출하예정 ${row.expectedDate}`, width - 220, y + 66);
    y += rowHeight;
  });

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyCardImage(card) {
  const blob = await imageBlobFromCard(card);
  const clientName = card.querySelector("h3").textContent.trim();
  if (!blob) throw new Error("이미지 생성에 실패했습니다.");

  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      downloadBlob(blob, `${clientName}_품절내용.png`);
      return "downloaded";
    }
  }

  downloadBlob(blob, `${clientName}_품절내용.png`);
  return "downloaded";
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-999px";
    textarea.style.left = "-999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("브라우저에서 클립보드 복사를 허용하지 않았습니다.");
    return true;
  }
}

function flashButton(button, text, originalText) {
  button.textContent = text;
  setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
  }, 1300);
}

function filteredResults() {
  if (state.filter === "multi") return state.results.filter((result) => result.items.length >= 2);
  if (state.filter === "single") return state.results.filter((result) => result.items.length === 1);
  if (state.filter === "unknown") return state.results.filter((result) => result.items.some((item) => item.expectedDate.includes("미정")));
  return state.results;
}

function renderResultCard(result) {
  const badgeClass = result.items.length >= 2 ? "priority high" : "priority";
  const hospitals = [...new Set(result.items.map((item) => item.hospital))];
  const subtitle = hospitals.length > 1 ? `${hospitals[0]} 외 ${hospitals.length - 1}곳 · ${result.items.length}개 품목` : `${hospitals[0]} · ${result.items.length}개 품목`;
  const rows = result.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.hospital)}</td>
          <td>${escapeHtml(item.registeredProduct)}</td>
          <td>${escapeHtml(item.maker)}</td>
          <td>${escapeHtml(item.noticeProduct)}</td>
          <td>${escapeHtml(item.expectedDate)}</td>
        </tr>`,
    )
    .join("");

  return `
    <article class="client-card">
      <div class="client-head">
        <div>
          <h3>${escapeHtml(result.clientName)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <span class="${badgeClass}">영향 품목 ${result.items.length}건</span>
      </div>
      <div class="table-scroll" tabindex="0" aria-label="${escapeHtml(result.clientName)} 품절 내역">
        <table>
          <thead>
            <tr>
              <th>병의원</th>
              <th>등록 제품</th>
              <th>제약사</th>
              <th>품절 공지</th>
              <th>출하예정</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="delivery-actions">
        <button class="ghost-button text-copy-button" type="button">TEXT 메세지 복사</button>
        <button class="primary-button image-copy-button" type="button">품절내용 이미지 복사</button>
      </div>
    </article>`;
}

function render() {
  const hasClients = state.clients.length > 0;
  const hasNotice = state.stockouts.length > 0;
  const visibleResults = filteredResults();
  const matchCount = state.results.reduce((sum, result) => sum + result.items.length, 0);

  $("#clientStep").classList.toggle("is-ready", hasClients);
  $("#noticeStep").classList.toggle("is-ready", hasNotice);
  $("#clientCount").textContent = uniqueCount(state.clients.map((item) => item.clientName));
  $("#noticeCount").textContent = state.stockouts.length;
  $("#affectedCount").textContent = state.checked ? state.results.length : "0";
  $("#readyBadge").textContent = hasClients && hasNotice ? "확인 가능" : "대기중";
  $("#readyBadge").classList.toggle("ready", hasClients && hasNotice);
  $("#checkButton").disabled = !(hasClients && hasNotice);
  $("#copyButton").disabled = !state.checked || !state.results.length;
  $("#exportButton").disabled = !state.checked || !state.results.length;
  $("#emptyState").classList.toggle("hidden", state.checked);
  $("#resultContent").classList.toggle("hidden", !state.checked);

  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });

  if (!state.checked) return;

  $("#clientList").innerHTML = visibleResults.length
    ? visibleResults.map(renderResultCard).join("")
    : `<div class="empty-state compact-empty"><strong>조건에 맞는 결과가 없습니다.</strong><span>다른 필터를 선택해 주세요.</span></div>`;

  if (!state.results.length) {
    $("#clientList").innerHTML = `<div class="empty-state compact-empty"><strong>매칭된 품절품목이 없습니다.</strong><span>거래처 마스터와 품절목록의 제품명을 확인해 주세요.</span></div>`;
  }
}

function downloadTemplate() {
  const csv = [
    "사업자명,연락처,담당자명,병의원명,제품명",
    "참사랑약품,010-0000-0000,김대표,맑은샘내과의원,아로틴정 10mg",
    "참사랑약품,010-0000-0000,김대표,맑은샘내과의원,아로틴정 20mg",
  ].join("\n");
  downloadBlob(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }), "거래처마스터_양식.csv");
}

$("#clientFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    state.clients = await parseClientFile(file);
    state.checked = false;
    render();
  } catch (error) {
    alert(error.message);
  }
});

$("#sampleClientButton").addEventListener("click", () => {
  state.clients = [...SAMPLE_CLIENT_ITEMS];
  state.checked = false;
  render();
});

$("#downloadTemplateButton").addEventListener("click", downloadTemplate);

$("#noticeFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    state.stockouts = await parseStockoutFile(file);
    state.checked = false;
    render();
  } catch (error) {
    alert(error.message);
  }
});

$("#loadDefaultButton").addEventListener("click", () => {
  state.stockouts = [...DEFAULT_STOCKOUT_ITEMS];
  state.checked = false;
  render();
});

$("#manualNotice").addEventListener("input", (event) => {
  const items = parseManualStockouts(event.target.value);
  if (items.length) {
    state.stockouts = items;
    state.checked = false;
    render();
  }
});

$("#checkButton").addEventListener("click", runMatch);

document.querySelectorAll(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter || "all";
    render();
  });
});

$("#copyButton").addEventListener("click", async () => {
  const lines = [
    "거래처품절확인 결과",
    `영향 거래처: ${state.results.length}곳`,
    `품절 영향 품목: ${state.results.reduce((sum, result) => sum + result.items.length, 0)}건`,
    "",
    ...state.results.map((result) => `${result.clientName}: ${result.items.map((item) => `${item.maker} ${item.noticeProduct}`).join(", ")}`),
  ];
  await copyText(lines.join("\n"));
  flashButton($("#copyButton"), "복사완료", "요약 복사");
});

$("#exportButton").addEventListener("click", () => {
  const rows = allResultRows();
  const blob = new Blob([stockoutExcelHtml(rows)], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, "거래처품절확인_품절목록.xls");
});

$("#resultContent").addEventListener("click", async (event) => {
  const textButton = event.target.closest(".text-copy-button");
  const imageButton = event.target.closest(".image-copy-button");
  if (!textButton && !imageButton) return;

  const card = event.target.closest(".client-card");
  if (!card) return;

  if (textButton) {
    textButton.disabled = true;
    try {
      await copyText(messageFromCard(card));
      flashButton(textButton, "TEXT 복사완료", "TEXT 메세지 복사");
    } catch (error) {
      alert(`TEXT 복사 실패: ${error.message}`);
      textButton.disabled = false;
    }
  }

  if (imageButton) {
    imageButton.disabled = true;
    try {
      const action = await copyCardImage(card);
      flashButton(imageButton, action === "copied" ? "이미지 복사완료" : "PNG 저장완료", "품절내용 이미지 복사");
    } catch (error) {
      alert(`이미지 복사 실패: ${error.message}`);
      imageButton.disabled = false;
    }
  }
});

render();
