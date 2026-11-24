document.addEventListener("DOMContentLoaded", () => {
  // 공용 포맷 헬퍼
  const formatNumber = (val, suffix = "") => {
    if (val === null || val === undefined || Number.isNaN(val)) return "-";
    return `${Number(val).toLocaleString("ko-KR")}${suffix}`;
  };

  const formatMarketCap = (won) => {
    if (!won) return "-";
    const eok = Math.round(won / 100000000);
    const jo = Math.floor(eok / 10000);
    const restEok = eok % 10000;
    if (jo > 0) {
      return `${jo.toLocaleString("ko-KR")}조 ${restEok.toLocaleString("ko-KR")}억`;
    }
    return `${eok.toLocaleString("ko-KR")}억`;
  };

  const healthStatusEl = document.getElementById("healthStatus");

  // 서버 상태 점검 (/health)
  async function checkServerHealth() {
    if (!healthStatusEl) return;
    try {
      const res = await fetch("/health");
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        const s = data.services || {};
        const missing = [];
        if (!s.serper_api_configured) missing.push("Serper");
        if (!s.dify_analysis_configured) missing.push("Dify분석");
        if (!s.dify_technical_configured) missing.push("Dify지표");
        if (!s.dart_api_configured) missing.push("DART");

        if (missing.length === 0) {
          healthStatusEl.textContent = "서버 정상 (모든 API 연결됨)";
          healthStatusEl.className = "health-badge ok";
        } else {
          healthStatusEl.textContent = `일부 키 미설정 (${missing.join(", ")})`;
          healthStatusEl.className = "health-badge warn";
        }
      } else {
        throw new Error("헬스체크 응답 이상");
      }
    } catch (err) {
      console.error("[ERROR]      요청 또는 렌더링 중 오류 발생", err.message);
      healthStatusEl.textContent = "서버 연결 오류";
      healthStatusEl.className = "health-badge fail";
    }
  }

  checkServerHealth();

  // =========================================================================
  // A. 기존 1차 /test 수집기 테스트 페이지 로직 (test.html 전용)
  // =========================================================================
  const searchForm = document.getElementById("searchForm");
  if (searchForm) {
    console.log("[PAGE]    페이지 로드 완료 (/test 수집기)");
    const stockCodeInput = document.getElementById("stockCodeInput");
    const fetchBtn = document.getElementById("fetchBtn");
    const loadingBox = document.getElementById("loadingBox");
    const errorBox = document.getElementById("errorBox");
    const partialErrorBox = document.getElementById("partialErrorBox");
    const resultSection = document.getElementById("resultSection");

    const showTestError = (msg) => {
      errorBox.textContent = msg;
      errorBox.classList.remove("hidden");
    };

    const setTestLoading = (isLoading) => {
      fetchBtn.disabled = isLoading;
      stockCodeInput.disabled = isLoading;
      loadingBox.classList.toggle("hidden", !isLoading);
    };

    const renderTestResult = (data) => {
      const snap = data.snapshot || {};
      document.getElementById("stockName").textContent = data.name || "-";
      document.getElementById("stockCodeBadge").textContent = data.code || "-";
      document.getElementById("currentPrice").textContent = formatNumber(snap.current_price, "원");

      const changeBadge = document.getElementById("changeInfo");
      const rate = snap.change_rate;
      const diff = snap.change_price;
      if (rate !== null && rate !== undefined) {
        const sign = rate > 0 ? "▲" : rate < 0 ? "▼" : "";
        const plus = rate > 0 ? "+" : "";
        changeBadge.textContent = `${sign} ${formatNumber(Math.abs(diff), "원")} (${plus}${rate}%)`;
        changeBadge.className = `change-badge ${rate > 0 ? "up" : rate < 0 ? "down" : "flat"}`;
      } else {
        changeBadge.textContent = "-";
        changeBadge.className = "change-badge flat";
      }

      document.getElementById("range52").textContent =
        `${formatNumber(snap.high52, "원")} / ${formatNumber(snap.low52, "원")}`;
      document.getElementById("tradingVolume").textContent = formatNumber(snap.volume, "주");

      const metrics = [
        { label: "시가총액", value: formatMarketCap(snap.market_cap) },
        { label: "PER (주가수익비율)", value: formatNumber(snap.per, "배") },
        { label: "추정 PER", value: formatNumber(snap.forward_per, "배") },
        { label: "EPS (주당순이익)", value: formatNumber(snap.eps, "원") },
        { label: "추정 EPS", value: formatNumber(snap.forward_eps, "원") },
        { label: "PBR (주가순자산비율)", value: formatNumber(snap.pbr, "배") },
        { label: "BPS (주당순자산)", value: formatNumber(snap.bps, "원") },
        { label: "목표주가 (컨센서스)", value: formatNumber(snap.target_price, "원") },
        { label: "배당수익률", value: formatNumber(snap.dividend_yield, "%") },
        { label: "외인소진율", value: formatNumber(snap.foreign_rate, "%") },
      ];
      const metricsGrid = document.getElementById("metricsGrid");
      metricsGrid.innerHTML = "";
      metrics.forEach((m) => {
        const card = document.createElement("div");
        card.className = "metric-item";
        const l = document.createElement("div");
        l.className = "metric-label";
        l.textContent = m.label;
        const v = document.createElement("div");
        v.className = "metric-value";
        v.textContent = m.value;
        card.append(l, v);
        metricsGrid.appendChild(card);
      });

      const financialBody = document.getElementById("financialBody");
      financialBody.innerHTML = "";
      (data.financials || []).forEach((row) => {
        const tr = document.createElement("tr");
        if (row.is_consensus) tr.className = "consensus-row";
        const cells = [
          row.period || "-",
          row.is_consensus ? "추정(E)" : "확정",
          formatNumber(row.revenue),
          formatNumber(row.operating_income),
          formatNumber(row.operating_margin, "%"),
          formatNumber(row.roe, "%"),
          formatNumber(row.debt_ratio, "%"),
          formatNumber(row.operating_cash_flow),
        ];
        cells.forEach((val, idx) => {
          const td = document.createElement("td");
          if (idx === 1) {
            const b = document.createElement("span");
            b.className = row.is_consensus ? "badge-consensus" : "badge-actual";
            b.textContent = val;
            td.appendChild(b);
          } else {
            td.textContent = val;
          }
          tr.appendChild(td);
        });
        financialBody.appendChild(tr);
      });

      const newsList = document.getElementById("newsList");
      newsList.innerHTML = "";
      (data.news || []).forEach((item) => {
        const li = document.createElement("li");
        li.className = "news-item";
        const a = document.createElement("a");
        a.className = "news-title";
        a.href = item.link || "#";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = item.title || "제목 없음";
        const meta = document.createElement("div");
        meta.className = "news-meta";
        meta.textContent = `${item.source || "언론사"} · ${item.date || "날짜 미상"}`;
        li.append(a, meta);
        newsList.appendChild(li);
      });

      if ((data.errors || []).length > 0) {
        partialErrorBox.textContent =
          "일부 영역 수집 중 경고: " + data.errors.map((e) => `[${e.area}] ${e.message}`).join(" / ");
        partialErrorBox.classList.remove("hidden");
      } else {
        partialErrorBox.classList.add("hidden");
      }

      document.getElementById("rawJsonOutput").textContent = JSON.stringify(data, null, 2);
      resultSection.classList.remove("hidden");
    };

    const runTestFetch = async (code) => {
      const cleaned = code.trim();
      if (!/^\d{6}$/.test(cleaned)) {
        showTestError("종목코드는 6자리 숫자여야 합니다. (예: 000660)");
        return;
      }
      errorBox.classList.add("hidden");
      setTestLoading(true);
      try {
        const res = await fetch("/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: cleaned }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "요청 실패");
        renderTestResult(data);
      } catch (err) {
        showTestError(err.message);
      } finally {
        setTestLoading(false);
      }
    };

    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      runTestFetch(stockCodeInput.value);
    });
    document.querySelectorAll(".chip-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        stockCodeInput.value = btn.dataset.code;
        runTestFetch(btn.dataset.code);
      });
    });
    return;
  }

  // =========================================================================
  // B. 2차 3탭 메인 웹앱 로직 (index.html 전용)
  // =========================================================================
  console.log("[PAGE]       페이지 로드 및 탭 초기화 완료");

  // 1. 탭 전환
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
      tabPanels.forEach((p) => p.classList.toggle("active", p.id === target));
      console.log(`[TAB]        탭 전환 (${target})`);
    });
  });

  // 안전한 경량 마크다운 -> 보기 좋은 HTML 변환 (XSS 방지 이스케이프 포함)
  function setBotFormattedContent(bubble, rawText) {
    const escaped = String(rawText || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const applyInline = (line) =>
      line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/\[매수\s*우위\]/g, '<span class="stance-badge buy">매수 우위</span>')
        .replace(/\[매도(?:\(관망\))?\s*우위\]/g, '<span class="stance-badge sell">매도(관망) 우위</span>')
        .replace(/\[중립\]/g, '<span class="stance-badge neutral">중립</span>');

    const lines = escaped.split(/\r?\n/);
    const htmlParts = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        htmlParts.push('<div class="bot-spacer"></div>');
        continue;
      }
      if (/^[-*_]{3,}$/.test(line)) {
        htmlParts.push('<hr class="bot-divider" />');
        continue;
      }
      const headingMatch = line.match(/^#{1,4}\s+(.*)$/);
      if (headingMatch) {
        htmlParts.push(`<div class="bot-heading">${applyInline(headingMatch[1])}</div>`);
        continue;
      }
      const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
      if (bulletMatch) {
        htmlParts.push(`<div class="bot-bullet">• ${applyInline(bulletMatch[1])}</div>`);
        continue;
      }
      htmlParts.push(`<div class="bot-line">${applyInline(line)}</div>`);
    }

    bubble.innerHTML = htmlParts.join("");
  }

  // 채팅 말풍선 헬퍼
  function appendChatBubble(container, role, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-msg ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    if (role === "bot") {
      setBotFormattedContent(bubble, text);
    } else {
      bubble.textContent = text;
    }
    msgDiv.appendChild(bubble);
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  // -------------------------------------------------------------------------
  // 탭 1: 종목 심층분석 채팅 (Dify 일반 챗봇 ①)
  // -------------------------------------------------------------------------
  const t1SelectForm = document.getElementById("t1SelectForm");
  const t1CodeInput = document.getElementById("t1CodeInput");
  const t1AutocompleteList = document.getElementById("t1AutocompleteList");
  const t1AnalyzeBtn = document.getElementById("t1AnalyzeBtn");
  const t1LoadingBox = document.getElementById("t1LoadingBox");
  const t1ReportSection = document.getElementById("t1ReportSection");
  const t1MarketBar = document.getElementById("t1MarketBar");
  const t1TradingViewCard = document.getElementById("t1TradingViewCard");
  const t1TvTitle = document.getElementById("t1TvTitle");
  const t1TvOhlcvLegend = document.getElementById("t1TvOhlcvLegend");
  const t1TvChartContainer = document.getElementById("t1TvChartContainer");
  const t1TvNotice = document.getElementById("t1TvNotice");
  const t1TvSubchartsArea = document.getElementById("t1TvSubchartsArea");
  const tvTfBtns = document.querySelectorAll(".tv-tf-btn");
  const tvIndSearchInput = document.getElementById("tvIndSearchInput");
  const tvIndSearchList = document.getElementById("tvIndSearchList");
  const tvActiveIndTags = document.getElementById("tvActiveIndTags");
  const t1ContextBar = document.getElementById("t1ContextBar");
  const t1SummaryCard = document.getElementById("t1SummaryCard");
  const t1TechStrip = document.getElementById("t1TechStrip");
  const t1ChartsGrid = document.getElementById("t1ChartsGrid");
  const t1ReportBody = document.getElementById("t1ReportBody");
  const t1DisclosureCard = document.getElementById("t1DisclosureCard");
  const t1DisclosureBody = document.getElementById("t1DisclosureBody");
  const t1ErrorBox = document.getElementById("t1ErrorBox");
  const t1ChatMessages = document.getElementById("t1ChatMessages");
  const t1ChatForm = document.getElementById("t1ChatForm");
  const t1QuestionInput = document.getElementById("t1QuestionInput");
  const t1SendBtn = document.getElementById("t1SendBtn");
  const t1ResetBtn = document.getElementById("t1ResetBtn");
  const qqBtns = document.querySelectorAll(".qq-btn");

  let t1ConversationId = "";
  let t1LastCode = "";
  let t1PriceChartInst = null;
  let t1SecondChartInst = null;
  let t1TvChartInst = null;
  let t1TvSubChartInsts = [];
  let t1CurrentStockMeta = null;
  let t1CurrentChartData = null;
  let acTimer = null;
  const activeTvIndicators = new Set(["ma20", "ma60"]);

  const TV_INDICATOR_CATALOG = [
    // 메인 차트 오버레이 (14종)
    { id: "ma5", name: "MA5 (5일 이동평균)", keywords: "ma5 5일 이동평균 이평선", mode: "overlay" },
    { id: "ma20", name: "MA20 (20일 이동평균)", keywords: "ma20 20일 이동평균 이평선", mode: "overlay" },
    { id: "ma60", name: "MA60 (60일 이동평균)", keywords: "ma60 60일 이동평균 이평선", mode: "overlay" },
    { id: "ma120", name: "MA120 (120일 이동평균)", keywords: "ma120 120일 이동평균 장기이평선", mode: "overlay" },
    { id: "ema5", name: "EMA5 (5일 지수이동평균)", keywords: "ema5 지수이동평균", mode: "overlay" },
    { id: "ema20", name: "EMA20 (20일 지수이동평균)", keywords: "ema20 지수이동평균 exponential", mode: "overlay" },
    { id: "ema60", name: "EMA60 (60일 지수이동평균)", keywords: "ema60 지수이동평균", mode: "overlay" },
    { id: "ema120", name: "EMA120 (120일 지수이동평균)", keywords: "ema120 지수이동평균", mode: "overlay" },
    { id: "bb", name: "볼린저밴드 (20, 2)", keywords: "볼린저밴드 bollinger bb 밴드", mode: "overlay" },
    { id: "keltner", name: "켈트너 채널 (Keltner 20)", keywords: "켈트너 keltner 채널 밴드", mode: "overlay" },
    { id: "donchian", name: "돈치안 채널 (Donchian 20)", keywords: "돈치안 donchian 채널 터틀", mode: "overlay" },
    { id: "ichimoku", name: "일목균형표 (전환선/기준선)", keywords: "일목균형표 ichimoku 전환선 기준선", mode: "overlay" },
    { id: "psar", name: "Parabolic SAR (추세전환)", keywords: "psar parabolic sar 파라볼릭 추세", mode: "overlay" },
    { id: "vwap20", name: "VWAP (20일 거래량가중평균)", keywords: "vwap 거래량가중평균", mode: "overlay" },
    // 하단 보조 차트 (16종)
    { id: "rsi14", name: "RSI (14일 상대강도지수)", keywords: "rsi 14 상대강도 과매수 과매도", mode: "sub" },
    { id: "macd", name: "MACD (12, 26, 9)", keywords: "macd 오실레이터 시그널", mode: "sub" },
    { id: "stoch", name: "스토캐스틱 (%K / %D)", keywords: "스토캐스틱 stochastic slow k d", mode: "sub" },
    { id: "adx", name: "ADX (14일 추세강도 DI+/DI-)", keywords: "adx di+ di- 추세강도 dmi", mode: "sub" },
    { id: "aroon", name: "Aroon (25일 아룬 추세)", keywords: "aroon 아룬 추세", mode: "sub" },
    { id: "ao", name: "Awesome Oscillator (AO)", keywords: "ao awesome oscillator 모멘텀", mode: "sub" },
    { id: "cci20", name: "CCI (20일 상품채널지수)", keywords: "cci 20 상품채널", mode: "sub" },
    { id: "atr14", name: "ATR (14일 변동성 지표)", keywords: "atr 14 변동성 평균진폭", mode: "sub" },
    { id: "obv", name: "OBV (거래량 누적 지표)", keywords: "obv 거래량 누적 on balance volume", mode: "sub" },
    { id: "willr14", name: "Williams %R (14일)", keywords: "williams willr 윌리엄스", mode: "sub" },
    { id: "mfi14", name: "MFI (14일 자금흐름지수)", keywords: "mfi 14 자금흐름 money flow", mode: "sub" },
    { id: "roc", name: "ROC (12일 가격변화율 %)", keywords: "roc 변화율 rate of change", mode: "sub" },
    { id: "tsi", name: "TSI (진정강도지수)", keywords: "tsi true strength 진정강도", mode: "sub" },
    { id: "uo", name: "Ultimate Oscillator (UO)", keywords: "uo ultimate oscillator 궁극", mode: "sub" },
    { id: "cmf", name: "CMF (20일 차이킨 자금흐름)", keywords: "cmf chaikin 차이킨 자금흐름", mode: "sub" },
    { id: "vortex", name: "Vortex (VI+ / VI- 소용돌이)", keywords: "vortex vi+ vi- 소용돌이", mode: "sub" },
    { id: "kst", name: "KST Oscillator (추세모멘텀)", keywords: "kst know sure thing", mode: "sub" },
    { id: "fi", name: "Force Index (13일 세력지수)", keywords: "force index fi 세력지수", mode: "sub" },
  ];

  // 동적 맞춤 이평선(예: custom_ma_100, custom_ema_50) 메타 조회 헬퍼
  function getIndicatorMeta(id) {
    const found = TV_INDICATOR_CATALOG.find((x) => x.id === id);
    if (found) return found;
    const m = id.match(/^custom_(ma|ema)_(\d+)$/);
    if (m) {
      const kind = m[1].toUpperCase();
      const period = Number(m[2]);
      return { id, name: `${kind}${period} (${period}일 맞춤 이평)`, mode: "overlay", customKind: kind, period };
    }
    return null;
  }

  function computeCustomMaSeries(ohlcv, kind, period, dec) {
    if (!ohlcv || ohlcv.length < period) return [];
    const out = [];
    if (kind === "MA") {
      let sum = 0;
      for (let i = 0; i < ohlcv.length; i++) {
        sum += ohlcv[i].close;
        if (i >= period) sum -= ohlcv[i - period].close;
        if (i >= period - 1) {
          out.push({ time: ohlcv[i].time, value: Number((sum / period).toFixed(dec)) });
        }
      }
    } else {
      const k = 2 / (period + 1);
      let ema = ohlcv[0].close;
      for (let i = 0; i < ohlcv.length; i++) {
        ema = ohlcv[i].close * k + ema * (1 - k);
        out.push({ time: ohlcv[i].time, value: Number(ema.toFixed(dec)) });
      }
    }
    return out;
  }

  function resetTab1Chat(
    notice = "위에서 종목명이나 코드를 선택해 종합 분석 리포트를 먼저 확인하신 뒤, 리포트 내용 중 궁금한 점을 아래에서 자유롭게 질문해 주세요!"
  ) {
    t1ConversationId = "";
    t1LastCode = "";
    t1ChatMessages.innerHTML = "";
    appendChatBubble(t1ChatMessages, "bot", notice);
    t1ReportSection.classList.add("hidden");
    t1TradingViewCard.classList.add("hidden");
    t1ReportBody.innerHTML = "";
    t1ContextBar.classList.add("hidden");
    t1SummaryCard.classList.add("hidden");
    t1TechStrip.classList.add("hidden");
    t1ChartsGrid.classList.add("hidden");
    t1DisclosureCard.classList.add("hidden");
    t1ErrorBox.classList.add("hidden");
    t1AutocompleteList.classList.add("hidden");
  }

  function setTab1Busy(isBusy) {
    t1AnalyzeBtn.disabled = isBusy;
    t1SendBtn.disabled = isBusy;
    t1QuestionInput.disabled = isBusy;
    t1CodeInput.disabled = isBusy;
    qqBtns.forEach((b) => {
      b.disabled = isBusy;
    });
  }

  function formatPriceByCurrency(val, currency = "KRW") {
    if (val === null || val === undefined || Number.isNaN(val)) return "-";
    if (currency === "USD") {
      return `$${Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${Number(val).toLocaleString("ko-KR")}원`;
  }

  function renderTab1Summary(stockData) {
    const snap = stockData.snapshot || {};
    const isEtf = stockData.asset_type === "etf";
    const isUs = stockData.market_country === "US" || stockData.currency === "USD";
    const currency = isUs ? "USD" : "KRW";

    const badgeEl = document.getElementById("t1AssetBadge");
    if (isUs) {
      badgeEl.textContent = isEtf ? "미국 ETF" : "미국 주식";
      badgeEl.className = "asset-badge us";
    } else {
      badgeEl.textContent = isEtf ? "ETF" : "주식";
      badgeEl.className = `asset-badge ${isEtf ? "etf" : "stock"}`;
    }

    document.getElementById("t1SummaryName").textContent = `${stockData.name} (${stockData.code})`;
    document.getElementById("t1SummaryPrice").textContent = formatPriceByCurrency(snap.current_price, currency);

    const changeEl = document.getElementById("t1SummaryChange");
    const rate = snap.change_rate;
    if (rate !== null && rate !== undefined) {
      const sign = rate > 0 ? "▲" : rate < 0 ? "▼" : "";
      const plus = rate > 0 ? "+" : "";
      changeEl.textContent = `${sign} ${plus}${rate}%`;
      changeEl.className = `t1-summary-change ${rate > 0 ? "up" : rate < 0 ? "down" : "flat"}`;
    } else {
      changeEl.textContent = "-";
      changeEl.className = "t1-summary-change flat";
    }

    const pos = snap.position_52w;
    if (pos !== null && pos !== undefined) {
      document.getElementById("t1RangeLabel").textContent =
        `1년(52주) 중 현재 위치: ${pos}% (최저 ${formatPriceByCurrency(snap.low52, currency)} ~ 최고 ${formatPriceByCurrency(snap.high52, currency)})`;
      document.getElementById("t1RangeFill").style.width = `${pos}%`;
    } else {
      document.getElementById("t1RangeLabel").textContent = "52주 가격 위치 정보 없음";
      document.getElementById("t1RangeFill").style.width = "0%";
    }

    let cards = [];
    if (isUs) {
      const per = snap.per;
      const perHint =
        per === null || per === undefined
          ? "적자이거나 PER 정보 없음"
          : per < 15
            ? "미국 시장 평균 대비 저렴한 편"
            : per <= 30
              ? "글로벌 대형주 평균 수준"
              : "높은 미래 성장 기대감이 반영됨";

      const cur = snap.current_price;
      const tgt = snap.target_price;
      let upsideStr = "-";
      let upsideHint = "월가 목표주가 정보 없음";
      if (cur && tgt) {
        const up = (((tgt - cur) / cur) * 100).toFixed(1);
        upsideStr = `${formatPriceByCurrency(tgt, "USD")} (${up > 0 ? "+" : ""}${up}%)`;
        upsideHint = "월가 애널리스트 평균 목표주가";
      }

      cards = [
        { title: "가격 가성비 (PER / PBR)", val: `${formatNumber(per, "배")} / ${formatNumber(snap.pbr, "배")}`, hint: perHint },
        { title: "월가 목표주가", val: upsideStr, hint: upsideHint },
        { title: "시가총액 (기업 덩치)", val: snap.market_cap_display || formatMarketCap(snap.market_cap), hint: `${stockData.market || "미국 증시"} 상장` },
        { title: "1주당 순이익 / 배당", val: `${formatPriceByCurrency(snap.eps, "USD")} / ${snap.dividend_yield ?? "-"}%`, hint: `BPS ${formatPriceByCurrency(snap.bps, "USD")}` },
      ];
    } else if (isEtf) {
      const etf = snap.etf_info || {};
      const dev = etf.deviation_rate;
      const devHint =
        dev === null || dev === undefined
          ? "실제 가치와 비교 정보"
          : Math.abs(dev) < 0.3
            ? "실제 가치(NAV)와 거의 같은 정가 거래 중"
            : dev < 0
              ? "실제 가치보다 약간 싸게 거래 중"
              : "실제 가치보다 약간 비싸게 거래 중";
      cards = [
        {
          title: "무엇을 따라가나요? (기초지수)",
          val: etf.base_index || "-",
          hint: `운용사: ${etf.issuer || "-"}`,
        },
        {
          title: "제값에 사나요? (NAV / 괴리율)",
          val: `${formatNumber(etf.nav, "원")} (${dev ?? "-"}%)`,
          hint: devHint,
        },
        {
          title: "1년 수수료 (총보수)",
          val: etf.total_fee !== null && etf.total_fee !== undefined ? `연 ${etf.total_fee}%` : "-",
          hint: "1,000만원 투자 시 연 약 " + (etf.total_fee ? `${Math.round(etf.total_fee * 100000).toLocaleString("ko-KR")}원` : "-"),
        },
        {
          title: "최근 1년 수익률 / 분배금",
          val: `${etf.return_1y ?? "-"}% / 연 ${snap.dividend_yield ?? "-"}%`,
          hint: `1개월 ${etf.return_1m ?? "-"}% · 3개월 ${etf.return_3m ?? "-"}%`,
        },
      ];
    } else {
      const per = snap.per;
      const perHint =
        per === null || per === undefined
          ? "적자 상태이거나 계산 불가"
          : per < 10
            ? `버는 돈 대비 싼 편 (추정 ${snap.forward_per ?? "-"}배)`
            : per <= 20
              ? `적정한 가격대 (추정 ${snap.forward_per ?? "-"}배)`
              : `미래 성장 기대감이 큰 편 (추정 ${snap.forward_per ?? "-"}배)`;

      const cur = snap.current_price;
      const tgt = snap.target_price;
      let upsideStr = "-";
      let upsideHint = "증권사 목표가 정보 없음";
      if (cur && tgt) {
        const up = (((tgt - cur) / cur) * 100).toFixed(1);
        upsideStr = `${formatNumber(tgt, "원")} (${up > 0 ? "+" : ""}${up}%)`;
        upsideHint = "최근 3개월 증권사 전문가 평균 눈높이";
      }

      const actualFins = (stockData.financials || []).filter((f) => !f.is_consensus);
      const latestFin = actualFins.length > 0 ? actualFins[actualFins.length - 1] : null;
      const debt = latestFin ? latestFin.debt_ratio : null;
      const debtHint =
        debt === null || debt === undefined
          ? "재무제표 확인 필요"
          : debt < 100
            ? `${latestFin.period} 기준 빚이 적어 매우 튼튼함`
            : debt < 200
              ? `${latestFin.period} 기준 무난한 수준`
              : `${latestFin.period} 기준 빚 비율이 다소 높음`;

      const trend = snap.investor_trend;
      let trendVal = `외국인 보유 ${snap.foreign_rate ?? "-"}%`;
      let trendHint = "최근 외국인·기관 수급 정보 없음";
      if (trend) {
        const fSign = trend.foreigner > 0 ? "순매수" : trend.foreigner < 0 ? "순매도" : "보합";
        const oSign = trend.organ > 0 ? "순매수" : trend.organ < 0 ? "순매도" : "보합";
        trendVal = `외국인 ${fSign} / 기관 ${oSign}`;
        trendHint = `${trend.date} 기준 외국인 ${formatNumber(trend.foreigner, "주")}`;
      }

      cards = [
        { title: "가격 가성비 (PER)", val: formatNumber(per, "배"), hint: perHint },
        { title: "전문가 목표주가", val: upsideStr, hint: upsideHint },
        { title: "회사 빚 안전성 (부채비율)", val: debt !== null ? `${debt}%` : "-", hint: debtHint },
        { title: "큰손 수급 동향", val: trendVal, hint: trendHint },
      ];
    }

    const gridEl = document.getElementById("t1BeginnerCards");
    gridEl.innerHTML = "";
    cards.forEach((c) => {
      const div = document.createElement("div");
      div.className = "beginner-item";
      const t = document.createElement("div");
      t.className = "beginner-title";
      t.textContent = c.title;
      const v = document.createElement("div");
      v.className = "beginner-val";
      v.textContent = c.val;
      const h = document.createElement("div");
      h.className = "beginner-hint";
      h.textContent = c.hint;
      div.append(t, v, h);
      gridEl.appendChild(div);
    });

    t1SummaryCard.classList.remove("hidden");

    // 시장 환경 바 (코스피, 코스닥, 원/달러)
    const env = stockData.market_env || {};
    const envParts = [];
    if (env.kospi) envParts.push(`코스피 ${formatNumber(env.kospi.value)} (${env.kospi.change_rate > 0 ? "+" : ""}${env.kospi.change_rate}%)`);
    if (env.kosdaq) envParts.push(`코스닥 ${formatNumber(env.kosdaq.value)} (${env.kosdaq.change_rate > 0 ? "+" : ""}${env.kosdaq.change_rate}%)`);
    if (env.usdkrw) envParts.push(`원/달러 ${formatNumber(env.usdkrw.value)}원`);
    t1MarketBar.textContent = envParts.join(" · ");

    // 기술지표 미니 배지 스트립 (RSI, 볼린저 위치%, 20일선, MACD)
    const tech = stockData.technical || {};
    if (tech.rsi14 !== undefined) {
      const pills = [
        `RSI(14) <strong>${tech.rsi14}</strong>`,
        `볼린저 위치 <strong>${tech.bb_position_pct ?? "-"}%</strong>`,
        `20일선 <strong>${formatPriceByCurrency(tech.ma20, currency)}</strong>`,
        `MACD <strong>${formatNumber(tech.macd)}</strong>`,
      ];
      t1TechStrip.innerHTML = pills.map((p) => `<span class="tech-pill">${p}</span>`).join("");
      t1TechStrip.classList.remove("hidden");
    } else {
      t1TechStrip.classList.add("hidden");
    }

    renderTab1Charts(stockData);
    renderTab1Disclosures(stockData);
    renderTradingViewChart(stockData);
  }

  function renderActiveIndicatorTags() {
    tvActiveIndTags.innerHTML = "";
    activeTvIndicators.forEach((id) => {
      const meta = getIndicatorMeta(id);
      if (!meta) return;
      const tag = document.createElement("span");
      tag.className = `tv-ind-tag ${meta.mode === "sub" ? "sub" : ""}`;
      tag.textContent = meta.name;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tv-tag-remove";
      btn.textContent = "×";
      btn.title = "지표 제거";
      btn.addEventListener("click", () => {
        activeTvIndicators.delete(id);
        renderActiveIndicatorTags();
        if (t1CurrentChartData) drawTvChartFromData(t1CurrentChartData);
      });

      tag.appendChild(btn);
      tvActiveIndTags.appendChild(tag);
    });
  }

  function renderTradingViewChart(stockData) {
    const fallbackSeries = stockData.tech_series || {};
    const tvChart = stockData.tv_chart;
    if (!window.LightweightCharts || (!tvChart && !(fallbackSeries.ohlcv || []).length)) {
      t1TradingViewCard.classList.add("hidden");
      return;
    }

    const isUs = stockData.market_country === "US" || stockData.currency === "USD";
    t1CurrentStockMeta = {
      code: stockData.code,
      name: stockData.name,
      isUs,
      currency: isUs ? "USD" : "KRW",
    };

    if (tvChart && tvChart.ohlcv?.length) {
      t1CurrentChartData = tvChart;
    } else {
      const dates = fallbackSeries.dates || [];
      const buildPairs = (arr) =>
        dates
          .map((t, i) => (arr && arr[i] !== null && arr[i] !== undefined ? { time: t, value: arr[i] } : null))
          .filter(Boolean);
      t1CurrentChartData = {
        code: stockData.code,
        timeframe: "day",
        is_minute: false,
        is_foreign: isUs,
        ohlcv: (fallbackSeries.ohlcv || []).map((d) => ({ ...d, label: d.time })),
        ma5: buildPairs(fallbackSeries.ma5),
        ma20: buildPairs(fallbackSeries.ma20),
        ma60: buildPairs(fallbackSeries.ma60),
        bb_upper: buildPairs(fallbackSeries.bb_upper),
        bb_lower: buildPairs(fallbackSeries.bb_lower),
        rsi14: buildPairs(fallbackSeries.rsi14),
        macd: buildPairs(fallbackSeries.macd),
        macd_signal: buildPairs(fallbackSeries.macd_signal),
        macd_hist: buildPairs(fallbackSeries.macd_hist),
      };
    }

    tvTfBtns.forEach((b) => b.classList.toggle("active", b.dataset.tf === "day"));
    t1TvNotice.classList.add("hidden");
    t1TradingViewCard.classList.remove("hidden");
    renderActiveIndicatorTags();
    drawTvChartFromData(t1CurrentChartData);
  }

  function drawTvChartFromData(chartData) {
    if (!window.LightweightCharts || !chartData || !chartData.ohlcv || chartData.ohlcv.length === 0) {
      return;
    }

    const meta = t1CurrentStockMeta || {
      code: chartData.code,
      name: chartData.code,
      isUs: chartData.is_foreign,
      currency: chartData.is_foreign ? "USD" : "KRW",
    };
    const isUs = meta.isUs;
    const currency = meta.currency;
    const ohlcv = chartData.ohlcv;

    t1TvTitle.textContent = `📈 ${meta.name} (${meta.code}) 실시간 캔들 · 거래량 차트 (${chartData.timeframe})`;

    if (t1TvChartInst) { t1TvChartInst.remove(); t1TvChartInst = null; }
    t1TvSubChartInsts.forEach((inst) => inst.remove());
    t1TvSubChartInsts = [];

    t1TvChartContainer.innerHTML = "";
    t1TvSubchartsArea.innerHTML = "";

    const chartWidth = t1TvChartContainer.clientWidth || 800;
    const chart = LightweightCharts.createChart(t1TvChartContainer, {
      width: chartWidth,
      height: 360,
      layout: { background: { color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#cbd5e1" },
      timeScale: { borderColor: "#cbd5e1", timeVisible: Boolean(chartData.is_minute), secondsVisible: false },
    });
    t1TvChartInst = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#ef4444",
      downColor: "#3b82f6",
      borderUpColor: "#ef4444",
      borderDownColor: "#3b82f6",
      wickUpColor: "#ef4444",
      wickDownColor: "#3b82f6",
      priceFormat: isUs
        ? { type: "price", precision: 2, minMove: 0.01 }
        : { type: "price", precision: 0, minMove: 1 },
    });
    candleSeries.setData(ohlcv.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));

    // 활성화된 오버레이 지표 렌더링
    const overlayLines = [
      { id: "ma5", key: "ma5", color: "#ec4899", title: "MA5" },
      { id: "ma20", key: "ma20", color: "#f59e0b", title: "MA20" },
      { id: "ma60", key: "ma60", color: "#10b981", title: "MA60" },
      { id: "ma120", key: "ma120", color: "#6366f1", title: "MA120" },
      { id: "ema5", key: "ema5", color: "#f43f5e", title: "EMA5" },
      { id: "ema20", key: "ema20", color: "#06b6d4", title: "EMA20" },
      { id: "ema60", key: "ema60", color: "#14b8a6", title: "EMA60" },
      { id: "ema120", key: "ema120", color: "#8b5cf6", title: "EMA120" },
      { id: "vwap20", key: "vwap20", color: "#a855f7", title: "VWAP20" },
    ];
    overlayLines.forEach((cfg) => {
      if (activeTvIndicators.has(cfg.id) && chartData[cfg.key]?.length) {
        chart.addLineSeries({ color: cfg.color, lineWidth: 1.5, title: cfg.title }).setData(chartData[cfg.key]);
      }
    });

    // 동적 맞춤 이평선 (예: custom_ma_100, custom_ema_50)
    const customColors = ["#e11d48", "#0284c7", "#059669", "#d97706", "#7c3aed"];
    let customColorIdx = 0;
    activeTvIndicators.forEach((id) => {
      const m = getIndicatorMeta(id);
      if (m && m.customKind) {
        const seriesData = computeCustomMaSeries(ohlcv, m.customKind, m.period, isUs ? 2 : 0);
        if (seriesData.length) {
          const color = customColors[customColorIdx++ % customColors.length];
          chart.addLineSeries({ color, lineWidth: 1.6, title: `${m.customKind}${m.period}` }).setData(seriesData);
        }
      }
    });

    if (activeTvIndicators.has("bb") && chartData.bb_upper?.length && chartData.bb_lower?.length) {
      chart.addLineSeries({ color: "#64748b", lineWidth: 1, lineStyle: 2, title: "BB상단" }).setData(chartData.bb_upper);
      chart.addLineSeries({ color: "#64748b", lineWidth: 1, lineStyle: 2, title: "BB하단" }).setData(chartData.bb_lower);
    }

    if (activeTvIndicators.has("keltner") && chartData.kc_high?.length && chartData.kc_low?.length) {
      chart.addLineSeries({ color: "#0284c7", lineWidth: 1, lineStyle: 2, title: "KC상단" }).setData(chartData.kc_high);
      chart.addLineSeries({ color: "#0284c7", lineWidth: 1, lineStyle: 2, title: "KC하단" }).setData(chartData.kc_low);
    }

    if (activeTvIndicators.has("donchian") && chartData.dc_high?.length && chartData.dc_low?.length) {
      chart.addLineSeries({ color: "#16a34a", lineWidth: 1, lineStyle: 2, title: "DC상단" }).setData(chartData.dc_high);
      chart.addLineSeries({ color: "#16a34a", lineWidth: 1, lineStyle: 2, title: "DC하단" }).setData(chartData.dc_low);
    }

    if (activeTvIndicators.has("ichimoku") && chartData.ichi_conv?.length && chartData.ichi_base?.length) {
      chart.addLineSeries({ color: "#ef4444", lineWidth: 1.4, title: "전환선" }).setData(chartData.ichi_conv);
      chart.addLineSeries({ color: "#2563eb", lineWidth: 1.4, title: "기준선" }).setData(chartData.ichi_base);
    }

    if (activeTvIndicators.has("psar") && chartData.psar?.length) {
      chart.addLineSeries({
        color: "#f97316",
        lineWidth: 0,
        pointMarkersVisible: true,
        pointMarkersRadius: 2.5,
        title: "PSAR",
      }).setData(chartData.psar);
    }

    // 하단 거래량 히스토그램
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeries.setData(
      ohlcv.map((d) => ({
        time: d.time,
        value: d.volume,
        color: d.close >= d.open ? "rgba(239, 68, 68, 0.35)" : "rgba(59, 130, 246, 0.35)",
      }))
    );

    const labelMap = new Map(ohlcv.map((d) => [d.time, d.label || d.time]));
    const last = ohlcv[ohlcv.length - 1];
    const updateLegend = (bar, vol) => {
      if (!bar) return;
      const dateLabel = labelMap.get(bar.time) || bar.time;
      t1TvOhlcvLegend.textContent =
        `${dateLabel} | 시 ${formatPriceByCurrency(bar.open, currency)} · 고 ${formatPriceByCurrency(bar.high, currency)} · ` +
        `저 ${formatPriceByCurrency(bar.low, currency)} · 종 ${formatPriceByCurrency(bar.close, currency)} | 거래량 ${formatNumber(vol)}`;
    };
    updateLegend(last, last.volume);

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time) {
        updateLegend(last, last.volume);
        return;
      }
      const cData = param.seriesData.get(candleSeries);
      const vData = param.seriesData.get(volumeSeries);
      if (cData) {
        updateLegend({ ...cData, time: param.time }, vData ? vData.value : 0);
      }
    });
    chart.timeScale().fitContent();

    // 동적 보조 차트 생성 헬퍼
    const createSubChart = (label, buildFn) => {
      const wrap = document.createElement("div");
      wrap.className = "tv-subchart-wrap";
      const lbl = document.createElement("div");
      lbl.className = "tv-subchart-label";
      lbl.textContent = label;
      const box = document.createElement("div");
      box.className = "tv-subchart-container";
      wrap.append(lbl, box);
      t1TvSubchartsArea.appendChild(wrap);

      const sub = LightweightCharts.createChart(box, {
        width: chartWidth,
        height: 130,
        layout: { background: { color: "#ffffff" }, textColor: "#475569" },
        grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
        timeScale: { borderColor: "#cbd5e1", timeVisible: Boolean(chartData.is_minute) },
      });
      buildFn(sub);
      sub.timeScale().fitContent();
      t1TvSubChartInsts.push(sub);
    };

    if (activeTvIndicators.has("rsi14") && chartData.rsi14?.length) {
      createSubChart("RSI (14일)", (sub) => {
        sub.addLineSeries({ color: "#8b5cf6", lineWidth: 2, title: "RSI14" }).setData(chartData.rsi14);
      });
    }
    if (activeTvIndicators.has("macd") && chartData.macd?.length) {
      createSubChart("MACD (12, 26, 9)", (sub) => {
        sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8, title: "MACD" }).setData(chartData.macd);
        if (chartData.macd_signal?.length) {
          sub.addLineSeries({ color: "#ef4444", lineWidth: 1.5, title: "Signal" }).setData(chartData.macd_signal);
        }
        if (chartData.macd_hist?.length) {
          sub.addHistogramSeries({ title: "Hist" }).setData(
            chartData.macd_hist.map((d) => ({
              time: d.time,
              value: d.value,
              color: d.value >= 0 ? "rgba(239, 68, 68, 0.45)" : "rgba(59, 130, 246, 0.45)",
            }))
          );
        }
      });
    }
    if (activeTvIndicators.has("stoch") && chartData.stoch_k?.length) {
      createSubChart("스토캐스틱 (%K / %D)", (sub) => {
        sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8, title: "%K" }).setData(chartData.stoch_k);
        if (chartData.stoch_d?.length) {
          sub.addLineSeries({ color: "#f59e0b", lineWidth: 1.5, title: "%D" }).setData(chartData.stoch_d);
        }
      });
    }
    if (activeTvIndicators.has("cci20") && chartData.cci20?.length) {
      createSubChart("CCI (20일)", (sub) => {
        sub.addLineSeries({ color: "#0ea5e9", lineWidth: 1.8, title: "CCI20" }).setData(chartData.cci20);
      });
    }
    if (activeTvIndicators.has("atr14") && chartData.atr14?.length) {
      createSubChart("ATR (14일 변동성)", (sub) => {
        sub.addLineSeries({ color: "#f97316", lineWidth: 1.8, title: "ATR14" }).setData(chartData.atr14);
      });
    }
    if (activeTvIndicators.has("obv") && chartData.obv?.length) {
      createSubChart("OBV (거래량 누적)", (sub) => {
        sub.addLineSeries({ color: "#14b8a6", lineWidth: 1.8, title: "OBV" }).setData(chartData.obv);
      });
    }
    if (activeTvIndicators.has("willr14") && chartData.willr14?.length) {
      createSubChart("Williams %R (14일)", (sub) => {
        sub.addLineSeries({ color: "#e11d48", lineWidth: 1.8, title: "WillR" }).setData(chartData.willr14);
      });
    }
    if (activeTvIndicators.has("mfi14") && chartData.mfi14?.length) {
      createSubChart("MFI (14일 자금흐름지수)", (sub) => {
        sub.addLineSeries({ color: "#10b981", lineWidth: 1.8, title: "MFI14" }).setData(chartData.mfi14);
      });
    }
    if (activeTvIndicators.has("adx") && chartData.adx?.length) {
      createSubChart("ADX (14일 추세강도 · DI+/DI-)", (sub) => {
        sub.addLineSeries({ color: "#0f172a", lineWidth: 2, title: "ADX" }).setData(chartData.adx);
        if (chartData.adx_pos?.length) sub.addLineSeries({ color: "#16a34a", lineWidth: 1.3, title: "DI+" }).setData(chartData.adx_pos);
        if (chartData.adx_neg?.length) sub.addLineSeries({ color: "#dc2626", lineWidth: 1.3, title: "DI-" }).setData(chartData.adx_neg);
      });
    }
    if (activeTvIndicators.has("aroon") && chartData.aroon_up?.length) {
      createSubChart("Aroon (25일 아룬 추세)", (sub) => {
        sub.addLineSeries({ color: "#16a34a", lineWidth: 1.6, title: "Up" }).setData(chartData.aroon_up);
        if (chartData.aroon_down?.length) sub.addLineSeries({ color: "#dc2626", lineWidth: 1.6, title: "Down" }).setData(chartData.aroon_down);
      });
    }
    if (activeTvIndicators.has("ao") && chartData.ao?.length) {
      createSubChart("Awesome Oscillator (AO)", (sub) => {
        sub.addHistogramSeries({ title: "AO" }).setData(
          chartData.ao.map((d) => ({
            time: d.time,
            value: d.value,
            color: d.value >= 0 ? "rgba(22, 163, 74, 0.7)" : "rgba(220, 38, 38, 0.7)",
          }))
        );
      });
    }
    if (activeTvIndicators.has("roc") && chartData.roc?.length) {
      createSubChart("ROC (12일 가격변화율 %)", (sub) => {
        sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8, title: "ROC" }).setData(chartData.roc);
      });
    }
    if (activeTvIndicators.has("tsi") && chartData.tsi?.length) {
      createSubChart("TSI (진정강도지수)", (sub) => {
        sub.addLineSeries({ color: "#7c3aed", lineWidth: 1.8, title: "TSI" }).setData(chartData.tsi);
      });
    }
    if (activeTvIndicators.has("uo") && chartData.uo?.length) {
      createSubChart("Ultimate Oscillator (UO)", (sub) => {
        sub.addLineSeries({ color: "#0284c7", lineWidth: 1.8, title: "UO" }).setData(chartData.uo);
      });
    }
    if (activeTvIndicators.has("cmf") && chartData.cmf?.length) {
      createSubChart("CMF (20일 차이킨 자금흐름)", (sub) => {
        sub.addLineSeries({ color: "#059669", lineWidth: 1.8, title: "CMF" }).setData(chartData.cmf);
      });
    }
    if (activeTvIndicators.has("vortex") && chartData.vi_pos?.length) {
      createSubChart("Vortex (VI+ / VI-)", (sub) => {
        sub.addLineSeries({ color: "#16a34a", lineWidth: 1.6, title: "VI+" }).setData(chartData.vi_pos);
        if (chartData.vi_neg?.length) sub.addLineSeries({ color: "#dc2626", lineWidth: 1.6, title: "VI-" }).setData(chartData.vi_neg);
      });
    }
    if (activeTvIndicators.has("kst") && chartData.kst?.length) {
      createSubChart("KST Oscillator", (sub) => {
        sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8, title: "KST" }).setData(chartData.kst);
        if (chartData.kst_sig?.length) sub.addLineSeries({ color: "#ef4444", lineWidth: 1.4, title: "Signal" }).setData(chartData.kst_sig);
      });
    }
    if (activeTvIndicators.has("fi") && chartData.fi?.length) {
      createSubChart("Force Index (13일 세력지수)", (sub) => {
        sub.addLineSeries({ color: "#d97706", lineWidth: 1.8, title: "FI" }).setData(chartData.fi);
      });
    }
  }

  // 타임프레임 버튼 클릭 (1분/5분/10분/30분/60분/일봉/주봉/월봉)
  tvTfBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!t1CurrentStockMeta?.code) return;
      const tf = btn.dataset.tf;
      tvTfBtns.forEach((b) => b.classList.toggle("active", b === btn));
      t1TvNotice.classList.add("hidden");

      try {
        const res = await fetch("/api/chart/naver", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: t1CurrentStockMeta.code, timeframe: tf }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "차트 조회 실패");
        t1CurrentChartData = data;
        drawTvChartFromData(data);
      } catch (err) {
        t1TvNotice.textContent = `안내: ${err.message}`;
        t1TvNotice.classList.remove("hidden");
      }
    });
  });

  // 실시간 지표 검색/추가 드롭다운 (30종+ 및 맞춤 MA/EMA N일 지원)
  function showIndicatorSuggestions(queryText) {
    const q = (queryText || "").trim().toLowerCase();
    const matches = TV_INDICATOR_CATALOG.filter((item) => {
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.keywords.includes(q);
    });

    // 예: "ma 100", "ma100", "ema 50" 입력 시 동적 맞춤 이평선 제안
    const customCandidates = [];
    const customMatch = q.match(/^(ma|ema)\s*(\d{1,3})$/);
    if (customMatch) {
      const kind = customMatch[1].toLowerCase();
      const period = Number(customMatch[2]);
      if (period >= 2 && period <= 200) {
        const customId = `custom_${kind}_${period}`;
        if (!TV_INDICATOR_CATALOG.some((x) => x.id === `${kind}${period}`)) {
          customCandidates.push({
            id: customId,
            name: `${kind.toUpperCase()}${period} (${period}일 맞춤 이평선 추가)`,
            mode: "overlay",
          });
        }
      }
    }

    const finalList = [...customCandidates, ...matches];
    tvIndSearchList.innerHTML = "";
    if (finalList.length === 0) {
      tvIndSearchList.classList.add("hidden");
      return;
    }

    finalList.forEach((item) => {
      const li = document.createElement("li");
      li.className = "autocomplete-item";
      const isAdded = activeTvIndicators.has(item.id);
      const areaLabel = item.mode === "overlay" ? "메인차트" : "보조차트";
      li.innerHTML = `<span class="ac-name">${item.name}</span><span class="ac-meta">${isAdded ? "추가됨 ✓" : areaLabel}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        activeTvIndicators.add(item.id);
        tvIndSearchInput.value = "";
        tvIndSearchList.classList.add("hidden");
        renderActiveIndicatorTags();
        if (t1CurrentChartData) drawTvChartFromData(t1CurrentChartData);
      });
      tvIndSearchList.appendChild(li);
    });
    tvIndSearchList.classList.remove("hidden");
  }

  tvIndSearchInput.addEventListener("focus", () => showIndicatorSuggestions(tvIndSearchInput.value));
  tvIndSearchInput.addEventListener("input", () => showIndicatorSuggestions(tvIndSearchInput.value));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tv-ind-search-wrap")) {
      tvIndSearchList.classList.add("hidden");
    }
  });

  function renderTab1Disclosures(stockData) {
    const list = stockData.disclosures || [];
    if (list.length === 0) {
      t1DisclosureCard.classList.add("hidden");
      return;
    }

    t1DisclosureBody.innerHTML = "";
    list.forEach((item) => {
      const tr = document.createElement("tr");

      const tdDate = document.createElement("td");
      tdDate.textContent = item.date || "-";

      const tdCat = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "disc-badge";
      badge.textContent = item.category || "공시";
      tdCat.appendChild(badge);

      const tdTitle = document.createElement("td");
      if (item.url) {
        const a = document.createElement("a");
        a.className = "disc-link";
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = `${item.title} ↗`;
        tdTitle.appendChild(a);
      } else {
        tdTitle.textContent = item.title || "-";
      }

      const tdSub = document.createElement("td");
      tdSub.textContent = item.submitter || "-";

      tr.append(tdDate, tdCat, tdTitle, tdSub);
      t1DisclosureBody.appendChild(tr);
    });

    t1DisclosureCard.classList.remove("hidden");
  }

  function renderTab1Charts(stockData) {
    const s = stockData.tech_series || {};
    const hasPriceSeries = Array.isArray(s.dates) && s.dates.length > 0;
    const isEtf = stockData.asset_type === "etf";
    const isUs = stockData.market_country === "US" || stockData.currency === "USD";

    if (!hasPriceSeries) {
      t1ChartsGrid.classList.add("hidden");
      return;
    }

    // 1) 좌측 차트: 최근 60일 주가 · MA20 · MA60 · 볼린저밴드
    if (t1PriceChartInst) t1PriceChartInst.destroy();
    t1PriceChartInst = new Chart(document.getElementById("t1PriceChart"), {
      type: "line",
      data: {
        labels: s.dates,
        datasets: [
          { label: "종가", data: s.close, borderColor: "#0f172a", borderWidth: 2, pointRadius: 0 },
          { label: "20일선", data: s.ma20, borderColor: "#2563eb", borderWidth: 1.5, pointRadius: 0 },
          { label: "60일선", data: s.ma60, borderColor: "#10b981", borderWidth: 1.5, pointRadius: 0 },
          { label: "볼린저 상단", data: s.bb_upper, borderColor: "#94a3b8", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
          { label: "볼린저 하단", data: s.bb_lower, borderColor: "#94a3b8", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { ticks: { maxTicksLimit: 6 } } },
      },
    });

    // 2) 우측 차트: 일반 주식은 연간 매출/영업이익, ETF는 기간별 수익률
    if (t1SecondChartInst) t1SecondChartInst.destroy();
    const secondTitleEl = document.getElementById("t1SecondChartTitle");

    if (isUs) {
      const snap = stockData.snapshot || {};
      secondTitleEl.textContent = "📊 52주 최저 · 현재가 · 목표주가 · 52주 최고 (USD)";
      const labels = ["52주 최저", "현재가", "월가 목표가", "52주 최고"];
      const vals = [snap.low52 ?? 0, snap.current_price ?? 0, snap.target_price ?? 0, snap.high52 ?? 0];
      const colors = ["#94a3b8", "#2563eb", "#10b981", "#ef4444"];
      t1SecondChartInst = new Chart(document.getElementById("t1SecondChart"), {
        type: "bar",
        data: {
          labels,
          datasets: [{ label: "가격 ($)", data: vals, backgroundColor: colors, borderRadius: 6 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: (v) => `$${v}` } } },
        },
      });
    } else if (isEtf) {
      const etf = (stockData.snapshot || {}).etf_info || {};
      secondTitleEl.textContent = "📊 기간별 수익률 비교 (%)";
      const labels = ["1개월", "3개월", "6개월", "1년"];
      const vals = [etf.return_1m ?? 0, etf.return_3m ?? 0, etf.return_6m ?? 0, etf.return_1y ?? 0];
      const colors = vals.map((v) => (v >= 0 ? "rgba(220, 38, 38, 0.78)" : "rgba(37, 99, 235, 0.78)"));
      t1SecondChartInst = new Chart(document.getElementById("t1SecondChart"), {
        type: "bar",
        data: {
          labels,
          datasets: [{ label: "수익률 (%)", data: vals, backgroundColor: colors, borderRadius: 6 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: (v) => `${v}%` } } },
        },
      });
    } else {
      secondTitleEl.textContent = "📊 연간 매출액 · 영업이익 추이 (억원, *추정 포함)";
      const fins = (stockData.financials || []).slice(-6);
      const labels = fins.map((f) => (f.is_consensus ? `${f.period}(E)` : f.period));
      const revenues = fins.map((f) => f.revenue ?? null);
      const opIncomes = fins.map((f) => f.operating_income ?? null);
      const revColors = fins.map((f) => (f.is_consensus ? "rgba(245, 158, 11, 0.7)" : "rgba(37, 99, 235, 0.8)"));
      const opColors = fins.map((f) => (f.is_consensus ? "rgba(251, 191, 36, 0.85)" : "rgba(16, 185, 129, 0.85)"));

      t1SecondChartInst = new Chart(document.getElementById("t1SecondChart"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "매출액", data: revenues, backgroundColor: revColors, borderRadius: 4 },
            { label: "영업이익", data: opIncomes, backgroundColor: opColors, borderRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        },
      });
    }

    t1ChartsGrid.classList.remove("hidden");
  }

  async function sendTab1Request(rawInput, question = "", isInitial = false) {
    const codeOrName = (rawInput || "").trim();
    if (!codeOrName) {
      t1ErrorBox.textContent = "종목명 또는 6자리 종목코드를 입력해 주세요. (예: 삼성전자, 000660)";
      t1ErrorBox.classList.remove("hidden");
      return;
    }

    t1AutocompleteList.classList.add("hidden");
    t1ErrorBox.classList.add("hidden");

    if (isInitial || (t1LastCode && t1LastCode !== codeOrName)) {
      t1ConversationId = "";
      if (isInitial) {
        t1ChatMessages.innerHTML = "";
        t1ReportSection.classList.add("hidden");
        t1TradingViewCard.classList.add("hidden");
        t1ReportBody.innerHTML = "";
        t1ContextBar.classList.add("hidden");
        t1SummaryCard.classList.add("hidden");
        t1TechStrip.classList.add("hidden");
        t1ChartsGrid.classList.add("hidden");
        t1DisclosureCard.classList.add("hidden");
      }
    }

    let thinkingBubble = null;
    if (isInitial) {
      t1LoadingBox.classList.remove("hidden");
    } else {
      appendChatBubble(t1ChatMessages, "user", `[${t1LastCode || codeOrName}] ${question}`);
      thinkingBubble = appendChatBubble(t1ChatMessages, "bot", "분석된 데이터를 바탕으로 후속 질문 답변 작성 중...");
    }

    setTab1Busy(true);
    console.log(`[CHAT]       Dify 챗봇 요청 시작 (tab1, input=${codeOrName}, initial=${isInitial})`);

    try {
      const res = await fetch("/api/chat/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: codeOrName,
          question,
          conversation_id: t1ConversationId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 요청에 실패했습니다.");

      t1ConversationId = data.conversation_id || t1ConversationId;
      const resolvedCode = data.stock_data?.code || codeOrName;
      t1LastCode = resolvedCode;
      if (data.stock_data?.code) {
        t1CodeInput.value = resolvedCode;
      }

      if (isInitial) {
        setBotFormattedContent(t1ReportBody, data.answer || "응답이 비어 있습니다.");
        t1ReportSection.classList.remove("hidden");
        appendChatBubble(
          t1ChatMessages,
          "bot",
          `${data.stock_data?.name || resolvedCode} 종합 분석 리포트가 위 패널에 완성되었습니다! 리포트 내용 중 궁금한 점을 아래 추천 버튼이나 입력창으로 질문해 주세요.`
        );
      } else if (thinkingBubble) {
        setBotFormattedContent(thinkingBubble, data.answer || "응답이 비어 있습니다.");
        t1ChatMessages.scrollTop = t1ChatMessages.scrollHeight;
      }

      if (data.stock_data) {
        const s = data.stock_data.snapshot || {};
        if (data.stock_data.market_country === "US") {
          t1ContextBar.textContent =
            `수집 근거 반영됨: ${data.stock_data.name} (${resolvedCode}, 미국) · 현재가 ${formatPriceByCurrency(s.current_price, "USD")} · ` +
            `PER ${formatNumber(s.per, "배")} · PBR ${formatNumber(s.pbr, "배")} · 뉴스 ${(data.stock_data.news || []).length}건`;
        } else if (data.stock_data.asset_type === "etf") {
          const etf = s.etf_info || {};
          t1ContextBar.textContent =
            `수집 근거 반영됨: ${data.stock_data.name} (${resolvedCode}, ETF) · 현재가 ${formatNumber(s.current_price, "원")} · ` +
            `기초지수 ${etf.base_index || "-"} · 총보수 ${etf.total_fee ?? "-"}% · 뉴스 ${(data.stock_data.news || []).length}건`;
        } else {
          t1ContextBar.textContent =
            `수집 근거 반영됨: ${data.stock_data.name} (${resolvedCode}) · 현재가 ${formatNumber(s.current_price, "원")} · ` +
            `PER ${formatNumber(s.per, "배")} · PBR ${formatNumber(s.pbr, "배")} · 뉴스 ${(data.stock_data.news || []).length}건`;
        }
        t1ContextBar.classList.remove("hidden");
        renderTab1Summary(data.stock_data);
      }
    } catch (err) {
      if (thinkingBubble) thinkingBubble.textContent = `오류: ${err.message}`;
      t1ErrorBox.textContent = err.message;
      t1ErrorBox.classList.remove("hidden");
      console.error(`[ERROR]      요청 또는 렌더링 중 오류 발생 (${err.message})`);
    } finally {
      t1LoadingBox.classList.add("hidden");
      setTab1Busy(false);
      t1QuestionInput.focus();
    }
  }

  t1ResetBtn.addEventListener("click", () => resetTab1Chat());

  // 0) 종목명/코드 자동완성
  t1CodeInput.addEventListener("input", () => {
    const q = t1CodeInput.value.trim();
    if (acTimer) clearTimeout(acTimer);
    if (!q || /^\d{6}$/.test(q)) {
      t1AutocompleteList.classList.add("hidden");
      return;
    }

    acTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const items = data.results || [];
        t1AutocompleteList.innerHTML = "";
        if (items.length === 0) {
          t1AutocompleteList.classList.add("hidden");
          return;
        }
        items.forEach((item) => {
          const li = document.createElement("li");
          li.className = "autocomplete-item";
          li.innerHTML = `<span class="ac-name">${item.name}</span><span class="ac-meta">${item.code} · ${item.type}</span>`;
          li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            t1CodeInput.value = item.code;
            t1AutocompleteList.classList.add("hidden");
            sendTab1Request(item.code, "", true);
          });
          t1AutocompleteList.appendChild(li);
        });
        t1AutocompleteList.classList.remove("hidden");
      } catch (err) {
        t1AutocompleteList.classList.add("hidden");
      }
    }, 150);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrap")) {
      t1AutocompleteList.classList.add("hidden");
    }
  });

  // 1) 종목 분석 시작 버튼 또는 코드/이름 입력 후 엔터 -> 즉시 1차 종합 분석 실행
  t1SelectForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendTab1Request(t1CodeInput.value.trim(), "", true);
  });

  // 2) 빠른 종목 버튼 클릭 -> 코드 채우고 즉시 1차 종합 분석 실행
  document.querySelectorAll(".t1-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.code;
      t1CodeInput.value = code;
      sendTab1Request(code, "", true);
    });
  });

  // 3) 하단 후속 질문 폼
  t1ChatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = t1CodeInput.value.trim();
    const question = t1QuestionInput.value.trim();
    if (!question) return;
    t1QuestionInput.value = "";
    sendTab1Request(code, question, !t1ConversationId);
  });

  // 4) 초보자용 원클릭 추천 질문 버튼
  qqBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = t1CodeInput.value.trim();
      const question = btn.dataset.q;
      if (!question) return;
      sendTab1Request(code, question, !t1ConversationId);
    });
  });

  // -------------------------------------------------------------------------
  // 탭 2: 리밸런싱 도우미 (Dify 없음 · 순수 Python 계산)
  // -------------------------------------------------------------------------
  const t2Form = document.getElementById("t2Form");
  const t2CodesInput = document.getElementById("t2CodesInput");
  const t2RunBtn = document.getElementById("t2RunBtn");
  const t2LoadingBox = document.getElementById("t2LoadingBox");
  const t2ErrorBox = document.getElementById("t2ErrorBox");
  const t2ResultArea = document.getElementById("t2ResultArea");

  let weightChartInstance = null;
  let frontierChartInstance = null;

  document.querySelectorAll(".t2-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      t2CodesInput.value = btn.dataset.codes;
    });
  });

  t2Form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rawCodes = t2CodesInput.value.trim();
    if (!rawCodes) return;

    t2ErrorBox.classList.add("hidden");
    t2LoadingBox.classList.remove("hidden");
    t2RunBtn.disabled = true;

    console.log(`[REBALANCE]  리밸런싱 시뮬레이션 요청 시작 (${rawCodes})`);

    try {
      const res = await fetch("/api/rebalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: rawCodes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "리밸런싱 계산 실패");

      const assetNameMap = {};
      (data.assets || []).forEach((a) => {
        assetNameMap[a.code] = a.name || a.code;
      });

      // 최대 샤프지수 통계
      const ms = data.max_sharpe;
      document.getElementById("t2MaxSharpeStats").innerHTML = `
        <div class="stat-pill">기대수익률<strong>${ms.expected_return_pct}%</strong></div>
        <div class="stat-pill">연율화 변동성<strong>${ms.volatility_pct}%</strong></div>
        <div class="stat-pill">샤프지수<strong>${ms.sharpe_ratio}</strong></div>
        <div class="stat-pill">과거 MDD<strong>${ms.mdd_pct}%</strong></div>
      `;

      // 최소 변동성 통계 & 비중 리스트
      const mv = data.min_volatility;
      document.getElementById("t2MinVolStats").innerHTML = `
        <div class="stat-pill">기대수익률<strong>${mv.expected_return_pct}%</strong></div>
        <div class="stat-pill">연율화 변동성<strong>${mv.volatility_pct}%</strong></div>
        <div class="stat-pill">샤프지수<strong>${mv.sharpe_ratio}</strong></div>
        <div class="stat-pill">과거 MDD<strong>${mv.mdd_pct}%</strong></div>
      `;

      const minVolWeightsEl = document.getElementById("t2MinVolWeights");
      minVolWeightsEl.innerHTML = "";
      Object.entries(mv.weights_pct).forEach(([code, pct]) => {
        const row = document.createElement("div");
        row.className = "weight-row";
        row.innerHTML = `<span>${assetNameMap[code]} (${code})</span><strong>${pct}%</strong>`;
        minVolWeightsEl.appendChild(row);
      });

      // 도넛 차트 (최대 샤프지수 비중)
      if (weightChartInstance) weightChartInstance.destroy();
      const weightLabels = Object.keys(ms.weights_pct).map((c) => `${assetNameMap[c]} (${c})`);
      const weightValues = Object.values(ms.weights_pct);
      weightChartInstance = new Chart(document.getElementById("t2WeightChart"), {
        type: "doughnut",
        data: {
          labels: weightLabels,
          datasets: [{
            data: weightValues,
            backgroundColor: ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"],
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right" },
          },
        },
      });

      // 효율적 프론티어 산점도
      if (frontierChartInstance) frontierChartInstance.destroy();
      frontierChartInstance = new Chart(document.getElementById("t2FrontierChart"), {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "시뮬레이션 포트폴리오",
              data: data.frontier_points || [],
              backgroundColor: "rgba(37, 99, 235, 0.35)",
              pointRadius: 3,
            },
            {
              label: "최대 샤프지수",
              data: [{ x: ms.volatility_pct, y: ms.expected_return_pct }],
              backgroundColor: "#dc2626",
              pointRadius: 8,
            },
            {
              label: "최소 변동성",
              data: [{ x: mv.volatility_pct, y: mv.expected_return_pct }],
              backgroundColor: "#16a34a",
              pointRadius: 8,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: "연율화 변동성 (%)" } },
            y: { title: { display: true, text: "기대수익률 (%)" } },
          },
        },
      });

      // 개별 종목 성과 테이블
      const tbody = document.getElementById("t2AssetsBody");
      tbody.innerHTML = "";
      (data.assets || []).forEach((a) => {
        const tr = document.createElement("tr");
        [
          a.name,
          a.code,
          formatNumber(a.latest_close, "원"),
          `${a.total_return_pct}%`,
          `${a.annual_volatility_pct}%`,
          `${a.mdd_pct}%`,
        ].forEach((val) => {
          const td = document.createElement("td");
          td.textContent = val;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      t2ResultArea.classList.remove("hidden");
      console.log("[REBALANCE]  리밸런싱 시뮬레이션 결과 수신 및 차트 렌더링 완료");
    } catch (err) {
      t2ErrorBox.textContent = err.message;
      t2ErrorBox.classList.remove("hidden");
      console.error(`[ERROR]      요청 또는 렌더링 중 오류 발생 (${err.message})`);
    } finally {
      t2LoadingBox.classList.add("hidden");
      t2RunBtn.disabled = false;
    }
  });

  // -------------------------------------------------------------------------
  // 탭 3: 기술지표 차트 + 지표해석기 채팅 (FDR + Dify 일반 챗봇 ②)
  // -------------------------------------------------------------------------
  const t3ChartForm = document.getElementById("t3ChartForm");
  const t3CodeInput = document.getElementById("t3CodeInput");
  const t3CalcBtn = document.getElementById("t3CalcBtn");
  const t3LoadingBox = document.getElementById("t3LoadingBox");
  const t3ErrorBox = document.getElementById("t3ErrorBox");
  const t3ContentArea = document.getElementById("t3ContentArea");
  const t3ChatForm = document.getElementById("t3ChatForm");
  const t3QuestionInput = document.getElementById("t3QuestionInput");
  const t3SendBtn = document.getElementById("t3SendBtn");
  const t3ChatMessages = document.getElementById("t3ChatMessages");
  const t3ResetBtn = document.getElementById("t3ResetBtn");

  let t3LatestData = null;
  let t3StockName = "";
  let t3CurrentCode = "";
  let t3ConversationId = "";
  let priceChartInst = null;
  let rsiChartInst = null;
  let macdChartInst = null;

  t3ResetBtn.addEventListener("click", () => {
    t3ConversationId = "";
    t3ChatMessages.innerHTML = "";
    appendChatBubble(
      t3ChatMessages,
      "bot",
      "지표해석기 대화가 초기화되었습니다. 계산된 지표를 바탕으로 궁금한 점을 질문해 주세요."
    );
  });

  t3ChartForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = t3CodeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      t3ErrorBox.textContent = "종목코드는 6자리 숫자여야 합니다. (예: 000660)";
      t3ErrorBox.classList.remove("hidden");
      return;
    }

    t3ErrorBox.classList.add("hidden");
    t3LoadingBox.classList.remove("hidden");
    t3CalcBtn.disabled = true;

    try {
      const res = await fetch("/api/technical/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "기술지표 계산 실패");

      t3LatestData = data.latest;
      t3StockName = data.name || code;
      if (t3CurrentCode !== code) {
        t3ConversationId = "";
        t3CurrentCode = code;
      }

      document.getElementById("t3StockHeader").textContent =
        `${t3StockName} (${code}) 최신 기술지표 (${data.latest.date} 기준)`;

      const l = data.latest;
      const summaryItems = [
        { label: "종가", value: formatNumber(l.close, "원") },
        { label: "20일 이동평균", value: formatNumber(l.ma20, "원") },
        { label: "60일 이동평균", value: formatNumber(l.ma60, "원") },
        { label: "볼린저 상단", value: formatNumber(l.bb_upper, "원") },
        { label: "볼린저 하단", value: formatNumber(l.bb_lower, "원") },
        { label: "RSI (14일)", value: l.rsi14 ?? "-" },
        { label: "MACD", value: formatNumber(l.macd) },
        { label: "MACD Signal", value: formatNumber(l.macd_signal) },
      ];

      const t3Grid = document.getElementById("t3LatestGrid");
      t3Grid.innerHTML = "";
      summaryItems.forEach((item) => {
        const div = document.createElement("div");
        div.className = "metric-item";
        div.innerHTML = `<div class="metric-label">${item.label}</div><div class="metric-value">${item.value}</div>`;
        t3Grid.appendChild(div);
      });

      const s = data.series;
      if (priceChartInst) priceChartInst.destroy();
      priceChartInst = new Chart(document.getElementById("t3PriceChart"), {
        type: "line",
        data: {
          labels: s.dates,
          datasets: [
            { label: "종가", data: s.close, borderColor: "#0f172a", borderWidth: 2, pointRadius: 0 },
            { label: "MA5", data: s.ma5, borderColor: "#f59e0b", borderWidth: 1.5, pointRadius: 0 },
            { label: "MA20", data: s.ma20, borderColor: "#2563eb", borderWidth: 1.5, pointRadius: 0 },
            { label: "MA60", data: s.ma60, borderColor: "#10b981", borderWidth: 1.5, pointRadius: 0 },
            { label: "볼린저 상단", data: s.bb_upper, borderColor: "#94a3b8", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
            { label: "볼린저 하단", data: s.bb_lower, borderColor: "#94a3b8", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });

      if (rsiChartInst) rsiChartInst.destroy();
      rsiChartInst = new Chart(document.getElementById("t3RsiChart"), {
        type: "line",
        data: {
          labels: s.dates,
          datasets: [
            { label: "RSI(14)", data: s.rsi14, borderColor: "#8b5cf6", borderWidth: 2, pointRadius: 0 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { min: 0, max: 100 } },
        },
      });

      if (macdChartInst) macdChartInst.destroy();
      macdChartInst = new Chart(document.getElementById("t3MacdChart"), {
        type: "line",
        data: {
          labels: s.dates,
          datasets: [
            { label: "MACD", data: s.macd, borderColor: "#2563eb", borderWidth: 2, pointRadius: 0 },
            { label: "Signal", data: s.macd_signal, borderColor: "#ef4444", borderWidth: 1.5, pointRadius: 0 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });

      t3ContentArea.classList.remove("hidden");
      console.log(`[TECH]       기술지표 차트 계산 및 렌더링 완료 (code=${code})`);
    } catch (err) {
      t3ErrorBox.textContent = err.message;
      t3ErrorBox.classList.remove("hidden");
      console.error(`[ERROR]      요청 또는 렌더링 중 오류 발생 (${err.message})`);
    } finally {
      t3LoadingBox.classList.add("hidden");
      t3CalcBtn.disabled = false;
    }
  });

  t3ChatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = t3QuestionInput.value.trim();
    if (!question || !t3CurrentCode) return;

    appendChatBubble(t3ChatMessages, "user", question);
    t3QuestionInput.value = "";
    const thinkingBubble = appendChatBubble(t3ChatMessages, "bot", "계산된 지표를 바탕으로 설명 생성 중...");

    t3SendBtn.disabled = true;
    t3QuestionInput.disabled = true;
    console.log(`[CHAT]       Dify 챗봇 요청 시작 (tab3, code=${t3CurrentCode})`);

    try {
      const res = await fetch("/api/technical/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: t3CurrentCode,
          name: t3StockName,
          latest: t3LatestData,
          question,
          conversation_id: t3ConversationId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "지표해석기 호출 실패");

      t3ConversationId = data.conversation_id || t3ConversationId;
      setBotFormattedContent(thinkingBubble, data.answer || "응답이 비어 있습니다.");
      t3ChatMessages.scrollTop = t3ChatMessages.scrollHeight;
    } catch (err) {
      thinkingBubble.textContent = `오류: ${err.message}`;
      console.error(`[ERROR]      요청 또는 렌더링 중 오류 발생 (${err.message})`);
    } finally {
      t3SendBtn.disabled = false;
      t3QuestionInput.disabled = false;
      t3QuestionInput.focus();
    }
  });

  // -------------------------------------------------------------------------
  // 탭 4: 코인 종합 분석 (업비트 + 공포·탐욕 + 김치프리미엄 + 32종+ 차트 + Dify ①)
  // -------------------------------------------------------------------------
  const t4SelectForm = document.getElementById("t4SelectForm");
  const t4MarketInput = document.getElementById("t4MarketInput");
  const t4AutocompleteList = document.getElementById("t4AutocompleteList");
  const t4AnalyzeBtn = document.getElementById("t4AnalyzeBtn");
  const t4LoadingBox = document.getElementById("t4LoadingBox");
  const t4ErrorBox = document.getElementById("t4ErrorBox");
  const t4ReportSection = document.getElementById("t4ReportSection");
  const t4MarketBar = document.getElementById("t4MarketBar");
  const t4TradingViewCard = document.getElementById("t4TradingViewCard");
  const t4TvTitle = document.getElementById("t4TvTitle");
  const t4TvOhlcvLegend = document.getElementById("t4TvOhlcvLegend");
  const t4TvChartContainer = document.getElementById("t4TvChartContainer");
  const t4TvNotice = document.getElementById("t4TvNotice");
  const t4TvSubchartsArea = document.getElementById("t4TvSubchartsArea");
  const t4TfBtns = document.querySelectorAll(".t4-tf-btn");
  const t4MktBtns = document.querySelectorAll(".t4-mkt-btn");
  const t4IndSearchInput = document.getElementById("t4IndSearchInput");
  const t4IndSearchList = document.getElementById("t4IndSearchList");
  const t4ActiveIndTags = document.getElementById("t4ActiveIndTags");
  const t4ContextBar = document.getElementById("t4ContextBar");
  const t4SummaryCard = document.getElementById("t4SummaryCard");
  const t4ReportBody = document.getElementById("t4ReportBody");
  const t4ChatMessages = document.getElementById("t4ChatMessages");
  const t4ChatForm = document.getElementById("t4ChatForm");
  const t4QuestionInput = document.getElementById("t4QuestionInput");
  const t4SendBtn = document.getElementById("t4SendBtn");
  const t4ResetBtn = document.getElementById("t4ResetBtn");
  const t4QqBtns = document.querySelectorAll(".t4-qq-btn");

  let t4ConversationId = "";
  let t4LastMarket = "";
  let t4CurrentMeta = null;
  let t4CurrentChartData = null;
  let t4CurrentTf = "day";
  let t4CurrentMarketType = "spot";
  let t4TvChartInst = null;
  let t4TvSubChartInsts = [];
  let t4AcTimer = null;
  const activeT4Indicators = new Set(["ma20", "ma60"]);

  function formatUsdPrice(val, dec = 2) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    return "$" + Number(val).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function formatUsdCompact(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    const n = Number(val);
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  }

  function resetTab4Chat(
    notice = "위에서 코인을 선택해 실시간 차트와 종합 리포트를 확인하신 뒤, 궁금한 점을 아래에서 질문해 주세요!"
  ) {
    t4ConversationId = "";
    t4LastMarket = "";
    t4ChatMessages.innerHTML = "";
    appendChatBubble(t4ChatMessages, "bot", notice);
    t4ReportSection.classList.add("hidden");
    t4TradingViewCard.classList.add("hidden");
    t4ReportBody.innerHTML = "";
    t4ContextBar.classList.add("hidden");
    t4SummaryCard.classList.add("hidden");
    document.getElementById("t4LiquidationCard")?.classList.add("hidden");
    document.getElementById("t4UsMacroCard")?.classList.add("hidden");
    t4ErrorBox.classList.add("hidden");
    t4AutocompleteList.classList.add("hidden");
  }

  function setTab4Busy(isBusy) {
    t4AnalyzeBtn.disabled = isBusy;
    t4SendBtn.disabled = isBusy;
    t4QuestionInput.disabled = isBusy;
    t4MarketInput.disabled = isBusy;
    t4QqBtns.forEach((b) => { b.disabled = isBusy; });
  }

  function renderT4ActiveTags() {
    t4ActiveIndTags.innerHTML = "";
    activeT4Indicators.forEach((id) => {
      const meta = getIndicatorMeta(id);
      if (!meta) return;
      const tag = document.createElement("span");
      tag.className = `tv-ind-tag ${meta.mode === "sub" ? "sub" : ""}`;
      tag.textContent = meta.name;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tv-tag-remove";
      btn.textContent = "×";
      btn.addEventListener("click", () => {
        activeT4Indicators.delete(id);
        renderT4ActiveTags();
        if (t4CurrentChartData) drawT4TvChart(t4CurrentChartData);
      });
      tag.appendChild(btn);
      t4ActiveIndTags.appendChild(tag);
    });
  }

  function drawT4TvChart(chartData) {
    if (!window.LightweightCharts || !chartData || !chartData.ohlcv || chartData.ohlcv.length === 0) return;

    const meta = t4CurrentMeta || { market: chartData.usdt_symbol || chartData.code, name: chartData.korean_name || chartData.code };
    const ohlcv = chartData.ohlcv;
    const dec = Number.isInteger(chartData.price_dec) ? chartData.price_dec : 2;
    const minMove = Number((1 / Math.pow(10, dec)).toFixed(dec));
    const mktLabel = chartData.market_type === "futures" ? "선물 Futures" : "현물 Spot";

    t4TvTitle.textContent = `📈 ${meta.name} (${meta.market}) ${mktLabel} 차트 (${chartData.timeframe})`;

    if (t4TvChartInst) { t4TvChartInst.remove(); t4TvChartInst = null; }
    t4TvSubChartInsts.forEach((inst) => inst.remove());
    t4TvSubChartInsts = [];
    t4TvChartContainer.innerHTML = "";
    t4TvSubchartsArea.innerHTML = "";

    const chartWidth = t4TvChartContainer.clientWidth || 800;
    const chart = LightweightCharts.createChart(t4TvChartContainer, {
      width: chartWidth,
      height: 360,
      layout: { background: { color: "#ffffff" }, textColor: "#334155" },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#cbd5e1" },
      timeScale: { borderColor: "#cbd5e1", timeVisible: Boolean(chartData.is_minute), secondsVisible: false },
    });
    t4TvChartInst = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#ef4444",
      downColor: "#3b82f6",
      borderUpColor: "#ef4444",
      borderDownColor: "#3b82f6",
      wickUpColor: "#ef4444",
      wickDownColor: "#3b82f6",
      priceFormat: { type: "price", precision: dec, minMove },
    });
    candleSeries.setData(ohlcv.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));

    const overlayLines = [
      { id: "ma5", key: "ma5", color: "#ec4899", title: "MA5" },
      { id: "ma20", key: "ma20", color: "#f59e0b", title: "MA20" },
      { id: "ma60", key: "ma60", color: "#10b981", title: "MA60" },
      { id: "ma120", key: "ma120", color: "#6366f1", title: "MA120" },
      { id: "ema5", key: "ema5", color: "#f43f5e", title: "EMA5" },
      { id: "ema20", key: "ema20", color: "#06b6d4", title: "EMA20" },
      { id: "ema60", key: "ema60", color: "#14b8a6", title: "EMA60" },
      { id: "ema120", key: "ema120", color: "#8b5cf6", title: "EMA120" },
      { id: "vwap20", key: "vwap20", color: "#a855f7", title: "VWAP20" },
    ];
    overlayLines.forEach((cfg) => {
      if (activeT4Indicators.has(cfg.id) && chartData[cfg.key]?.length) {
        chart.addLineSeries({ color: cfg.color, lineWidth: 1.5, title: cfg.title }).setData(chartData[cfg.key]);
      }
    });

    const customColors = ["#e11d48", "#0284c7", "#059669", "#d97706", "#7c3aed"];
    let cIdx = 0;
    activeT4Indicators.forEach((id) => {
      const m = getIndicatorMeta(id);
      if (m && m.customKind) {
        const sData = computeCustomMaSeries(ohlcv, m.customKind, m.period, dec);
        if (sData.length) {
          chart.addLineSeries({ color: customColors[cIdx++ % customColors.length], lineWidth: 1.6, title: `${m.customKind}${m.period}` }).setData(sData);
        }
      }
    });

    if (activeT4Indicators.has("bb") && chartData.bb_upper?.length && chartData.bb_lower?.length) {
      chart.addLineSeries({ color: "#64748b", lineWidth: 1, lineStyle: 2, title: "BB상단" }).setData(chartData.bb_upper);
      chart.addLineSeries({ color: "#64748b", lineWidth: 1, lineStyle: 2, title: "BB하단" }).setData(chartData.bb_lower);
    }
    if (activeT4Indicators.has("keltner") && chartData.kc_high?.length && chartData.kc_low?.length) {
      chart.addLineSeries({ color: "#0284c7", lineWidth: 1, lineStyle: 2, title: "KC상단" }).setData(chartData.kc_high);
      chart.addLineSeries({ color: "#0284c7", lineWidth: 1, lineStyle: 2, title: "KC하단" }).setData(chartData.kc_low);
    }
    if (activeT4Indicators.has("donchian") && chartData.dc_high?.length && chartData.dc_low?.length) {
      chart.addLineSeries({ color: "#16a34a", lineWidth: 1, lineStyle: 2, title: "DC상단" }).setData(chartData.dc_high);
      chart.addLineSeries({ color: "#16a34a", lineWidth: 1, lineStyle: 2, title: "DC하단" }).setData(chartData.dc_low);
    }
    if (activeT4Indicators.has("ichimoku") && chartData.ichi_conv?.length && chartData.ichi_base?.length) {
      chart.addLineSeries({ color: "#ef4444", lineWidth: 1.4, title: "전환선" }).setData(chartData.ichi_conv);
      chart.addLineSeries({ color: "#2563eb", lineWidth: 1.4, title: "기준선" }).setData(chartData.ichi_base);
    }
    if (activeT4Indicators.has("psar") && chartData.psar?.length) {
      chart.addLineSeries({ color: "#f97316", lineWidth: 0, pointMarkersVisible: true, pointMarkersRadius: 2.5, title: "PSAR" }).setData(chartData.psar);
    }

    const volumeSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeries.setData(
      ohlcv.map((d) => ({
        time: d.time,
        value: d.volume,
        color: d.close >= d.open ? "rgba(239, 68, 68, 0.35)" : "rgba(59, 130, 246, 0.35)",
      }))
    );

    const labelMap = new Map(ohlcv.map((d) => [d.time, d.label || d.time]));
    const last = ohlcv[ohlcv.length - 1];
    const updateLegend = (bar, vol) => {
      if (!bar) return;
      const dateLabel = labelMap.get(bar.time) || bar.time;
      t4TvOhlcvLegend.textContent =
        `${dateLabel} | 시 ${formatUsdPrice(bar.open, dec)} · 고 ${formatUsdPrice(bar.high, dec)} · ` +
        `저 ${formatUsdPrice(bar.low, dec)} · 종 ${formatUsdPrice(bar.close, dec)} | 거래량 ${formatNumber(vol)}`;
    };
    updateLegend(last, last.volume);

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time) { updateLegend(last, last.volume); return; }
      const cData = param.seriesData.get(candleSeries);
      const vData = param.seriesData.get(volumeSeries);
      if (cData) updateLegend({ ...cData, time: param.time }, vData ? vData.value : 0);
    });
    chart.timeScale().fitContent();

    const createSub = (label, buildFn) => {
      const wrap = document.createElement("div");
      wrap.className = "tv-subchart-wrap";
      const lbl = document.createElement("div");
      lbl.className = "tv-subchart-label";
      lbl.textContent = label;
      const box = document.createElement("div");
      box.className = "tv-subchart-container";
      wrap.append(lbl, box);
      t4TvSubchartsArea.appendChild(wrap);
      const sub = LightweightCharts.createChart(box, {
        width: chartWidth,
        height: 130,
        layout: { background: { color: "#ffffff" }, textColor: "#475569" },
        grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
        timeScale: { borderColor: "#cbd5e1", timeVisible: Boolean(chartData.is_minute) },
      });
      buildFn(sub);
      sub.timeScale().fitContent();
      t4TvSubChartInsts.push(sub);
    };

    const subDefs = [
      ["rsi14", "RSI (14일)", (sub) => sub.addLineSeries({ color: "#8b5cf6", lineWidth: 2 }).setData(chartData.rsi14)],
      ["macd", "MACD (12, 26, 9)", (sub) => {
        sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8 }).setData(chartData.macd);
        if (chartData.macd_signal?.length) sub.addLineSeries({ color: "#ef4444", lineWidth: 1.5 }).setData(chartData.macd_signal);
        if (chartData.macd_hist?.length) {
          sub.addHistogramSeries().setData(chartData.macd_hist.map((d) => ({ time: d.time, value: d.value, color: d.value >= 0 ? "rgba(239,68,68,0.45)" : "rgba(59,130,246,0.45)" })));
        }
      }],
      ["stoch", "스토캐스틱 (%K / %D)", (sub) => {
        sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8 }).setData(chartData.stoch_k);
        if (chartData.stoch_d?.length) sub.addLineSeries({ color: "#f59e0b", lineWidth: 1.5 }).setData(chartData.stoch_d);
      }],
      ["adx", "ADX (14일 추세강도 · DI+/DI-)", (sub) => {
        sub.addLineSeries({ color: "#0f172a", lineWidth: 2 }).setData(chartData.adx);
        if (chartData.adx_pos?.length) sub.addLineSeries({ color: "#16a34a", lineWidth: 1.3 }).setData(chartData.adx_pos);
        if (chartData.adx_neg?.length) sub.addLineSeries({ color: "#dc2626", lineWidth: 1.3 }).setData(chartData.adx_neg);
      }],
      ["aroon", "Aroon (25일)", (sub) => {
        sub.addLineSeries({ color: "#16a34a", lineWidth: 1.6 }).setData(chartData.aroon_up);
        if (chartData.aroon_down?.length) sub.addLineSeries({ color: "#dc2626", lineWidth: 1.6 }).setData(chartData.aroon_down);
      }],
      ["ao", "Awesome Oscillator", (sub) => sub.addHistogramSeries().setData(chartData.ao.map((d) => ({ time: d.time, value: d.value, color: d.value >= 0 ? "rgba(22,163,74,0.7)" : "rgba(220,38,38,0.7)" })))],
      ["cci20", "CCI (20일)", (sub) => sub.addLineSeries({ color: "#0ea5e9", lineWidth: 1.8 }).setData(chartData.cci20)],
      ["atr14", "ATR (14일)", (sub) => sub.addLineSeries({ color: "#f97316", lineWidth: 1.8 }).setData(chartData.atr14)],
      ["obv", "OBV (거래량 누적)", (sub) => sub.addLineSeries({ color: "#14b8a6", lineWidth: 1.8 }).setData(chartData.obv)],
      ["willr14", "Williams %R (14일)", (sub) => sub.addLineSeries({ color: "#e11d48", lineWidth: 1.8 }).setData(chartData.willr14)],
      ["mfi14", "MFI (14일)", (sub) => sub.addLineSeries({ color: "#10b981", lineWidth: 1.8 }).setData(chartData.mfi14)],
      ["roc", "ROC (12일 %)", (sub) => sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8 }).setData(chartData.roc)],
      ["tsi", "TSI", (sub) => sub.addLineSeries({ color: "#7c3aed", lineWidth: 1.8 }).setData(chartData.tsi)],
      ["uo", "Ultimate Oscillator", (sub) => sub.addLineSeries({ color: "#0284c7", lineWidth: 1.8 }).setData(chartData.uo)],
      ["cmf", "CMF (20일)", (sub) => sub.addLineSeries({ color: "#059669", lineWidth: 1.8 }).setData(chartData.cmf)],
      ["vortex", "Vortex (VI+/VI-)", (sub) => {
        sub.addLineSeries({ color: "#16a34a", lineWidth: 1.6 }).setData(chartData.vi_pos);
        if (chartData.vi_neg?.length) sub.addLineSeries({ color: "#dc2626", lineWidth: 1.6 }).setData(chartData.vi_neg);
      }],
      ["kst", "KST Oscillator", (sub) => {
        sub.addLineSeries({ color: "#2563eb", lineWidth: 1.8 }).setData(chartData.kst);
        if (chartData.kst_sig?.length) sub.addLineSeries({ color: "#ef4444", lineWidth: 1.4 }).setData(chartData.kst_sig);
      }],
      ["fi", "Force Index", (sub) => sub.addLineSeries({ color: "#d97706", lineWidth: 1.8 }).setData(chartData.fi)],
    ];

    subDefs.forEach(([id, label, fn]) => {
      const keyMap = { adx: "adx", aroon: "aroon_up", vortex: "vi_pos", stoch: "stoch_k" };
      const checkKey = keyMap[id] || id;
      if (activeT4Indicators.has(id) && chartData[checkKey]?.length) {
        createSub(label, fn);
      }
    });
  }

  function renderTab4Summary(coinData) {
    const info = coinData.coin_info || {};
    const spot = coinData.spot || {};
    const fut = coinData.futures || {};
    const kimchi = coinData.kimchi || {};
    const fng = coinData.fear_greed || {};
    const tech = coinData.technical || {};
    const dec = Number.isInteger(coinData.price_dec) ? coinData.price_dec : 2;

    document.getElementById("t4AssetBadge").textContent = "Binance USDT";
    document.getElementById("t4SummaryName").textContent = `${info.korean_name || info.symbol} (${info.usdt_symbol || "-"})`;
    document.getElementById("t4SummaryPrice").textContent = formatUsdPrice(spot.price, dec);

    const changeEl = document.getElementById("t4SummaryChange");
    const rate = spot.change_pct;
    if (rate !== null && rate !== undefined) {
      const sign = rate > 0 ? "▲" : rate < 0 ? "▼" : "";
      const plus = rate > 0 ? "+" : "";
      changeEl.textContent = `${sign} ${plus}${rate}%`;
      changeEl.className = `t1-summary-change ${rate > 0 ? "up" : rate < 0 ? "down" : "flat"}`;
    }

    const pos = tech.range_position_pct;
    if (pos !== null && pos !== undefined) {
      document.getElementById("t4RangeLabel").textContent =
        `일봉 구간 위치: ${pos}% (저가 ${formatUsdPrice(tech.period_low, dec)} ~ 고가 ${formatUsdPrice(tech.period_high, dec)})`;
      document.getElementById("t4RangeFill").style.width = `${pos}%`;
    }

    // 1) 현물(Spot) 분리 패널 렌더링
    const spotMetricsEl = document.getElementById("t4SpotMetrics");
    document.getElementById("t4SpotBadge").textContent = spot.available ? "현물 실시간" : "미지원";
    spotMetricsEl.innerHTML = `
      <div class="t4-metric-item">
        <span class="t4-metric-label">현물 현재가 (Spot)</span>
        <span class="t4-metric-value">${formatUsdPrice(spot.price, dec)}</span>
        <span class="t4-metric-sub">24h 등락 ${spot.change_pct > 0 ? "+" : ""}${spot.change_pct ?? "-"}%</span>
      </div>
      <div class="t4-metric-item">
        <span class="t4-metric-label">24h 현물 거래대금</span>
        <span class="t4-metric-value">${formatUsdCompact(spot.volume_24h_usdt)}</span>
        <span class="t4-metric-sub">${formatNumber(Math.round(spot.volume_24h_coin || 0))} ${info.symbol || ""}</span>
      </div>
      <div class="t4-metric-item">
        <span class="t4-metric-label">24h 고가 / 저가</span>
        <span class="t4-metric-value">${formatUsdPrice(spot.high_24h, dec)}</span>
        <span class="t4-metric-sub">저가 ${formatUsdPrice(spot.low_24h, dec)}</span>
      </div>
      <div class="t4-metric-item">
        <span class="t4-metric-label">업비트 KRW (참고)</span>
        <span class="t4-metric-value">${kimchi.available ? formatNumber(kimchi.upbit_krw_price, "원") : "-"}</span>
        <span class="t4-metric-sub">김프 ${kimchi.premium_pct !== null && kimchi.premium_pct !== undefined ? `${kimchi.premium_pct > 0 ? "+" : ""}${kimchi.premium_pct}%` : "-"}</span>
      </div>
    `;

    // 2) 선물(Futures) & 펀딩비 분리 패널 렌더링
    const futMetricsEl = document.getElementById("t4FuturesMetrics");
    if (fut.available) {
      const fr = fut.funding_rate_pct ?? 0;
      const frClass = fr > 0.005 ? "t4-funding-pos" : fr < -0.005 ? "t4-funding-neg" : "t4-funding-neutral";
      document.getElementById("t4FuturesBadge").textContent = "무기한 선물";
      futMetricsEl.innerHTML = `
        <div class="t4-metric-item">
          <span class="t4-metric-label">펀딩비 (8시간 / 연환산)</span>
          <span class="t4-metric-value ${frClass}">${fr > 0 ? "+" : ""}${fr}% <small>(연 ${fut.funding_rate_annual_pct > 0 ? "+" : ""}${fut.funding_rate_annual_pct}%)</small></span>
          <span class="t4-metric-sub">${fut.funding_bias || "-"}</span>
        </div>
        <div class="t4-metric-item">
          <span class="t4-metric-label">다음 펀딩 정산</span>
          <span class="t4-metric-value">${fut.next_funding_kst || "-"}</span>
          <span class="t4-metric-sub">${fut.next_funding_countdown || "-"}</span>
        </div>
        <div class="t4-metric-item">
          <span class="t4-metric-label">미결제약정 (OI)</span>
          <span class="t4-metric-value">${formatUsdCompact(fut.open_interest_usdt)}</span>
          <span class="t4-metric-sub">${formatNumber(fut.open_interest_coin)} ${info.symbol || ""}</span>
        </div>
        <div class="t4-metric-item">
          <span class="t4-metric-label">선물 마크가격 / 거래대금</span>
          <span class="t4-metric-value">${formatUsdPrice(fut.mark_price, dec)}</span>
          <span class="t4-metric-sub">24h ${formatUsdCompact(fut.volume_24h_usdt)} (현물 대비 ${coinData.fut_spot_vol_ratio ?? "-"}배)</span>
        </div>
      `;
    } else {
      document.getElementById("t4FuturesBadge").textContent = "미지원";
      futMetricsEl.innerHTML = `<div class="t4-metric-item" style="grid-column: span 2;"><span class="t4-metric-label">선물 데이터 없음</span><span class="t4-metric-sub">${fut.reason || "바이낸스 USDT 무기한 선물 미상장 종목"}</span></div>`;
    }

    const fgVal = fng.value;
    const fgHint =
      fgVal === undefined
        ? "시장 심리 정보 없음"
        : fgVal <= 25
          ? "극단적 공포 (공포에 매수하는 역발상 구간)"
          : fgVal <= 45
            ? "시장 심리가 위축된 공포 구간"
            : fgVal <= 55
              ? "중립적인 투자 심리"
              : "탐욕 과열 구간 (추격 매수 주의)";

    const kimp = kimchi.premium_pct;
    const kimpHint =
      kimp === null || kimp === undefined
        ? "해외 시세 비교 불가"
        : kimp > 3
          ? "국내 가격이 해외보다 비쌈 (과열 주의)"
          : kimp >= -1
            ? "국내·해외 시세 균형 범위"
            : "국내 가격이 해외보다 저렴함 (역프리미엄)";

    const cards = [
      {
        title: "시장 심리 (공포·탐욕 지수)",
        val: fgVal !== undefined ? `${fgVal}점 (${fng.classification_kr})` : "-",
        hint: fgHint,
      },
      {
        title: "김치프리미엄 (원/달러 기준)",
        val: kimp !== null && kimp !== undefined ? `${kimp > 0 ? "+" : ""}${kimp}%` : "-",
        hint: `${kimpHint} · 환율 ${kimchi.usd_krw ? formatNumber(kimchi.usd_krw, "원") : "-"}`,
      },
      {
        title: "선물 vs 현물 거래량 비율",
        val: coinData.fut_spot_vol_ratio ? `${coinData.fut_spot_vol_ratio}배` : "-",
        hint: coinData.fut_spot_vol_ratio >= 5 ? "선물 레버리지 주도 시장 (변동성 유의)" : "현물·선물 균형 수급",
      },
      {
        title: "일봉 기술지표 (RSI14 / MA20)",
        val: `RSI ${tech.rsi14 ?? "-"} / MA20 ${formatUsdPrice(tech.ma20, dec)}`,
        hint: tech.rsi14 !== null && tech.rsi14 <= 30 ? "단기 과매도 구간 진입" : tech.rsi14 >= 70 ? "단기 과매수 구간 주의" : "중립 기술 구간",
      },
    ];

    const gridEl = document.getElementById("t4BeginnerCards");
    gridEl.innerHTML = "";
    cards.forEach((c) => {
      const div = document.createElement("div");
      div.className = "beginner-item";
      div.innerHTML = `<div class="beginner-title">${c.title}</div><div class="beginner-val">${c.val}</div><div class="beginner-hint">${c.hint}</div>`;
      gridEl.appendChild(div);
    });

    t4MarketBar.textContent = `Binance USDT 현물·선물 실시간 · 환율 ${kimchi.usd_krw ? formatNumber(kimchi.usd_krw, "원") : "-"}`;
    t4SummaryCard.classList.remove("hidden");

    // 2-1) CoinStats 스타일 공포·탐욕 게이지 + 어제/지난주/지난달 비교
    const fngScoreEl = document.getElementById("t4FngScore");
    const fngLabelEl = document.getElementById("t4FngLabel");
    const fngBadgeEl = document.getElementById("t4FngBadge");
    const fngNeedleEl = document.getElementById("t4FngNeedle");
    const fngHistEl = document.getElementById("t4FngHistory");
    if (fngScoreEl && fgVal !== undefined) {
      const clamped = Math.max(0, Math.min(100, Number(fgVal)));
      const deg = -90 + (clamped / 100) * 180;
      fngNeedleEl?.setAttribute("transform", `rotate(${deg.toFixed(1)} 120 118)`);
      fngScoreEl.textContent = String(clamped);
      fngLabelEl.textContent = `${fng.classification_kr || "-"} (${fng.classification || "-"})`;
      const clsKey = clamped <= 24 ? "efear" : clamped <= 44 ? "fear" : clamped <= 55 ? "neutral" : clamped <= 74 ? "greed" : "egreed";
      fngBadgeEl.textContent = fng.classification_kr || "-";
      fngBadgeEl.className = `t4-fng-badge ${clsKey}`;
      const histItems = [
        { label: "어제", data: fng.yesterday },
        { label: "지난주", data: fng.last_week },
        { label: "지난달", data: fng.last_month },
      ];
      fngHistEl.innerHTML = histItems
        .map((h) => `
          <div class="t4-fng-hist-pill">
            <span class="h-label">${h.label}</span>
            <span class="h-val">${h.data?.value ?? "-"}</span>
            <span class="h-cls">${h.data?.classification_kr ?? "-"}</span>
          </div>
        `)
        .join("");
    }

    // 2-2) 비트코인 도미넌스 & 전체 시가총액
    const dom = coinData.btc_dominance || {};
    const domMcapBadge = document.getElementById("t4DomMcapBadge");
    const domContentEl = document.getElementById("t4DomContent");
    if (domContentEl && dom.available) {
      const mcapT = dom.total_market_cap_usd >= 1e12
        ? `$${(dom.total_market_cap_usd / 1e12).toFixed(2)}T`
        : formatUsdCompact(dom.total_market_cap_usd);
      domMcapBadge.textContent = `전체 시총 ${mcapT}`;
      const chg = dom.market_cap_change_24h_pct ?? 0;
      const chgClass = chg > 0 ? "up" : chg < 0 ? "down" : "flat";
      domContentEl.innerHTML = `
        <div class="t4-dom-main">
          <div>
            <span class="t4-metric-label">BTC 도미넌스</span>
            <div class="t4-dom-btc-big">${dom.btc_dominance}%</div>
          </div>
          <div class="t4-dom-mcap-chg ${chgClass}">전체 시총 24h ${chg > 0 ? "+" : ""}${chg}%</div>
        </div>
        <div class="t4-dom-bar">
          <div class="t4-dom-seg-btc" style="width: ${dom.btc_dominance}%;" title="BTC ${dom.btc_dominance}%"></div>
          <div class="t4-dom-seg-eth" style="width: ${dom.eth_dominance}%;" title="ETH ${dom.eth_dominance}%"></div>
          <div class="t4-dom-seg-alt" style="width: ${dom.alt_dominance}%;" title="기타 알트 ${dom.alt_dominance}%"></div>
        </div>
        <div class="t4-dom-legend">
          <div class="t4-dom-leg-item"><span class="t4-dom-dot" style="background:#f59e0b;"></span>BTC<strong>${dom.btc_dominance}%</strong></div>
          <div class="t4-dom-leg-item"><span class="t4-dom-dot" style="background:#6366f1;"></span>ETH<strong>${dom.eth_dominance}%</strong></div>
          <div class="t4-dom-leg-item"><span class="t4-dom-dot" style="background:#94a3b8;"></span>기타 알트<strong>${dom.alt_dominance}%</strong></div>
        </div>
        <div class="t4-dom-interp">💡 ${dom.interpretation || "-"}</div>
      `;
    } else if (domContentEl) {
      domMcapBadge.textContent = "조회 불가";
      domContentEl.innerHTML = `<div class="t4-metric-sub">비트코인 도미넌스 데이터를 불러오지 못했습니다.</div>`;
    }

    // 3) 롱/숏 청산 로드맵 렌더링
    const liqCard = document.getElementById("t4LiquidationCard");
    const liq = coinData.liquidation_roadmap;
    if (liqCard && liq && liq.available) {
      const diagBadge = document.getElementById("t4LiqDiagnosisBadge");
      diagBadge.textContent = liq.squeeze_diagnosis || "-";
      diagBadge.className = `t4-liq-diag-badge ${liq.dominant_side || "balanced"}`;

      const ratioWrap = document.getElementById("t4LiqRatioBarWrap");
      ratioWrap.innerHTML = `
        <div class="t4-ratio-box">
          <div class="t4-ratio-labels">
            <span>글로벌 계정 롱 ${liq.global_long_pct}%</span>
            <span>비율 ${liq.global_ls_ratio}</span>
            <span>숏 ${liq.global_short_pct}%</span>
          </div>
          <div class="t4-ratio-bar">
            <div class="t4-ratio-long" style="width: ${liq.global_long_pct}%;"></div>
            <div class="t4-ratio-short" style="width: ${liq.global_short_pct}%;"></div>
          </div>
        </div>
        <div class="t4-ratio-box">
          <div class="t4-ratio-labels">
            <span>상위 트레이더 롱 ${liq.top_long_pct}%</span>
            <span>테이커 매수/매도 ${liq.taker_buy_sell_ratio}</span>
            <span>숏 ${liq.top_short_pct}%</span>
          </div>
          <div class="t4-ratio-bar">
            <div class="t4-ratio-long" style="width: ${liq.top_long_pct}%;"></div>
            <div class="t4-ratio-short" style="width: ${liq.top_short_pct}%;"></div>
          </div>
        </div>
      `;

      const renderLevels = (elId, levels) => {
        const el = document.getElementById(elId);
        if (!el) return;
        const maxAmt = Math.max(...levels.map((x) => x.est_liq_usdt || 0), 1);
        el.innerHTML = levels
          .map((lv) => {
            const pct = Math.max(8, Math.round(((lv.est_liq_usdt || 0) / maxAmt) * 100));
            const mvSign = lv.move_pct > 0 ? "+" : "";
            return `
              <div class="t4-liq-row" title="${lv.tag}">
                <div class="t4-liq-bar-bg" style="width: ${pct}%;"></div>
                <span class="t4-liq-lev">${lv.leverage}</span>
                <span class="t4-liq-price">${formatUsdPrice(lv.liq_price, dec)} <small>(${mvSign}${lv.move_pct}%)</small></span>
                <span class="t4-liq-amt">${formatUsdCompact(lv.est_liq_usdt)}</span>
              </div>
            `;
          })
          .join("");
      };

      renderLevels("t4ShortLiqList", liq.short_squeeze_levels || []);
      renderLevels("t4LongLiqList", liq.long_squeeze_levels || []);
      liqCard.classList.remove("hidden");
    } else if (liqCard) {
      liqCard.classList.add("hidden");
    }

    // 4) 미국 주요 경제지표 발표 일정 & 코인 상관관계 렌더링
    const macroCard = document.getElementById("t4UsMacroCard");
    const macro = coinData.us_macro;
    if (macroCard && macro && macro.available) {
      const corr = macro.correlation || {};
      const latest = corr.latest || {};
      document.getElementById("t4MacroSummary").textContent =
        `30일 BTC 실측 상관관계: ${corr.summary || "-"}`;

      const corrItems = [
        {
          label: "나스닥 100 (QQQ)",
          val: corr.qqq,
          sub: latest.qqq ? `$${latest.qqq.value} (${latest.qqq.change_pct > 0 ? "+" : ""}${latest.qqq.change_pct}%)` : "-",
          hint: corr.qqq >= 0.4 ? "나스닥과 함께 움직이는 동조화 강함" : "나스닥 영향 제한적",
        },
        {
          label: "미국 달러인덱스 (DXY)",
          val: corr.dxy,
          sub: latest.dxy ? `${latest.dxy.value} (${latest.dxy.change_pct > 0 ? "+" : ""}${latest.dxy.change_pct}%)` : "-",
          hint: corr.dxy <= -0.2 ? "달러 약세 시 코인 상승 경향" : "달러와 혼조 흐름",
        },
        {
          label: "미 10년물 국채금리",
          val: corr.us10y,
          sub: latest.us10y ? `${latest.us10y.value}% (${latest.us10y.change_pct > 0 ? "+" : ""}${latest.us10y.change_pct}%)` : "-",
          hint: Math.abs(corr.us10y || 0) >= 0.3 ? "금리 변동에 민감하게 반응" : "금리 단기 영향 제한적",
        },
      ];

      document.getElementById("t4MacroCorrGrid").innerHTML = corrItems
        .map((c) => {
          const vStr = c.val !== null && c.val !== undefined ? `${c.val > 0 ? "+" : ""}${c.val.toFixed(2)}` : "-";
          const vCls = c.val >= 0.25 ? "pos" : c.val <= -0.25 ? "neg" : "neu";
          return `
            <div class="t4-corr-box">
              <div class="t4-corr-head"><span>${c.label}</span><span>${c.sub}</span></div>
              <div class="t4-corr-val ${vCls}">${vStr}</div>
              <div class="t4-corr-hint">${c.hint}</div>
            </div>
          `;
        })
        .join("");

      const evList = macro.events || [];
      const evContainer = document.getElementById("t4MacroEventsList");
      if (evList.length) {
        evContainer.innerHTML = evList
          .map((ev) => `
            <div class="t4-macro-ev-row">
              <div class="t4-ev-time">
                ${ev.date_kst}
                <span class="t4-ev-status ${ev.is_upcoming ? "upcoming" : "done"}">${ev.is_upcoming ? "예정" : "발표"}</span>
              </div>
              <div class="t4-ev-main">
                <strong>${ev.title_kr}</strong>
                <span class="t4-ev-impact ${ev.impact}">${ev.impact === "High" ? "핵심" : "중요"}</span>
                <div class="t4-ev-guide">${ev.guide}</div>
              </div>
              <div class="t4-ev-nums">
                <div>예상 <strong>${ev.forecast}</strong></div>
                <div>이전 ${ev.previous}</div>
              </div>
            </div>
          `)
          .join("");
      } else {
        evContainer.innerHTML = `<div class="t4-ev-guide">이번 주 예정된 주요 미국 거시지표 일정이 없습니다.</div>`;
      }
      macroCard.classList.remove("hidden");
    } else if (macroCard) {
      macroCard.classList.add("hidden");
    }

    if (coinData.tv_chart) {
      t4CurrentMeta = { market: info.usdt_symbol, name: info.korean_name || info.symbol };
      t4CurrentChartData = coinData.tv_chart;
      t4CurrentTf = "day";
      t4CurrentMarketType = "spot";
      t4TfBtns.forEach((b) => b.classList.toggle("active", b.dataset.tf === "day"));
      t4MktBtns.forEach((b) => b.classList.toggle("active", b.dataset.mkt === "spot"));
      t4TvNotice.classList.add("hidden");
      t4TradingViewCard.classList.remove("hidden");
      renderT4ActiveTags();
      drawT4TvChart(t4CurrentChartData);
    }
  }

  async function sendTab4Request(rawMarket, question = "", isInitial = false) {
    const query = (rawMarket || "").trim();
    if (!query) {
      t4ErrorBox.textContent = "코인명 또는 티커를 입력해 주세요. (예: 비트코인, BTC)";
      t4ErrorBox.classList.remove("hidden");
      return;
    }

    t4AutocompleteList.classList.add("hidden");
    t4ErrorBox.classList.add("hidden");

    if (isInitial || (t4LastMarket && t4LastMarket !== query)) {
      t4ConversationId = "";
      if (isInitial) {
        t4ChatMessages.innerHTML = "";
        t4ReportSection.classList.add("hidden");
        t4TradingViewCard.classList.add("hidden");
        t4ReportBody.innerHTML = "";
        t4ContextBar.classList.add("hidden");
        t4SummaryCard.classList.add("hidden");
    document.getElementById("t4LiquidationCard")?.classList.add("hidden");
    document.getElementById("t4UsMacroCard")?.classList.add("hidden");
      }
    }

    let thinkingBubble = null;
    if (isInitial) {
      t4LoadingBox.classList.remove("hidden");
    } else {
      appendChatBubble(t4ChatMessages, "user", `[${t4LastMarket || query}] ${question}`);
      thinkingBubble = appendChatBubble(t4ChatMessages, "bot", "코인 데이터를 바탕으로 후속 질문 답변 작성 중...");
    }

    setTab4Busy(true);
    console.log(`[CHAT]       코인 분석 요청 시작 (tab4, market=${query}, initial=${isInitial})`);

    try {
      const res = await fetch("/api/coin/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: query, question, conversation_id: t4ConversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "코인 분석 요청에 실패했습니다.");

      t4ConversationId = data.conversation_id || t4ConversationId;
      const cInfo = data.coin_data?.coin_info || {};
      const resolvedMkt = cInfo.usdt_symbol || query;
      const resolvedName = cInfo.korean_name || cInfo.symbol || resolvedMkt;
      t4LastMarket = resolvedMkt;
      if (cInfo.usdt_symbol) t4MarketInput.value = resolvedMkt;

      if (isInitial) {
        setBotFormattedContent(t4ReportBody, data.answer || "응답이 비어 있습니다.");
        t4ReportSection.classList.remove("hidden");
        appendChatBubble(
          t4ChatMessages,
          "bot",
          `${resolvedName} (${resolvedMkt}) 현물·선물·펀딩비 종합 분석 리포트가 위 패널에 완성되었습니다! 궁금한 점을 아래에서 질문해 주세요.`
        );
      } else if (thinkingBubble) {
        setBotFormattedContent(thinkingBubble, data.answer || "응답이 비어 있습니다.");
        t4ChatMessages.scrollTop = t4ChatMessages.scrollHeight;
      }

      if (data.coin_data) {
        const s = data.coin_data.spot || {};
        const fut = data.coin_data.futures || {};
        const dec = Number.isInteger(data.coin_data.price_dec) ? data.coin_data.price_dec : 2;
        const frStr = fut.available ? ` · 펀딩비 ${fut.funding_rate_pct > 0 ? "+" : ""}${fut.funding_rate_pct}%` : "";
        t4ContextBar.textContent =
          `수집 근거 반영됨: ${resolvedName} (${resolvedMkt}) · 현물 ${formatUsdPrice(s.price, dec)}${frStr} · ` +
          `공포·탐욕 ${data.coin_data.fear_greed?.value ?? "-"}점 · 뉴스 ${(data.coin_data.news || []).length}건`;
        t4ContextBar.classList.remove("hidden");
        renderTab4Summary(data.coin_data);
      }
    } catch (err) {
      if (thinkingBubble) thinkingBubble.textContent = `오류: ${err.message}`;
      t4ErrorBox.textContent = err.message;
      t4ErrorBox.classList.remove("hidden");
      console.error(`[ERROR]      코인 분석 오류 (${err.message})`);
    } finally {
      t4LoadingBox.classList.add("hidden");
      setTab4Busy(false);
      t4QuestionInput.focus();
    }
  }

  t4ResetBtn.addEventListener("click", () => resetTab4Chat());

  t4MarketInput.addEventListener("input", () => {
    const q = t4MarketInput.value.trim();
    if (t4AcTimer) clearTimeout(t4AcTimer);
    if (!q) { t4AutocompleteList.classList.add("hidden"); return; }

    t4AcTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/coin/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const items = data.results || [];
        t4AutocompleteList.innerHTML = "";
        if (items.length === 0) { t4AutocompleteList.classList.add("hidden"); return; }
        items.forEach((item) => {
          const li = document.createElement("li");
          li.className = "autocomplete-item";
          li.innerHTML = `<span class="ac-name">${item.korean_name} (${item.symbol})</span><span class="ac-meta">${item.market}</span>`;
          li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            t4MarketInput.value = item.market;
            t4AutocompleteList.classList.add("hidden");
            sendTab4Request(item.market, "", true);
          });
          t4AutocompleteList.appendChild(li);
        });
        t4AutocompleteList.classList.remove("hidden");
      } catch {
        t4AutocompleteList.classList.add("hidden");
      }
    }, 150);
  });

  t4SelectForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendTab4Request(t4MarketInput.value.trim(), "", true);
  });

  document.querySelectorAll(".t4-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mkt = btn.dataset.market;
      t4MarketInput.value = mkt;
      sendTab4Request(mkt, "", true);
    });
  });

  t4ChatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = t4QuestionInput.value.trim();
    if (!q) return;
    t4QuestionInput.value = "";
    sendTab4Request(t4MarketInput.value.trim(), q, !t4ConversationId);
  });

  t4QqBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.q;
      if (q) sendTab4Request(t4MarketInput.value.trim(), q, !t4ConversationId);
    });
  });

  async function reloadT4Chart() {
    if (!t4CurrentMeta?.market) return;
    t4TvNotice.classList.add("hidden");
    try {
      const res = await fetch("/api/coin/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market: t4CurrentMeta.market,
          timeframe: t4CurrentTf,
          market_type: t4CurrentMarketType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "코인 차트 조회 실패");
      t4CurrentChartData = data;
      drawT4TvChart(data);
    } catch (err) {
      t4TvNotice.textContent = `안내: ${err.message}`;
      t4TvNotice.classList.remove("hidden");
    }
  }

  t4TfBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      t4CurrentTf = btn.dataset.tf;
      t4TfBtns.forEach((b) => b.classList.toggle("active", b === btn));
      reloadT4Chart();
    });
  });

  t4MktBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      t4CurrentMarketType = btn.dataset.mkt || "spot";
      t4MktBtns.forEach((b) => b.classList.toggle("active", b === btn));
      reloadT4Chart();
    });
  });

  function showT4IndicatorSuggestions(queryText) {
    const q = (queryText || "").trim().toLowerCase();
    const matches = TV_INDICATOR_CATALOG.filter((item) => !q || item.name.toLowerCase().includes(q) || item.keywords.includes(q));
    const customCandidates = [];
    const cm = q.match(/^(ma|ema)\s*(\d{1,3})$/);
    if (cm) {
      const kind = cm[1].toLowerCase();
      const period = Number(cm[2]);
      if (period >= 2 && period <= 200 && !TV_INDICATOR_CATALOG.some((x) => x.id === `${kind}${period}`)) {
        customCandidates.push({ id: `custom_${kind}_${period}`, name: `${kind.toUpperCase()}${period} (${period}일 맞춤 이평선 추가)`, mode: "overlay" });
      }
    }
    const finalList = [...customCandidates, ...matches];
    t4IndSearchList.innerHTML = "";
    if (finalList.length === 0) { t4IndSearchList.classList.add("hidden"); return; }
    finalList.forEach((item) => {
      const li = document.createElement("li");
      li.className = "autocomplete-item";
      li.innerHTML = `<span class="ac-name">${item.name}</span><span class="ac-meta">${activeT4Indicators.has(item.id) ? "추가됨 ✓" : (item.mode === "overlay" ? "메인차트" : "보조차트")}</span>`;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        activeT4Indicators.add(item.id);
        t4IndSearchInput.value = "";
        t4IndSearchList.classList.add("hidden");
        renderT4ActiveTags();
        if (t4CurrentChartData) drawT4TvChart(t4CurrentChartData);
      });
      t4IndSearchList.appendChild(li);
    });
    t4IndSearchList.classList.remove("hidden");
  }

  t4IndSearchInput.addEventListener("focus", () => showT4IndicatorSuggestions(t4IndSearchInput.value));
  t4IndSearchInput.addEventListener("input", () => showT4IndicatorSuggestions(t4IndSearchInput.value));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".t4-ind-search-wrap")) t4IndSearchList.classList.add("hidden");
    if (!e.target.closest("#t4SelectForm .autocomplete-wrap")) t4AutocompleteList.classList.add("hidden");
  });

  // -------------------------------------------------------------------------
  // 탭 4: 트레이딩뷰 스타일 크립토 히트맵 (Squarified Treemap)
  // -------------------------------------------------------------------------
  const t4HeatmapCanvas = document.getElementById("t4HeatmapCanvas");
  const t4HeatmapTooltip = document.getElementById("t4HeatmapTooltip");
  const t4HeatmapRefreshBtn = document.getElementById("t4HeatmapRefreshBtn");
  let t4HeatmapItems = [];
  let t4HeatmapLoaded = false;

  function getHeatmapColor(chg) {
    if (chg >= 5) return "#047857";
    if (chg >= 2) return "#059669";
    if (chg > 0.15) return "#10b981";
    if (chg >= -0.15) return "#64748b";
    if (chg > -2) return "#ef4444";
    if (chg > -5) return "#dc2626";
    return "#991b1b";
  }

  function computeSquarifiedTreemap(items, width, height) {
    const totalVal = items.reduce((s, d) => s + d.market_cap, 0);
    if (!totalVal || width <= 0 || height <= 0) return [];

    const totalArea = width * height;
    const nodes = items
      .map((d) => ({ ...d, area: (d.market_cap / totalVal) * totalArea }))
      .sort((a, b) => b.area - a.area);

    const rects = [];

    function worstAspect(row, side) {
      if (!row.length || side <= 0) return Infinity;
      const sum = row.reduce((s, n) => s + n.area, 0);
      const maxA = Math.max(...row.map((n) => n.area));
      const minA = Math.min(...row.map((n) => n.area));
      const s2 = side * side;
      return Math.max((s2 * maxA) / (sum * sum), (sum * sum) / (s2 * minA));
    }

    function layoutRow(row, box) {
      const sum = row.reduce((s, n) => s + n.area, 0);
      if (box.w >= box.h) {
        const colW = box.h > 0 ? sum / box.h : 0;
        let cy = box.y;
        row.forEach((n) => {
          const h = colW > 0 ? n.area / colW : 0;
          rects.push({ ...n, x: box.x, y: cy, w: colW, h });
          cy += h;
        });
        return { x: box.x + colW, y: box.y, w: Math.max(0, box.w - colW), h: box.h };
      } else {
        const rowH = box.w > 0 ? sum / box.w : 0;
        let cx = box.x;
        row.forEach((n) => {
          const w = rowH > 0 ? n.area / rowH : 0;
          rects.push({ ...n, x: cx, y: box.y, w, h: rowH });
          cx += w;
        });
        return { x: box.x, y: box.y + rowH, w: box.w, h: Math.max(0, box.h - rowH) };
      }
    }

    let box = { x: 0, y: 0, w: width, h: height };
    let row = [];
    for (let i = 0; i < nodes.length; i++) {
      const cand = nodes[i];
      const side = Math.min(box.w, box.h);
      if (row.length === 0 || worstAspect([...row, cand], side) <= worstAspect(row, side)) {
        row.push(cand);
      } else {
        box = layoutRow(row, box);
        row = [cand];
      }
    }
    if (row.length > 0) layoutRow(row, box);
    return rects;
  }

  function renderT4Heatmap() {
    if (!t4HeatmapCanvas || !t4HeatmapItems.length) return;
    const width = t4HeatmapCanvas.clientWidth || 800;
    const height = t4HeatmapCanvas.clientHeight || 410;
    const tiles = computeSquarifiedTreemap(t4HeatmapItems, width, height);

    t4HeatmapCanvas.innerHTML = "";
    tiles.forEach((t) => {
      const div = document.createElement("div");
      div.className = "t4-hm-tile";
      div.style.left = `${t.x}px`;
      div.style.top = `${t.y}px`;
      div.style.width = `${t.w}px`;
      div.style.height = `${t.h}px`;
      div.style.background = getHeatmapColor(t.change_24h);

      const minDim = Math.min(t.w, t.h);
      const symSize = Math.max(9, Math.min(24, Math.floor(minDim * 0.24)));
      const chgSize = Math.max(8, Math.min(16, Math.floor(minDim * 0.16)));
      const sign = t.change_24h > 0 ? "+" : "";

      if (minDim >= 26) {
        let html = `<span class="t4-hm-sym" style="font-size:${symSize}px">${t.symbol}</span>`;
        if (minDim >= 38) {
          html += `<span class="t4-hm-chg" style="font-size:${chgSize}px">${sign}${t.change_24h}%</span>`;
        }
        if (minDim >= 72 && t.w >= 88) {
          const dec = t.price >= 1 ? 2 : 4;
          html += `<span class="t4-hm-price" style="font-size:${Math.max(10, chgSize - 2)}px">${formatUsdPrice(t.price, dec)}</span>`;
        }
        div.innerHTML = html;
      }

      div.addEventListener("mouseenter", () => {
        if (!t4HeatmapTooltip) return;
        const dec = t.price >= 1 ? 2 : 4;
        t4HeatmapTooltip.innerHTML = `
          <strong>${t.name} (${t.symbol})</strong><br/>
          현재가: ${formatUsdPrice(t.price, dec)} · 24h: <strong>${sign}${t.change_24h}%</strong><br/>
          시가총액: ${formatUsdCompact(t.market_cap)} · 24h 거래량: ${formatUsdCompact(t.volume_24h)}
        `;
        t4HeatmapTooltip.classList.remove("hidden");
      });

      div.addEventListener("mousemove", (e) => {
        if (!t4HeatmapTooltip) return;
        const wrapRect = t4HeatmapCanvas.getBoundingClientRect();
        let left = e.clientX - wrapRect.left + 12;
        let top = e.clientY - wrapRect.top + 12;
        if (left + 220 > wrapRect.width) left = Math.max(8, left - 235);
        if (top + 76 > wrapRect.height) top = Math.max(8, top - 86);
        t4HeatmapTooltip.style.left = `${left}px`;
        t4HeatmapTooltip.style.top = `${top}px`;
      });

      div.addEventListener("mouseleave", () => {
        t4HeatmapTooltip?.classList.add("hidden");
      });

      div.addEventListener("click", () => {
        t4MarketInput.value = t.usdt_symbol;
        sendTab4Request(t.usdt_symbol, "", true);
      });

      t4HeatmapCanvas.appendChild(div);
    });
  }

  async function loadAndRenderT4Heatmap(force = false) {
    if (!t4HeatmapCanvas) return;
    if (t4HeatmapLoaded && !force && t4HeatmapItems.length) {
      renderT4Heatmap();
      return;
    }
    t4HeatmapCanvas.innerHTML = `<div class="t4-heatmap-loading">실시간 크립토 히트맵 불러오는 중...</div>`;
    try {
      const res = await fetch("/api/coin/heatmap?limit=30");
      const data = await res.json();
      t4HeatmapItems = data.items || [];
      t4HeatmapLoaded = true;
      if (!t4HeatmapItems.length) {
        t4HeatmapCanvas.innerHTML = `<div class="t4-heatmap-loading">히트맵 데이터를 불러오지 못했습니다.</div>`;
        return;
      }
      renderT4Heatmap();
    } catch {
      t4HeatmapCanvas.innerHTML = `<div class="t4-heatmap-loading">히트맵 로드 중 오류가 발생했습니다.</div>`;
    }
  }

  t4HeatmapRefreshBtn?.addEventListener("click", () => loadAndRenderT4Heatmap(true));
  document.querySelector('.tab-btn[data-tab="tab4"]')?.addEventListener("click", () => {
    setTimeout(() => loadAndRenderT4Heatmap(false), 60);
  });
  window.addEventListener("resize", () => {
    if (document.getElementById("tab4")?.classList.contains("active") && t4HeatmapItems.length) {
      renderT4Heatmap();
    }
  });
});
