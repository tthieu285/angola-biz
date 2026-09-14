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

   CHI PHÍ BIẾN ĐỔI: `variableCosts` cũng là bảng động (thêm/bớt/đổi tên tự
   do) — mỗi dòng là 1 khoản mục % doanh thu (COGS, Ads, phí thanh toán...).
   calcModel chỉ cộng tổng % của các dòng rồi tính 1 số variableCost duy
   nhất mỗi tháng — không còn field riêng cogs/ads/paymentFee/returns. Mỗi
   dòng có thêm cờ `ownOnly`: TRUE = chỉ ảnh hưởng doanh thu của mình (vd.
   Ads, nhập hàng — chi phí riêng của mình); FALSE = khoản mục "liên quan
   đến dòng tiền" nên áp DỤNG CHUNG lên cả doanh thu seller nữa (vd. phí
   thanh toán cổng — gateway tính phí trên MỌI giao dịch chạy qua, kể cả
   của seller), làm giảm tương ứng phần net remit trả seller.

   DỊCH VỤ HẠ TẦNG CHO SELLER (`sellerService`): mảng phụ, chạy song song
   mảng tự bán hàng — cho 1-3 seller khác dùng chung hạ tầng thanh toán/
   chuyển tiền, thu phí `feePct`% trên doanh thu của họ. Cơ chế (chốt với
   anh Hiếu 2026-09-14): mình thu hộ TOÀN BỘ doanh thu seller qua cùng cổng
   thanh toán (cùng bị độ trễ `cashConversionDays` y hệt mảng chính), dùng
   tiền đó ứng trả nhập hàng (COGS) NGAY khi phát sinh đơn (giống cách trả
   COGS của mảng chính — không chờ độ trễ), trừ phí dịch vụ (thu nhập của
   mình, cộng thẳng vào EBITDA) + trừ phần chi phí "dùng chung" ở mục C (áp
   cùng % như của mình, vd phí thanh toán), rồi CHUYỂN PHẦN CÒN LẠI cho
   seller — seller cũng chờ ~cùng độ trễ đó mới nhận được tiền (không có
   thêm độ trễ riêng).
   Vì mình cầm giữ hộ tiền seller trong lúc chờ, phát sinh khoản NỢ PHẢI TRẢ
   `sellerPayable` (tăng mỗi tháng theo doanh thu mới phát sinh, giảm khi
   thực chuyển tiền) — đây là lý do `totalLiabilities` không còn luôn = 0.
   Seller giả định hoạt động ỔN ĐỊNH (không tăng trưởng theo tháng) ngay từ
   Tháng 1 — khác với mảng chính (Tháng 1 = 0 đơn, tăng trưởng từ Tháng 2).
   Mỗi seller có AOV + % nhập hàng riêng (sản phẩm có thể khác nhau).
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
    "monthlyGrowthPct": 10
  },
  "revenue": {
    "aov": 30
  },
  "variableCosts": [
    {
      "label": "Giá vốn hàng bán (COGS)",
      "pct": 25,
      "ownOnly": true
    },
    {
      "label": "Quảng cáo (Ads)",
      "pct": 35,
      "ownOnly": true
    },
    {
      "label": "Phí AppyPay",
      "pct": 0.4,
      "ownOnly": false
    },
    {
      "label": "Phí EMIS/Multicaixa",
      "pct": 4,
      "ownOnly": false
    },
    {
      "label": "Phí chuyển tiền về VN",
      "pct": 2,
      "ownOnly": false
    }
  ],
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
  "headcount": [
    {
      "role": "Giám đốc",
      "count": 1,
      "monthlyRate": 1000
    },
    {
      "role": "Quản lý",
      "count": 1,
      "monthlyRate": 1000
    },
    {
      "role": "Fulfillment",
      "count": 1,
      "monthlyRate": 600
    },
    {
      "role": "CS",
      "count": 1,
      "monthlyRate": 600
    },
    {
      "role": "Lương Hiếu",
      "count": 1,
      "monthlyRate": 2000
    },
    {
      "role": "Lương Tùng",
      "count": 1,
      "monthlyRate": 2000
    },
    {
      "role": "Lương Hoàng",
      "count": 1,
      "monthlyRate": 2000
    }
  ],
  "capital": {
    "cashConversionDays": 7,
    "maxAvailable": 10000,
    "shareholders": [
      {
        "name": "Hiếu",
        "contribution": 1000,
        "equityPct": 34
      },
      {
        "name": "Tùng",
        "contribution": 1000,
        "equityPct": 33
      },
      {
        "name": "Hoàng",
        "contribution": 1000,
        "equityPct": 33
      }
    ]
  },
  "scenario": {
    "conservativeAdj": -50,
    "optimisticAdj": 50
  },
  "sellerService": {
    "feePct": 10,
    "sellers": [
      {
        "name": "Hải béo",
        "ordersPerDay": 50,
        "aov": 25,
        "cogsPct": 25
      }
    ]
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

/* Doanh thu/chi phí dịch vụ seller — ỔN ĐỊNH mỗi tháng (không tăng trưởng
   theo tháng, hoạt động đều từ Tháng 1), nên chỉ cần tính 1 LẦN, không phụ
   thuộc m. Vẫn áp điều chỉnh kịch bản (adj) như mảng chính, để kịch bản
   Conservative/Optimistic phản ánh đúng toàn bộ business chứ không chỉ
   mảng tự bán hàng. */
function computeSellerMonthlyAggregate(s, adj, sharedCostPct) {
  const sellers = (s.sellerService && s.sellerService.sellers) || [];
  const feePct = Number((s.sellerService && s.sellerService.feePct) || 0);
  let revenue = 0;
  let cogsCost = 0;
  sellers.forEach(sel => {
    const opd = Math.max(0, Math.round(Number(sel.ordersPerDay || 0) * (1 + adj)));
    const rev = opd * DAYS_PER_MONTH * Number(sel.aov || 0);
    revenue += rev;
    cogsCost += rev * Number(sel.cogsPct || 0) / 100;
  });
  const feeRevenue = revenue * feePct / 100;
  // Chi phí "dùng chung" (mục C, dòng không tick ownOnly) — áp cùng % như
  // của mình lên doanh thu seller (vd. phí cổng thanh toán tính trên MỌI
  // giao dịch chạy qua, kể cả của seller) — trừ luôn vào net remit trả seller.
  const sharedCost = revenue * Number(sharedCostPct || 0) / 100;
  const netRemit = revenue - cogsCost - sharedCost - feeRevenue;
  return { revenue, cogsCost, sharedCost, feeRevenue, netRemit };
}

function calcModel(s, scenarioKey) {
  const adj = scenarioAdjustment(s, scenarioKey);
  const fixedOverheadMonthly = s.fixedOverhead.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const headcountMonthly = s.headcount.reduce((sum, r) => sum + Number(r.count || 0) * Number(r.monthlyRate || 0), 0);
  const totalInvestment = (s.capital.shareholders || []).reduce((sum, r) => sum + Number(r.contribution || 0), 0);
  const variableCostPctTotal = (s.variableCosts || []).reduce((sum, r) => sum + Number(r.pct || 0), 0);
  // Chỉ các dòng KHÔNG tick "chỉ ảnh hưởng đến mình" (ownOnly=false) mới áp
  // dụng chung lên doanh thu seller — vd phí thanh toán, hoàn/huỷ đơn.
  const sharedVariableCostPctTotal = (s.variableCosts || []).reduce((sum, r) => sum + (r.ownOnly ? 0 : Number(r.pct || 0)), 0);
  const sellerAgg = computeSellerMonthlyAggregate(s, adj, sharedVariableCostPctTotal);

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
  let sellerPayable = 0; // luỹ kế tiền đang giữ hộ seller, CHƯA chuyển trả (nợ phải trả)

  for (let m = 1; m <= MONTHS_PER_YEAR; m++) {
    const rawOpd = computeRawOrdersPerDay(s, m);
    // Đơn/ngày luôn là số nguyên (đếm đơn hàng thật) — làm tròn 1 lần ở đây.
    const ordersPerDay = m <= 1 ? 0 : Math.max(0, Math.round(rawOpd * (1 + adj)));
    const orders = ordersPerDay * DAYS_PER_MONTH;
    const revenue = orders * Number(s.revenue.aov || 0);
    revenueByMonth[m] = revenue;

    const variableCost = revenue * variableCostPctTotal / 100;
    const grossProfit = revenue - variableCost;

    const oneTimeSetup = s.oneTimeSetup.reduce((sum, item) => sum + (Number(item.month) === m ? Number(item.amount || 0) : 0), 0);

    // EBITDA / Net income: LUÔN dồn tích (accrual) — ghi nhận theo tháng phát
    // sinh, KHÔNG phụ thuộc độ trễ chuyển tiền. Đây là số dùng cho P&L và
    // Retained Earnings trên Balance Sheet. Phí dịch vụ seller (thu nhập của
    // mình) cộng thẳng vào EBITDA — phần COGS/net remit của seller KHÔNG
    // phải doanh thu/chi phí của mình (chỉ là tiền giữ hộ), nên không vào đây.
    const sellerFeeRevenue = sellerAgg.feeRevenue;
    const ebitda = grossProfit + sellerFeeRevenue - fixedOverheadMonthly - headcountMonthly;
    const accrualNetIncome = ebitda - oneTimeSetup;

    // Dòng tiền THỰC TẾ: chi phí (variableCost/overhead/nhân sự/setup) vẫn
    // phải trả ngay trong tháng phát sinh; tiền VÀO chỉ dùng được từ doanh
    // thu của `delayMonths` tháng trước (đã kịp "về" TK chung) — áp dụng cho
    // CẢ doanh thu của mình lẫn doanh thu seller (cùng 1 cổng thanh toán,
    // cùng độ trễ). Doanh thu/net-remit seller ỔN ĐỊNH mỗi tháng nên tra cứu
    // lại tháng trước = chính nó (không cần mảng lookback riêng như revenue).
    const ownUsableRevenueCash = m > delayMonths ? (revenueByMonth[m - delayMonths] || 0) : 0;
    const sellerUsableRevenueCash = m > delayMonths ? sellerAgg.revenue : 0;
    const usableRevenueCash = ownUsableRevenueCash + sellerUsableRevenueCash;
    // COGS hộ seller: ứng trả NGAY khi phát sinh đơn (giống cách trả COGS của
    // mảng chính), KHÔNG chờ độ trễ. Net remit trả seller: CHỜ độ trễ y hệt
    // mảng chính (chỉ trả khi lô doanh thu tương ứng đã "về" TK chung).
    const sellerCogsCost = sellerAgg.cogsCost;
    // Chi phí dùng chung (phí cổng thanh toán...) áp lên doanh thu seller —
    // mình trả/khấu trừ NGAY (giống COGS hộ seller), không chờ độ trễ.
    const sellerSharedCost = sellerAgg.sharedCost;
    const sellerNetRemitPaid = m > delayMonths ? sellerAgg.netRemit : 0;
    const cashOutflow = variableCost + fixedOverheadMonthly + headcountMonthly + oneTimeSetup + sellerCogsCost + sellerSharedCost + sellerNetRemitPaid;
    const netCashMovement = usableRevenueCash - cashOutflow;

    cashBalance = (m === 1 ? totalInvestment : cashBalance) + netCashMovement;
    cashBalanceNoFunding = cashBalanceNoFunding + netCashMovement;
    if (cashBalanceNoFunding < minCashNoFunding) {
      minCashNoFunding = cashBalanceNoFunding;
      minCashNoFundingMonth = m;
    }
    const totalRevenueCollected = revenue + sellerAgg.revenue; // tổng tiền thu qua cổng thanh toán tháng này (của mình + hộ seller)
    cashInTransit = cashInTransit + totalRevenueCollected - usableRevenueCash; // luỹ kế tiền chưa "về" TK chung
    cumulativeNetIncome += accrualNetIncome; // dồn tích — không phụ thuộc độ trễ chuyển tiền
    // Nợ phải trả seller: tăng mỗi tháng theo net remit MỚI phát sinh (mình
    // đã nhận trách nhiệm trả ngay khi bán, dù tiền seller chưa "về"), giảm
    // khi THỰC CHUYỂN tiền cho seller (sellerNetRemitPaid).
    sellerPayable = sellerPayable + sellerAgg.netRemit - sellerNetRemitPaid;

    const paidInCapital = totalInvestment;
    const retainedEarnings = cumulativeNetIncome;
    const totalEquity = paidInCapital + retainedEarnings;
    const totalLiabilities = sellerPayable;
    // Tài sản = tiền tại TK chung (đã tiêu được) + tiền đang trên đường về từ
    // TK nhận doanh thu (của mình + hộ seller). Không tồn kho (dropship),
    // không AR khách hàng (trả trước) — nhưng CÓ khoản tương đương AR nội bộ
    // do độ trễ chuyển tiền, và CÓ nợ phải trả seller (totalLiabilities).
    const totalAssets = cashBalance + cashInTransit;

    months.push({
      m, ordersPerDay, orders, revenue, variableCost, grossProfit,
      sellerRevenue: sellerAgg.revenue, sellerCogsCost, sellerSharedCost, sellerFeeRevenue, sellerNetRemitPaid,
      fixedOverheadMonthly, headcountMonthly, oneTimeSetup, ebitda, accrualNetIncome,
      usableRevenueCash, cashOutflow, netCashMovement, cashBalance, cashBalanceNoFunding, cashInTransit,
      paidInCapital, retainedEarnings, totalEquity, totalLiabilities, totalAssets
    });
  }

  function aggregate(monthsSlice) {
    const acc = monthsSlice.reduce((a, mo) => {
      a.orders += mo.orders;
      a.revenue += mo.revenue;
      a.variableCost += mo.variableCost;
      a.grossProfit += mo.grossProfit;
      a.sellerRevenue += mo.sellerRevenue;
      a.sellerCogsCost += mo.sellerCogsCost;
      a.sellerSharedCost += mo.sellerSharedCost;
      a.sellerFeeRevenue += mo.sellerFeeRevenue;
      a.sellerNetRemitPaid += mo.sellerNetRemitPaid;
      a.fixedOverheadMonthly += mo.fixedOverheadMonthly;
      a.headcountMonthly += mo.headcountMonthly;
      a.oneTimeSetup += mo.oneTimeSetup;
      a.ebitda += mo.ebitda;
      a.accrualNetIncome += mo.accrualNetIncome;
      a.usableRevenueCash += mo.usableRevenueCash;
      a.cashOutflow += mo.cashOutflow;
      a.netCashMovement += mo.netCashMovement;
      return a;
    }, { orders: 0, revenue: 0, variableCost: 0, grossProfit: 0, sellerRevenue: 0, sellerCogsCost: 0, sellerSharedCost: 0, sellerFeeRevenue: 0, sellerNetRemitPaid: 0, fixedOverheadMonthly: 0, headcountMonthly: 0, oneTimeSetup: 0, ebitda: 0, accrualNetIncome: 0, usableRevenueCash: 0, cashOutflow: 0, netCashMovement: 0 });
    acc.endingCash = monthsSlice[monthsSlice.length - 1].cashBalance;
    acc.endingCashInTransit = monthsSlice[monthsSlice.length - 1].cashInTransit;
    // Tổng doanh thu "gộp" = doanh thu bán hàng của mình + doanh thu dịch vụ
    // (phí thu từ seller) — dùng cho dashboard/KPI để phản ánh ĐÚNG toàn bộ
    // doanh thu của business (bán hàng + dịch vụ), không chỉ riêng mảng bán hàng.
    acc.totalRevenueCombined = acc.revenue + acc.sellerFeeRevenue;
    acc.ebitdaMargin = acc.totalRevenueCombined !== 0 ? acc.ebitda / acc.totalRevenueCombined : 0;
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
