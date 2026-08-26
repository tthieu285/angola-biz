/* ============================================================================
   Angola Market Entry · Financial Model — B2C Dropship (Year 1)
   Rendering + interaction. Uses state/calcModel from script.js.
   Nội bộ mọi tính toán luôn bằng USD — currentCurrency chỉ đổi cách HIỂN THỊ
   (formatMoney), không đụng vào state hay calcModel.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   Format helpers
   --------------------------------------------------------------------------- */
function fmtNum(v, decimals) {
  decimals = decimals === undefined ? 0 : decimals;
  return (v || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPctNum(v, decimals) {
  decimals = decimals === undefined ? 1 : decimals;
  return (v * 100).toFixed(decimals) + "%";
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}
function roundForInput(v) {
  return Math.round(v * 10000) / 10000;
}

/* Currency conversion (display layer only — internal calc engine is always USD) */
function convertFromUsd(vUsd, currency) {
  if (currency === "vnd") return vUsd * Number(state.fx.usdToVnd || 0);
  if (currency === "aoa") return vUsd * Number(state.fx.usdToAoa || 0);
  return vUsd;
}
function currencySuffix(currency) {
  if (currency === "vnd") return "₫";
  if (currency === "aoa") return "Kz";
  return "";
}
function formatMoney(vUsd, decimals) {
  const currency = currentCurrency;
  const v = convertFromUsd(vUsd || 0, currency);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (currency === "usd") {
    const d = decimals === undefined ? 0 : decimals;
    return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  // VND/AOA: đơn vị nhỏ, không cần thập phân dù decimals được truyền vào
  return sign + abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " " + currencySuffix(currency);
}
function formatMoneyCompact(vUsd) {
  const currency = currentCurrency;
  const v = convertFromUsd(vUsd || 0, currency);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  let out;
  if (abs >= 1e9) out = (abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + "B";
  else if (abs >= 1e6) out = (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
  else if (abs >= 1e3) out = (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + "k";
  else out = abs.toFixed(0);
  const prefix = currency === "usd" ? "$" : "";
  const suffix = currency === "usd" ? "" : (" " + currencySuffix(currency));
  return sign + prefix + out + suffix;
}

/* Chart colors (plain hex, not CSS vars, inside SVG for broader browser compatibility) */
const COLOR_SERIES_1 = "#2a78d6"; // doanh thu / cash có vốn góp
const COLOR_SERIES_2 = "#eb6834"; // EBITDA
const COLOR_SERIES_3 = "#8a5cf6"; // cash nếu KHÔNG góp vốn
const COLOR_GRID = "#e1e0d9";
const COLOR_MUTED = "#898781";
const COLOR_BASELINE = "#c3c2b7";

const PIE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#e34948", "#008300"];
const PIE_OVERFLOW_COLOR = "#898781";

/* ---------------------------------------------------------------------------
   Simple field bindings (input id <-> state path).
   Lưu ý: mọi field %/tỷ giá trong DEFAULTS đã lưu ở dạng số nguyên đọc được
   (vd cogsPct = 25 nghĩa là 25%, KHÔNG phải 0.25) — calcModel tự chia /100.
   Nên binding ở đây không cần nhân/chia 100 như model God's Eyes cũ.
   --------------------------------------------------------------------------- */
const SIMPLE_FIELDS = [
  { id: "baselineOrdersPerDay", path: "volume.baselineOrdersPerDay" },
  { id: "monthlyGrowthPct", path: "volume.monthlyGrowthPct" },
  { id: "aov", path: "revenue.aov" },
  { id: "cogsPct", path: "costRates.cogsPct" },
  { id: "adsPct", path: "costRates.adsPct" },
  { id: "paymentFeePct", path: "costRates.paymentFeePct" },
  { id: "returnsPct", path: "costRates.returnsPct" },
  { id: "totalInvestment", path: "capital.totalInvestment" },
  { id: "maxAvailable", path: "capital.maxAvailable" },
  { id: "founderSplitHieuPct", path: "capital.founderSplitHieuPct" },
  { id: "founderSplitTungPct", path: "capital.founderSplitTungPct" },
  { id: "conservativeAdj", path: "scenario.conservativeAdj" },
  { id: "optimisticAdj", path: "scenario.optimisticAdj" },
  { id: "usdToVnd", path: "fx.usdToVnd" },
  { id: "usdToAoa", path: "fx.usdToAoa" }
];

function setSimpleFieldValues() {
  SIMPLE_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    const v = getPath(state, f.path);
    el.value = roundForInput(Number(v || 0));
  });
}

function bindSimpleFields() {
  SIMPLE_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    el.addEventListener("input", () => {
      let v = parseFloat(el.value);
      if (isNaN(v)) v = 0;
      setPath(state, f.path, v);
      recalcAndRender();
    });
  });
}

/* ---------------------------------------------------------------------------
   Dynamic tables: fixedOverhead / oneTimeSetup / headcount
   --------------------------------------------------------------------------- */
function renderFixedOverheadRows() {
  const tbody = document.getElementById("fixedOverheadRows");
  tbody.innerHTML = state.fixedOverhead.map((row, i) => `
    <tr>
      <td><input type="text" data-list="fixedOverhead" data-index="${i}" data-field="label" value="${escapeHtml(row.label)}"></td>
      <td class="col-amount"><input type="number" step="10" data-list="fixedOverhead" data-index="${i}" data-field="amount" value="${roundForInput(row.amount)}"></td>
      <td class="col-remove"><button class="row-remove-btn" data-remove="fixedOverhead" data-index="${i}" type="button" title="Xoá dòng">✕</button></td>
    </tr>
  `).join("");
}

function renderOneTimeSetupRows() {
  const tbody = document.getElementById("oneTimeSetupRows");
  tbody.innerHTML = state.oneTimeSetup.map((row, i) => `
    <tr>
      <td><input type="text" data-list="oneTimeSetup" data-index="${i}" data-field="label" value="${escapeHtml(row.label)}"></td>
      <td class="col-amount"><input type="number" step="10" data-list="oneTimeSetup" data-index="${i}" data-field="amount" value="${roundForInput(row.amount)}"></td>
      <td class="col-month"><input type="number" step="1" min="1" max="12" data-list="oneTimeSetup" data-index="${i}" data-field="month" value="${roundForInput(row.month || 1)}"></td>
      <td class="col-remove"><button class="row-remove-btn" data-remove="oneTimeSetup" data-index="${i}" type="button" title="Xoá dòng">✕</button></td>
    </tr>
  `).join("");
}

function renderHeadcountRows() {
  const tbody = document.getElementById("headcountRows");
  tbody.innerHTML = state.headcount.map((row, i) => `
    <tr>
      <td><input type="text" data-list="headcount" data-index="${i}" data-field="role" value="${escapeHtml(row.role)}"></td>
      <td class="col-count"><input type="number" step="1" data-list="headcount" data-index="${i}" data-field="count" value="${roundForInput(row.count)}"></td>
      <td class="col-rate"><input type="number" step="10" data-list="headcount" data-index="${i}" data-field="monthlyRate" value="${roundForInput(row.monthlyRate)}"></td>
      <td class="col-remove"><button class="row-remove-btn" data-remove="headcount" data-index="${i}" type="button" title="Xoá dòng">✕</button></td>
    </tr>
  `).join("");
}

function listArrayFor(list) {
  if (list === "fixedOverhead") return state.fixedOverhead;
  if (list === "oneTimeSetup") return state.oneTimeSetup;
  if (list === "headcount") return state.headcount;
  return null;
}

function bindDynamicTableEvents() {
  const body = document.getElementById("assumptionsBody");

  body.addEventListener("input", e => {
    const t = e.target;
    if (!t.matches("[data-list]")) return;
    const list = t.getAttribute("data-list");
    const idx = Number(t.getAttribute("data-index"));
    const field = t.getAttribute("data-field");
    const arr = listArrayFor(list);
    if (!arr || !arr[idx]) return;

    let value;
    if (t.type === "number") {
      value = parseFloat(t.value);
      if (isNaN(value)) value = 0;
    } else {
      value = t.value;
    }
    arr[idx][field] = value;
    recalcAndRender();
  });

  body.addEventListener("click", e => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const list = btn.getAttribute("data-remove");
    const idx = Number(btn.getAttribute("data-index"));
    const arr = listArrayFor(list);
    if (!arr) return;
    arr.splice(idx, 1);
    if (list === "fixedOverhead") renderFixedOverheadRows();
    else if (list === "oneTimeSetup") renderOneTimeSetupRows();
    else if (list === "headcount") renderHeadcountRows();
    recalcAndRender();
  });

  document.getElementById("addFixedOverheadRow").addEventListener("click", () => {
    state.fixedOverhead.push({ label: "Khoản mục mới", amount: 0 });
    renderFixedOverheadRows();
    recalcAndRender();
  });
  document.getElementById("addOneTimeSetupRow").addEventListener("click", () => {
    state.oneTimeSetup.push({ label: "Khoản mục mới", amount: 0, month: 1 });
    renderOneTimeSetupRows();
    recalcAndRender();
  });
  document.getElementById("addHeadcountRow").addEventListener("click", () => {
    state.headcount.push({ role: "Vai trò mới", count: 1, monthlyRate: 0 });
    renderHeadcountRows();
    recalcAndRender();
  });
}

/* ---------------------------------------------------------------------------
   Computed displays: totals under each dynamic table + volume boxes
   --------------------------------------------------------------------------- */
function updateFixedTotalDisplay() {
  const total = state.fixedOverhead.reduce((s, r) => s + Number(r.amount || 0), 0);
  document.getElementById("fixedTotalDisplay").textContent = formatMoney(total) + "/tháng";
}
function updateOneTimeTotalDisplay() {
  const total = state.oneTimeSetup.reduce((s, r) => s + Number(r.amount || 0), 0);
  document.getElementById("oneTimeTotalDisplay").textContent = formatMoney(total);
}
function updateHeadcountTotalDisplay() {
  const total = state.headcount.reduce((s, r) => s + Number(r.count || 0) * Number(r.monthlyRate || 0), 0);
  document.getElementById("headcountTotalDisplay").textContent = formatMoney(total) + "/tháng";
}

function renderVolumeBoxes(model) {
  const el = document.getElementById("volumeBoxes");
  if (!el) return;
  el.innerHTML = `
    <div class="rev-box">
      <div class="label">Đơn/ngày — Tháng 2 (baseline)</div>
      <div class="value">${fmtNum(model.months[1].ordersPerDay, 0)}</div>
    </div>
    <div class="rev-box">
      <div class="label">Đơn/ngày — Tháng 12 (cuối năm)</div>
      <div class="value">${fmtNum(model.endOrdersPerDay, 0)}</div>
    </div>
    <div class="rev-box">
      <div class="label">Tổng số đơn cả năm</div>
      <div class="value">${fmtNum(model.total.orders, 0)}</div>
    </div>
    <div class="rev-box total">
      <div class="label">TỔNG DOANH THU CẢ NĂM</div>
      <div class="value">${formatMoney(model.total.revenue)}</div>
    </div>
  `;
}

/* ---------------------------------------------------------------------------
   KPI cards
   --------------------------------------------------------------------------- */
function renderKPIs(model) {
  const total = model.total;
  const lastMonth = model.months[model.months.length - 1];
  const el = document.getElementById("kpiGrid");
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Doanh thu Năm 1</div>
      <div class="kpi-value">${formatMoney(total.revenue)}</div>
      <div class="kpi-sub">${fmtNum(total.orders, 0)} đơn cả năm</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">EBITDA Năm 1</div>
      <div class="kpi-value ${total.ebitda >= 0 ? "positive" : "negative"}">${formatMoney(total.ebitda)}</div>
      <div class="kpi-sub">Biên EBITDA ${fmtPctNum(total.ebitdaMargin)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Đơn/ngày — Tháng 12</div>
      <div class="kpi-value">${fmtNum(model.endOrdersPerDay, 0)}</div>
      <div class="kpi-sub">Baseline Tháng 2: ${fmtNum(model.months[1].ordersPerDay, 0)} đơn/ngày</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Tiền mặt cuối Năm 1</div>
      <div class="kpi-value ${lastMonth.cashBalance >= 0 ? "positive" : "negative"}">${formatMoney(lastMonth.cashBalance)}</div>
      <div class="kpi-sub">Sau khi góp ${formatMoney(Number(state.capital.totalInvestment || 0))} vốn ban đầu</div>
    </div>
  `;
}

/* ---------------------------------------------------------------------------
   Funding-need callout — so sánh điểm âm tiền mặt thấp nhất NẾU KHÔNG góp
   vốn trước (minCashNoFunding) với vốn đang góp và trần vốn tối đa $10k.
   --------------------------------------------------------------------------- */
function renderFundingCallout(model) {
  const el = document.getElementById("fundingCallout");
  if (!el) return;
  const needed = Math.max(0, -model.minCashNoFunding);
  const invested = Number(state.capital.totalInvestment || 0);
  const ceiling = Number(state.capital.maxAvailable || 0);
  const sufficient = invested >= needed;
  el.innerHTML = `
    <div class="funding-grid">
      <div class="funding-metric">
        <div class="label">Nhu cầu vốn thực tế (nếu KHÔNG góp vốn trước)</div>
        <div class="value ${needed > 0 ? "negative" : ""}">${formatMoney(needed)}</div>
        <div class="sub">Điểm âm sâu nhất — Tháng ${model.minCashNoFundingMonth || 1} (kịch bản hiện tại)</div>
      </div>
      <div class="funding-metric">
        <div class="label">Vốn góp đang đưa vào model</div>
        <div class="value">${formatMoney(invested)}</div>
      </div>
      <div class="funding-metric">
        <div class="label">Trần vốn tối đa 2 người sẵn sàng góp</div>
        <div class="value">${formatMoney(ceiling)}</div>
      </div>
    </div>
    <div class="funding-note ${sufficient ? "ok" : "warn"}">
      ${sufficient
        ? `✓ Vốn góp ${formatMoney(invested)} đã đủ trang trải điểm âm tiền mặt thấp nhất (${formatMoney(needed)}) — KHÔNG cần huy động đến trần ${formatMoney(ceiling)}.`
        : `⚠ Vốn góp ${formatMoney(invested)} CHƯA đủ trang trải điểm âm tiền mặt thấp nhất (${formatMoney(needed)}) — cần góp thêm hoặc giảm chi tiêu đầu kỳ.`}
    </div>
  `;
}

/* ---------------------------------------------------------------------------
   Monthly P&L table — 12 tháng + cột "Cả năm"
   --------------------------------------------------------------------------- */
const TABLE_ROWS = [
  { key: "ordersPerDay", label: "Đơn/ngày", fmt: "num0", noAnnual: true },
  { key: "orders", label: "Số đơn/tháng", fmt: "num0" },
  { key: "revenue", label: "Doanh thu", fmt: "money", bold: true },
  { key: "cogs", label: "Giá vốn (COGS)", fmt: "money", sub: true },
  { key: "ads", label: "Quảng cáo (Ads)", fmt: "money", sub: true },
  { key: "paymentFee", label: "Phí thanh toán", fmt: "money", sub: true },
  { key: "returns", label: "Hoàn/huỷ đơn", fmt: "money", sub: true },
  { key: "grossProfit", label: "Lợi nhuận gộp", fmt: "money", signed: true },
  { key: "fixedOverheadMonthly", label: "Chi phí cố định", fmt: "money" },
  { key: "headcountMonthly", label: "Nhân sự", fmt: "money" },
  { key: "ebitda", label: "EBITDA", fmt: "money", signed: true, bold: true },
  { key: "oneTimeSetup", label: "Chi phí thiết lập một lần", fmt: "money" },
  { key: "netCashFlow", label: "Dòng tiền ròng (Net Cash Flow)", fmt: "money", signed: true },
  { key: "cashBalance", label: "Tiền mặt luỹ kế (có vốn góp)", fmt: "money", bold: true, signed: true, isEnding: true }
];

function formatCell(v, fmt) {
  if (fmt === "num0") return fmtNum(v, 0);
  return formatMoney(v, 0);
}
function cellClass(v, signed) {
  if (!signed) return "";
  return v < 0 ? "negative" : "positive";
}

function renderMonthlyTable(model) {
  const thead = document.getElementById("monthlyTableHead");
  const tbody = document.getElementById("monthlyTableBody");
  const tfoot = document.getElementById("monthlyTableFoot");
  const months = model.months;

  thead.innerHTML = `<tr><th>Chỉ số</th>${months.map(m => `<th>Th.${m.m}</th>`).join("")}<th class="col-annual">Cả năm</th></tr>`;

  tbody.innerHTML = TABLE_ROWS.map(row => {
    const cells = months.map(m => {
      const v = m[row.key];
      return `<td class="${cellClass(v, row.signed)}"${row.bold ? ' style="font-weight:700"' : ""}>${formatCell(v, row.fmt)}</td>`;
    }).join("");
    let annualCell;
    if (row.noAnnual) {
      annualCell = `<td class="col-annual">—</td>`;
    } else {
      const annualVal = row.isEnding ? model.total.endingCash : model.total[row.key];
      annualCell = `<td class="col-annual ${cellClass(annualVal, row.signed)}">${formatCell(annualVal, row.fmt)}</td>`;
    }
    return `<tr${row.sub ? ' class="sub-row"' : ""}><td>${row.label}</td>${cells}${annualCell}</tr>`;
  }).join("");

  if (tfoot) tfoot.innerHTML = "";
}

/* ---------------------------------------------------------------------------
   Balance Sheet table — 12 tháng, không có cột "Cả năm" (số dư tại 1 thời
   điểm, không cộng dồn được như dòng P&L).
   --------------------------------------------------------------------------- */
const BALANCE_SHEET_ROWS = [
  { key: "totalAssets", label: "TÀI SẢN — Tiền mặt (Cash)", bold: true, signed: true },
  { key: "totalLiabilities", label: "NỢ PHẢI TRẢ" },
  { key: "paidInCapital", label: "VỐN CSH — Vốn góp (Paid-in capital)" },
  { key: "retainedEarnings", label: "VỐN CSH — Lợi nhuận giữ lại (Retained earnings)", signed: true },
  { key: "totalEquity", label: "TỔNG VỐN CHỦ SỞ HỮU", bold: true, signed: true }
];

function renderBalanceSheetTable(model) {
  const thead = document.getElementById("balanceSheetHead");
  const tbody = document.getElementById("balanceSheetBody");
  const months = model.months;

  thead.innerHTML = `<tr><th>Khoản mục</th>${months.map(m => `<th>Th.${m.m}</th>`).join("")}</tr>`;

  const rowsHtml = BALANCE_SHEET_ROWS.map(row => {
    const cells = months.map(m => {
      const v = m[row.key];
      return `<td class="${cellClass(v, row.signed)}"${row.bold ? ' style="font-weight:700"' : ""}>${formatMoney(v, 0)}</td>`;
    }).join("");
    return `<tr><td>${row.label}</td>${cells}</tr>`;
  }).join("");

  const checkCells = months.map(m => {
    const diff = Math.round((m.totalAssets - (m.totalLiabilities + m.totalEquity)) * 100) / 100;
    const ok = Math.abs(diff) < 0.01;
    return `<td style="font-size:11px;color:${ok ? "var(--good)" : "var(--critical)"}">${ok ? "✓ khớp" : "⚠ " + formatMoney(diff, 2)}</td>`;
  }).join("");
  const checkRow = `<tr><td style="font-style:italic;color:var(--text-muted);font-size:12px;">Kiểm tra: Tài sản = Nợ + Vốn CSH?</td>${checkCells}</tr>`;

  tbody.innerHTML = rowsHtml + checkRow;
}

/* ---------------------------------------------------------------------------
   Charts (inline SVG, hand-drawn, no CDN dependency) — luôn vẽ đủ 12 tháng.
   --------------------------------------------------------------------------- */
function renderRevenueEbitdaChart(months) {
  const W = 640, H = 260, padL = 50, padR = 12, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = months.length;

  const revs = months.map(m => m.revenue);
  const ebs = months.map(m => m.ebitda);
  const allVals = revs.concat(ebs);
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(0, ...allVals);
  const range = (maxV - minV) || 1;

  const yScale = v => padT + plotH - ((v - minV) / range) * plotH;
  const zeroY = yScale(0);
  const bandW = plotW / n;
  const barW = Math.min(28, bandW * 0.6);

  let gridSvg = "";
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minV + (range * i) / steps;
    const y = yScale(v);
    gridSvg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${COLOR_GRID}" stroke-width="1"/>`;
    gridSvg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${COLOR_MUTED}">${formatMoneyCompact(v)}</text>`;
  }

  let barsSvg = "", labelsSvg = "";
  const linePts = [];
  months.forEach((m, i) => {
    const cx = padL + bandW * i + bandW / 2;
    const y = yScale(m.revenue);
    const top = Math.min(y, zeroY);
    const h = Math.max(Math.abs(zeroY - y), 1);
    barsSvg += `<rect class="bar-mark" x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${COLOR_SERIES_1}"><title>Th.${m.m}: Doanh thu ${formatMoney(m.revenue)}</title></rect>`;
    linePts.push([cx, yScale(m.ebitda)]);
    labelsSvg += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="${COLOR_MUTED}">Th.${m.m}</text>`;
  });

  const linePath = linePts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const dotsSvg = linePts.map((p, i) => `<circle class="pt-mark" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${COLOR_SERIES_2}"><title>Th.${months[i].m}: EBITDA ${formatMoney(months[i].ebitda)}</title></circle>`).join("");
  const zeroLineSvg = `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="${COLOR_BASELINE}" stroke-width="1.2"/>`;

  document.getElementById("chartRevenueEbitda").innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Doanh thu và EBITDA theo tháng">
    ${gridSvg}${barsSvg}${zeroLineSvg}
    <path d="${linePath}" fill="none" stroke="${COLOR_SERIES_2}" stroke-width="2"/>
    ${dotsSvg}${labelsSvg}
  </svg>`;
}

function renderCashChart(months) {
  const W = 640, H = 260, padL = 58, padR = 12, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = months.length;

  const valsFunded = months.map(m => m.cashBalance);
  const valsNoFunding = months.map(m => m.cashBalanceNoFunding);
  const allVals = valsFunded.concat(valsNoFunding);
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(0, ...allVals);
  const range = (maxV - minV) || 1;

  const yScale = v => padT + plotH - ((v - minV) / range) * plotH;
  const xScale = i => padL + (plotW * i) / (n - 1);
  const zeroY = yScale(0);

  let gridSvg = "";
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minV + (range * i) / steps;
    const y = yScale(v);
    gridSvg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${COLOR_GRID}" stroke-width="1"/>`;
    gridSvg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${COLOR_MUTED}">${formatMoneyCompact(v)}</text>`;
  }

  function seriesGeom(vals, color) {
    const pts = vals.map((v, i) => [xScale(i), yScale(v)]);
    const linePath = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    const dotsSvg = pts.map((p, i) => `<circle class="pt-mark" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${color}"><title>Th.${months[i].m}: ${formatMoney(vals[i])}</title></circle>`).join("");
    return { linePath, dotsSvg, pts };
  }

  const funded = seriesGeom(valsFunded, COLOR_SERIES_1);
  const noFunding = seriesGeom(valsNoFunding, COLOR_SERIES_3);

  const areaPath = `M${funded.pts[0][0].toFixed(1)},${zeroY.toFixed(1)} ` + funded.pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + ` L${funded.pts[funded.pts.length - 1][0].toFixed(1)},${zeroY.toFixed(1)} Z`;

  let labelsSvg = "";
  months.forEach((m, i) => {
    labelsSvg += `<text x="${xScale(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="${COLOR_MUTED}">Th.${m.m}</text>`;
  });
  const zeroLineSvg = minV < 0 ? `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="${COLOR_BASELINE}" stroke-width="1.2"/>` : "";

  document.getElementById("chartCash").innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dòng tiền luỹ kế theo tháng, có và không có vốn góp">
    ${gridSvg}
    <path d="${areaPath}" fill="${COLOR_SERIES_1}" opacity="0.10"/>
    ${zeroLineSvg}
    <path d="${noFunding.linePath}" fill="none" stroke="${COLOR_SERIES_3}" stroke-width="2" stroke-dasharray="4,3"/>
    <path d="${funded.linePath}" fill="none" stroke="${COLOR_SERIES_1}" stroke-width="2"/>
    ${noFunding.dotsSvg}${funded.dotsSvg}${labelsSvg}
  </svg>`;
}

/* Cost-breakdown donut — chia Doanh thu cả năm thành COGS/Ads/Phí thanh
   toán/Hoàn đơn/Chi phí cố định/Nhân sự/Thiết lập một lần/Lợi nhuận ròng.
   Thay cho donut "revenue mix theo loại sản phẩm" của model tham khảo, vì
   model này chỉ dùng 1 AOV chung, không có bảng product-mix. */
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlicePath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const startOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    "M", startOuter.x.toFixed(2), startOuter.y.toFixed(2),
    "A", rOuter, rOuter, 0, largeArc, 0, endOuter.x.toFixed(2), endOuter.y.toFixed(2),
    "L", endInner.x.toFixed(2), endInner.y.toFixed(2),
    "A", rInner, rInner, 0, largeArc, 1, startInner.x.toFixed(2), startInner.y.toFixed(2),
    "Z"
  ].join(" ");
}

function computeCostBreakdown(total) {
  const items = [
    { label: "Giá vốn hàng bán (COGS)", value: total.cogs },
    { label: "Quảng cáo (Ads)", value: total.ads },
    { label: "Phí thanh toán", value: total.paymentFee },
    { label: "Hoàn/huỷ đơn", value: total.returns },
    { label: "Chi phí cố định", value: total.fixedOverheadMonthly },
    { label: "Nhân sự", value: total.headcountMonthly },
    { label: "Thiết lập một lần", value: total.oneTimeSetup },
    { label: "Lợi nhuận ròng (Net Profit)", value: total.netCashFlow }
  ];
  const visible = items.filter(i => i.value > 0.5);
  const totalRevenue = total.revenue;
  visible.forEach(i => { i.pct = totalRevenue > 0 ? i.value / totalRevenue : 0; });
  return { items: visible, total: totalRevenue };
}

function renderCostMixChart(model) {
  const container = document.getElementById("chartCostMix");
  if (!container) return;
  const { items, total } = computeCostBreakdown(model.total);

  if (total <= 0 || items.length === 0) {
    container.innerHTML = `<div class="field-note">Chưa có doanh thu để phân bổ.</div>`;
    return;
  }

  const cx = 80, cy = 80, rOuter = 76, rInner = 44;
  let angle = 0;
  let slicesSvg = "";
  const legendRows = [];

  items.forEach((item, i) => {
    const color = i < PIE_COLORS.length ? PIE_COLORS[i] : PIE_OVERFLOW_COLOR;
    const span = item.pct * 360;
    const start = angle;
    const end = Math.min(angle + span, 360);
    const gap = items.length > 1 ? 0.75 : 0;
    const d = donutSlicePath(cx, cy, rOuter, rInner, start + gap, Math.max(end - gap, start + gap));
    slicesSvg += `<path class="pie-slice" d="${d}" fill="${color}"><title>${escapeHtml(item.label)}: ${formatMoney(item.value)} (${(item.pct * 100).toFixed(1)}%)</title></path>`;
    angle = end;
    legendRows.push(`
      <li>
        <span class="swatch" style="background:${color}"></span>
        <span class="name">${escapeHtml(item.label)}</span>
        <span class="stats">
          <span class="amt">${formatMoney(item.value)}</span>
          <span class="pct">${(item.pct * 100).toFixed(1)}%</span>
        </span>
      </li>
    `);
  });

  const centerLabel = `
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="10" fill="${COLOR_MUTED}">Doanh thu</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="13" font-weight="700" fill="#0b0b0b">${formatMoneyCompact(total)}</text>
  `;

  container.innerHTML = `
    <div class="pie-chart-row">
      <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Phân bổ chi phí và lợi nhuận theo doanh thu">
        ${slicesSvg}
        ${centerLabel}
      </svg>
      <ul class="pie-legend">${legendRows.join("")}</ul>
    </div>
  `;
}

function renderCharts(model) {
  renderRevenueEbitdaChart(model.months);
  renderCashChart(model.months);
  renderCostMixChart(model);
}

/* ---------------------------------------------------------------------------
   Master recalc + render
   --------------------------------------------------------------------------- */
function recalcAndRender() {
  const model = calcModel(state, currentScenario);
  renderVolumeBoxes(model);
  updateFixedTotalDisplay();
  updateOneTimeTotalDisplay();
  updateHeadcountTotalDisplay();
  renderKPIs(model);
  renderFundingCallout(model);
  renderMonthlyTable(model);
  renderBalanceSheetTable(model);
  renderCharts(model);
}

/* ---------------------------------------------------------------------------
   Admin — Save as Default (commits an updated script.js straight to GitHub
   via the Contents API, using a user-supplied Personal Access Token).
   The PAT is only ever held in a page-local variable / the password input's
   value — it is NEVER written to localStorage or sent anywhere except
   https://api.github.com. Only owner/repo/branch/path (non-sensitive) are
   remembered in localStorage, to save re-typing them each visit.
   --------------------------------------------------------------------------- */
const GITHUB_API_BASE = "https://api.github.com";
const ADMIN_LS_KEYS = {
  owner: "angolaB2C_admin_owner",
  repo: "angolaB2C_admin_repo",
  branch: "angolaB2C_admin_branch",
  path: "angolaB2C_admin_path"
};

function adminEls() {
  return {
    owner: document.getElementById("adminOwner"),
    repo: document.getElementById("adminRepo"),
    branch: document.getElementById("adminBranch"),
    path: document.getElementById("adminPath"),
    pat: document.getElementById("adminPat"),
    pinInput: document.getElementById("adminPinInput"),
    unlockStatus: document.getElementById("adminUnlockStatus"),
    saveStatus: document.getElementById("adminSaveStatus"),
    lockedView: document.getElementById("adminLockedView"),
    unlockedView: document.getElementById("adminUnlockedView"),
    saveBtn: document.getElementById("adminSaveBtn")
  };
}

function setAdminStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message || "";
  el.className = "admin-status" + (kind ? " " + kind : "");
}

function loadAdminNonSensitiveFields() {
  const e = adminEls();
  let saved = {};
  try {
    saved = {
      owner: localStorage.getItem(ADMIN_LS_KEYS.owner) || "",
      repo: localStorage.getItem(ADMIN_LS_KEYS.repo) || "",
      branch: localStorage.getItem(ADMIN_LS_KEYS.branch) || "",
      path: localStorage.getItem(ADMIN_LS_KEYS.path) || ""
    };
  } catch (err) {
    saved = { owner: "", repo: "", branch: "", path: "" };
  }
  e.owner.value = saved.owner;
  e.repo.value = saved.repo;
  e.branch.value = saved.branch || "main";
  e.path.value = saved.path || "script.js";
}

function persistAdminNonSensitiveFields() {
  const e = adminEls();
  try {
    localStorage.setItem(ADMIN_LS_KEYS.owner, e.owner.value.trim());
    localStorage.setItem(ADMIN_LS_KEYS.repo, e.repo.value.trim());
    localStorage.setItem(ADMIN_LS_KEYS.branch, e.branch.value.trim());
    localStorage.setItem(ADMIN_LS_KEYS.path, e.path.value.trim());
  } catch (err) {
    /* localStorage unavailable (e.g. private browsing) — non-fatal, just won't be remembered */
  }
}

/* UTF-8 safe base64 encode/decode (btoa/atob only handle Latin1 natively) */
function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
}

/* Rebuild script.js's source with a freshly-serialized DEFAULTS object,
   using the DEFAULTS:START / DEFAULTS:END marker comments so the rest of
   the file (calcModel, etc.) is left untouched. Throws if the markers are
   missing, rather than guessing and risking a corrupted commit. */
function buildUpdatedScriptSource(originalSource, newDefaults) {
  const startMarkerIdx = originalSource.indexOf("DEFAULTS:START");
  const endMarkerIdx = originalSource.indexOf("DEFAULTS:END");
  if (startMarkerIdx === -1 || endMarkerIdx === -1 || endMarkerIdx < startMarkerIdx) {
    throw new Error('Could not find the "DEFAULTS:START"/"DEFAULTS:END" markers in the fetched script.js — aborting so as not to corrupt the file.');
  }
  const startCommentEnd = originalSource.indexOf("*/", startMarkerIdx);
  const endCommentStart = originalSource.lastIndexOf("/*", endMarkerIdx);
  if (startCommentEnd === -1 || endCommentStart === -1 || endCommentStart <= startCommentEnd) {
    throw new Error("The DEFAULTS marker comments look malformed — aborting so as not to corrupt the file.");
  }
  const before = originalSource.slice(0, startCommentEnd + 2);
  const after = originalSource.slice(endCommentStart);
  const newBlock = "\nconst DEFAULTS = " + JSON.stringify(newDefaults, null, 2) + ";\n";
  return before + newBlock + after;
}

function bindAdminSection() {
  const e = adminEls();
  if (!e.saveBtn) return; // section not present — nothing to bind

  loadAdminNonSensitiveFields();

  document.getElementById("adminUnlockBtn").addEventListener("click", () => {
    if (e.pinInput.value === ADMIN_CONFIG.pin) {
      e.lockedView.style.display = "none";
      e.unlockedView.style.display = "block";
      e.pinInput.value = "";
      setAdminStatus(e.unlockStatus, "", "");
    } else {
      setAdminStatus(e.unlockStatus, "Sai PIN.", "error");
    }
  });

  e.pinInput.addEventListener("keydown", ev => {
    if (ev.key === "Enter") document.getElementById("adminUnlockBtn").click();
  });

  document.getElementById("adminLockBtn").addEventListener("click", () => {
    e.unlockedView.style.display = "none";
    e.lockedView.style.display = "block";
    e.pat.value = "";
    setAdminStatus(e.saveStatus, "", "");
  });

  [e.owner, e.repo, e.branch, e.path].forEach(input => {
    input.addEventListener("change", persistAdminNonSensitiveFields);
  });

  e.saveBtn.addEventListener("click", saveAsDefault);
}

async function saveAsDefault() {
  const e = adminEls();
  const owner = e.owner.value.trim();
  const repo = e.repo.value.trim();
  const branch = e.branch.value.trim() || "main";
  const path = e.path.value.trim() || "script.js";
  const pat = e.pat.value.trim();

  if (!owner || !repo || !pat) {
    setAdminStatus(e.saveStatus, "Owner, repository, và Personal Access Token đều bắt buộc.", "error");
    return;
  }

  persistAdminNonSensitiveFields();

  const apiPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const apiUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${apiPath}`;
  const headers = { "Authorization": "token " + pat, "Accept": "application/vnd.github+json" };

  e.saveBtn.disabled = true;
  setAdminStatus(e.saveStatus, "Đang lấy file hiện tại từ GitHub…", "pending");

  try {
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    let existingSha = null;
    let originalSource = null;

    if (getRes.status === 200) {
      const getData = await getRes.json();
      existingSha = getData.sha;
      originalSource = base64ToUtf8(getData.content);
    } else if (getRes.status === 404) {
      throw new Error(`Không tìm thấy "${path}" trên branch "${branch}" của ${owner}/${repo}. Công cụ này chỉ cập nhật script.js đã có sẵn trong repo đã deploy — push đủ 4 file gốc trước, rồi mới dùng Save as Default.`);
    } else {
      const body = await getRes.text();
      throw new Error(`GitHub từ chối yêu cầu đọc (HTTP ${getRes.status}): ${body.slice(0, 200)}`);
    }

    setAdminStatus(e.saveStatus, "Đang dựng file mới…", "pending");
    const updatedSource = buildUpdatedScriptSource(originalSource, deepClone(state));

    setAdminStatus(e.saveStatus, "Đang commit lên GitHub…", "pending");
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({
        message: "Save as default — update DEFAULTS from the live page",
        content: utf8ToBase64(updatedSource),
        sha: existingSha,
        branch: branch
      })
    });

    if (putRes.status === 200 || putRes.status === 201) {
      setAdminStatus(e.saveStatus, `Đã lưu — default mới đã commit vào ${owner}/${repo} (${branch}). GitHub Pages thường redeploy sau 1-2 phút.`, "success");
    } else {
      const body = await putRes.text();
      throw new Error(`GitHub từ chối commit (HTTP ${putRes.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    setAdminStatus(e.saveStatus, "Lỗi: " + err.message, "error");
  } finally {
    e.saveBtn.disabled = false;
  }
}

/* ---------------------------------------------------------------------------
   Init
   --------------------------------------------------------------------------- */
function fullRenderAssumptionInputs() {
  renderFixedOverheadRows();
  renderOneTimeSetupRows();
  renderHeadcountRows();
  setSimpleFieldValues();
}

function bindScenarioTabs() {
  document.querySelectorAll(".scenario-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".scenario-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      currentScenario = btn.getAttribute("data-scenario");
      recalcAndRender();
    });
  });
}

function bindCurrencyTabs() {
  document.querySelectorAll(".currency-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".currency-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      currentCurrency = btn.getAttribute("data-currency");
      recalcAndRender();
    });
  });
}

function bindAssumptionsToggle() {
  const toggleBtn = document.getElementById("assumptionsToggle");
  const body = document.getElementById("assumptionsBody");
  toggleBtn.addEventListener("click", () => {
    const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!expanded));
    body.style.display = expanded ? "none" : "block";
  });
}

function bindResetButton() {
  document.getElementById("resetDefaultsBtn").addEventListener("click", () => {
    state = deepClone(DEFAULTS);
    fullRenderAssumptionInputs();
    recalcAndRender();
  });
}

function init() {
  fullRenderAssumptionInputs();
  bindSimpleFields();
  bindDynamicTableEvents();
  bindScenarioTabs();
  bindCurrencyTabs();
  bindAssumptionsToggle();
  bindResetButton();
  bindAdminSection();
  recalcAndRender();
}

document.addEventListener("DOMContentLoaded", init);
