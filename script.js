/* ============================================================================
   Angola Market Entry · Financial Model — B2C Dropship (Year 1)
   Phong cách/kiến trúc dựa trên financial-model-b2c (God's Eyes), cùng tác giả:
   https://github.com/tthieu285/financial-model-b2c
   Toàn bộ engine tính toán + rendering + tương tác nằm trong file này + app.js.
   Mọi input trên trang đều free-edit — không có ô nào bị khoá/tự suy ra từ ô khác.

   MODEL HORIZON: 1 năm / 12 tháng (Year 1 — mô hình DROPSHIP test thị trường).
   Year 2 (nhập hàng/tồn kho, website làm kênh chủ lực) NGOÀI SCOPE bản này.

   Tháng 1 = tháng dựng hạ tầng (đăng ký công ty tại Angola, mở tài khoản ngân
   hàng, dựng site WooCommerce + GPayGo, test sản phẩm) — mặc định 0 đơn hàng.
   Tháng 2 = mốc validate đầu tiên (đơn/ngày = baselineOrdersPerDay).
   Tháng 3-12 = tăng trưởng theo bậc mỗi tháng (monthlyGrowthPct), mặc định để
   đạt đúng mốc 200 đơn/ngày vào tháng 12 (~25,89%/tháng từ baseline 20 đơn/ngày).

   VÒNG QUAY VỐN (cash conversion cycle): doanh thu thu về ở TK nhận tiền tại
   Angola (GPayGo) không dùng trực tiếp để trả ads/nhập hàng được ngay — mất
   `capital.cashConversionDays` (mặc định 30 ngày ≈ 1 tháng) trước khi "về" TK
   chung để chi tiêu. EBITDA/Net income vẫn tính dồn tích (accrual, theo tháng
   phát sinh) — CHỈ dòng tiền thực tế (netCashMovement/cashBalance) bị trễ.
   Đây là lý do vốn cần ban đầu thực tế lớn hơn nhiều so với nhìn thuần EBITDA.

   VỐN GÓP: `capital.shareholders` là bảng động (thêm/bớt cổ đông tự do) —
   mỗi dòng có vốn góp ($) + tỷ lệ cổ phần (%). Tổng vốn góp các dòng = vốn
   góp ban đầu đưa vào model (không còn là 1 số cố định như trước).
   ============================================================================ */

/* ---------------------------------------------------------------------------
   0. ADMIN CONFIG — cho công cụ "Save as Default" trong mục Admin.
   PIN chỉ là rào cản nhẹ (site tĩnh, ai cũng xem được source), KHÔNG phải bảo
   mật thật. Đổi trước khi deploy nếu muốn PIN khác.
   --------------------------------------------------------------------------- */
const ADMIN_CONFIG = {
  pin: "2468"
};

const MONTHS_PER_YEAR = 12;
const DAYS_PER_MONTH = 30; // giả định chung, không neo theo lịch thật

/* ---------------------------------------------------------------------------
   1. DEFAULT ASSUMPTIONS — chốt qua phỏng vấn trực tiếp với anh Hiếu (26/8/2026)
   --------------------------------------------------------------------------- */
/* === DEFAULTS:START — sẽ được ghi đè lại mỗi khi dùng công cụ "Save as
   Default" trong mục Admin. Sửa tay ở đây vẫn được, nhưng lần Save tiếp theo
   sẽ ghi đè lại toàn bộ object này. === */
const DEFAULTS = {
  "fx": {
    "usdToVnd": 26098,
    "usdToAoa": 916.1
  },
  "volume": {
    "baselineOrdersPerDay": 20,
    "monthlyGrowthPct": 25.89
  },
  "revenue": {
    "aov": 30
  },
  "costRates": {
    "cogsPct": 40,
    "adsPct": 20,
    "paymentFeePct": 20,
    "returnsPct": 0
  },
  "fixedOverhead": [
    {
      "label": "VPS hosting (WooCommerce)",
      "amount": 35
    },
    {
      "label": "Công cụ/subscription khác (email, analytics...)",
      "amount": 0
    }
  ],
  "oneTimeSetup": [
    {
      "label": "Đăng ký công ty tại Angola (INAPEM, pháp lý, công chứng)",
      "amount": 750,
      "month": 1
    },
    {
      "label": "Mở tài khoản ngân hàng doanh nghiệp Angola",
      "amount": 100,
      "month": 1
    },
    {
      "label": "Domain (.com / .co.ao, 1 năm)",
      "amount": 15,
      "month": 1
    }
  ],
  "headcount": [],
  "capital": {
    "cashConversionDays": 30,
    "maxAvailable": 10000,
    "shareholders": [
      {
        "name": "Hiếu",
        "contribution": 750,
        "equityPct": 50
      },
      {
        "name": "Tùng",
        "contribution": 750,
        "equityPct": 50
      }
    ]
  },
  "scenario": {
    "conservativeAdj": -50,
    "optimisticAdj": 50
  }
};
/* === DEFAULTS:END === */

/* Deep clone helper (tránh phụ thuộc structuredClone trên trình duyệt cũ) */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

let state = deepClone(DEFAULTS);
let currentScenario = "base"; // 'conservative' | 'base' | 'optimistic'
let currentCurrency = "usd"; // 'usd' | 'vnd' | 'aoa'

/* ---------------------------------------------------------------------------
   2. CALCULATION ENGINE
   --------------------------------------------------------------------------- */
function scenarioAdjustment(s, scenarioKey) {
  if (scenarioKey === "conservative") return s.scenario.conservativeAdj / 100;
  if (scenarioKey === "optimistic") return s.scenario.optimisticAdj / 100;
  return 0;
}

/* Đơn/ngày RAW (trước điều chỉnh kịch bản) cho 1 tháng tuyệt đối (1-12).
   Tháng 1 luôn = 0 (tháng dựng hạ tầng, không phụ thuộc scenario/growth).
   Tháng 2 = baseline. Tháng 3-12 = baseline x (1+growth)^(m-2), bậc thang theo tháng. */
function computeRawOrdersPerDay(s, month) {
  if (month <= 1) return 0;
  const base = Number(s.volume.baselineOrdersPerDay || 0);
  const g = Number(s.volume.monthlyGrowthPct || 0) / 100;
  return base * Math.pow(1 + g, month - 2);
}

function calcModel(s, scenarioKey) {
  const adj = scenarioAdjustment(s, scenarioKey);
  const fixedOverheadMonthly = s.fixedOverhead.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const headcountMonthly = s.headcount.reduce((sum, r) => sum + Number(r.count || 0) * Number(r.monthlyRate || 0), 0);
  const totalInvestment = (s.capital.shareholders || []).reduce((sum, r) => sum + Number(r.contribution || 0), 0);

  // Độ trễ vòng quay vốn, quy đổi ra số tháng nguyên gần nhất (model chạy
  // theo block tháng, không theo ngày thật) — mặc định 30 ngày = 1 tháng.
  const delayMonths = Math.max(0, Math.round(Number(s.capital.cashConversionDays || 0) / DAYS_PER_MONTH));

  const months = [];
  const revenueByMonth = {}; // m -> revenue, tra cứu lại khi tính tiền "về" TK chung
  let cashBalance = 0;
  let cashBalanceNoFunding = 0; // dòng tiền nếu KHÔNG góp vốn ban đầu — để lộ ra nhu cầu vốn thật
  let minCashNoFunding = 0;
  let minCashNoFundingMonth = 0;
  let cashInTransit = 0; // tiền đã thu ở TK nhận doanh thu (Angola) nhưng CHƯA về TK chung
  let cumulativeNetIncome = 0;

  for (let m = 1; m <= MONTHS_PER_YEAR; m++) {
    const rawOpd = computeRawOrdersPerDay(s, m);
    // Đơn/ngày luôn là số nguyên (đếm đơn hàng thật) — làm tròn 1 lần ở đây.
    const ordersPerDay = m <= 1 ? 0 : Math.max(0, Math.round(rawOpd * (1 + adj)));
    const orders = ordersPerDay * DAYS_PER_MONTH;
    const revenue = orders * Number(s.revenue.aov || 0);
    revenueByMonth[m] = revenue;

    const cogs = revenue * Number(s.costRates.cogsPct || 0) / 100;
    const ads = revenue * Number(s.costRates.adsPct || 0) / 100;
    const paymentFee = revenue * Number(s.costRates.paymentFeePct || 0) / 100;
    const returns = revenue * Number(s.costRates.returnsPct || 0) / 100;
    const variableCost = cogs + ads + paymentFee + returns;
    const grossProfit = revenue - variableCost;

    const oneTimeSetup = s.oneTimeSetup.reduce((sum, item) => sum + (Number(item.month) === m ? Number(item.amount || 0) : 0), 0);

    // EBITDA / Net income: LUÔN dồn tích (accrual) — ghi nhận theo tháng phát
    // sinh, KHÔNG phụ thuộc độ trễ chuyển tiền. Đây là số dùng cho P&L và
    // Retained Earnings trên Balance Sheet.
    const ebitda = grossProfit - fixedOverheadMonthly - headcountMonthly;
    const accrualNetIncome = ebitda - oneTimeSetup;

    // Dòng tiền THỰC TẾ: chi phí (COGS/ads/phí/overhead/nhân sự/setup) vẫn
    // phải trả ngay trong tháng phát sinh; tiền VÀO chỉ dùng được từ doanh
    // thu của `delayMonths` tháng trước (đã kịp "về" TK chung).
    const usableRevenueCash = m > delayMonths ? (revenueByMonth[m - delayMonths] || 0) : 0;
    const cashOutflow = variableCost + fixedOverheadMonthly + headcountMonthly + oneTimeSetup;
    const netCashMovement = usableRevenueCash - cashOutflow;

    cashBalance = (m === 1 ? totalInvestment : cashBalance) + netCashMovement;
    cashBalanceNoFunding = cashBalanceNoFunding + netCashMovement;
    if (cashBalanceNoFunding < minCashNoFunding) {
      minCashNoFunding = cashBalanceNoFunding;
      minCashNoFundingMonth = m;
    }
    cashInTransit = cashInTransit + revenue - usableRevenueCash; // luỹ kế tiền chưa "về" TK chung
    cumulativeNetIncome += accrualNetIncome; // dồn tích — không phụ thuộc độ trễ chuyển tiền

    const paidInCapital = totalInvestment;
    const retainedEarnings = cumulativeNetIncome;
    const totalEquity = paidInCapital + retainedEarnings;
    const totalLiabilities = 0;
    // Tài sản = tiền tại TK chung (đã tiêu được) + tiền đang trên đường về từ
    // TK nhận doanh thu. Không tồn kho (dropship), không AR khách hàng (trả
    // trước) — nhưng CÓ khoản tương đương AR nội bộ do độ trễ chuyển tiền.
    const totalAssets = cashBalance + cashInTransit;

    months.push({
      m, ordersPerDay, orders, revenue, cogs, ads, paymentFee, returns, variableCost, grossProfit,
      fixedOverheadMonthly, headcountMonthly, oneTimeSetup, ebitda, accrualNetIncome,
      usableRevenueCash, cashOutflow, netCashMovement, cashBalance, cashBalanceNoFunding, cashInTransit,
      paidInCapital, retainedEarnings, totalEquity, totalLiabilities, totalAssets
    });
  }

  function aggregate(monthsSlice) {
    const acc = monthsSlice.reduce((a, mo) => {
      a.orders += mo.orders;
      a.revenue += mo.revenue;
      a.cogs += mo.cogs;
      a.ads += mo.ads;
      a.paymentFee += mo.paymentFee;
      a.returns += mo.returns;
      a.variableCost += mo.variableCost;
      a.grossProfit += mo.grossProfit;
      a.fixedOverheadMonthly += mo.fixedOverheadMonthly;
      a.headcountMonthly += mo.headcountMonthly;
      a.oneTimeSetup += mo.oneTimeSetup;
      a.ebitda += mo.ebitda;
      a.accrualNetIncome += mo.accrualNetIncome;
      a.usableRevenueCash += mo.usableRevenueCash;
      a.cashOutflow += mo.cashOutflow;
      a.netCashMovement += mo.netCashMovement;
      return a;
    }, { orders: 0, revenue: 0, cogs: 0, ads: 0, paymentFee: 0, returns: 0, variableCost: 0, grossProfit: 0, fixedOverheadMonthly: 0, headcountMonthly: 0, oneTimeSetup: 0, ebitda: 0, accrualNetIncome: 0, usableRevenueCash: 0, cashOutflow: 0, netCashMovement: 0 });
    acc.endingCash = monthsSlice[monthsSlice.length - 1].cashBalance;
    acc.endingCashInTransit = monthsSlice[monthsSlice.length - 1].cashInTransit;
    acc.ebitdaMargin = acc.revenue !== 0 ? acc.ebitda / acc.revenue : 0;
    return acc;
  }

  const total = aggregate(months);

  return {
    months, total, minCashNoFunding, minCashNoFundingMonth,
    endOrdersPerDay: months[months.length - 1].ordersPerDay,
    totalInvestment, delayMonths
  };
}

/* Expose for console debugging / cross-check */
window.__angolaModel = { DEFAULTS, calcModel };
