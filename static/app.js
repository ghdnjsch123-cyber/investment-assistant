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
  const t1AnalyzeBtn = document.getElementById("t1AnalyzeBtn");
  const t1LoadingBox = document.getElementById("t1LoadingBox");
  const t1ReportSection = document.getElementById("t1ReportSection");
  const t1MarketBar = document.getElementById("t1MarketBar");
  const t1ContextBar = document.getElementById("t1ContextBar");
  const t1SummaryCard = document.getElementById("t1SummaryCard");
  const t1TechStrip = document.getElementById("t1TechStrip");
  const t1ChartsGrid = document.getElementById("t1ChartsGrid");
  const t1ReportBody = document.getElementById("t1ReportBody");
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

  function resetTab1Chat(
    notice = "위에서 종목을 선택해 종합 분석 리포트를 먼저 확인하신 뒤, 리포트 내용 중 궁금한 점을 아래에서 자유롭게 질문해 주세요!"
  ) {
    t1ConversationId = "";
    t1LastCode = "";
    t1ChatMessages.innerHTML = "";
    appendChatBubble(t1ChatMessages, "bot", notice);
    t1ReportSection.classList.add("hidden");
    t1ReportBody.innerHTML = "";
    t1ContextBar.classList.add("hidden");
    t1SummaryCard.classList.add("hidden");
    t1TechStrip.classList.add("hidden");
    t1ChartsGrid.classList.add("hidden");
    t1ErrorBox.classList.add("hidden");
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

  function renderTab1Summary(stockData) {
    const snap = stockData.snapshot || {};
    const isEtf = stockData.asset_type === "etf";
    const badgeEl = document.getElementById("t1AssetBadge");
    badgeEl.textContent = isEtf ? "ETF" : "주식";
    badgeEl.className = `asset-badge ${isEtf ? "etf" : "stock"}`;

    document.getElementById("t1SummaryName").textContent = `${stockData.name} (${stockData.code})`;
    document.getElementById("t1SummaryPrice").textContent = formatNumber(snap.current_price, "원");

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
        `1년(52주) 중 현재 위치: ${pos}% (최저 ${formatNumber(snap.low52)} ~ 최고 ${formatNumber(snap.high52)})`;
      document.getElementById("t1RangeFill").style.width = `${pos}%`;
    } else {
      document.getElementById("t1RangeLabel").textContent = "52주 가격 위치 정보 없음";
      document.getElementById("t1RangeFill").style.width = "0%";
    }

    let cards = [];
    if (isEtf) {
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
        `20일선 <strong>${formatNumber(tech.ma20, "원")}</strong>`,
        `MACD <strong>${formatNumber(tech.macd)}</strong>`,
      ];
      t1TechStrip.innerHTML = pills.map((p) => `<span class="tech-pill">${p}</span>`).join("");
      t1TechStrip.classList.remove("hidden");
    } else {
      t1TechStrip.classList.add("hidden");
    }

    renderTab1Charts(stockData);
  }

  function renderTab1Charts(stockData) {
    const s = stockData.tech_series || {};
    const hasPriceSeries = Array.isArray(s.dates) && s.dates.length > 0;
    const isEtf = stockData.asset_type === "etf";

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

    if (isEtf) {
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

  async function sendTab1Request(code, question = "", isInitial = false) {
    if (!/^\d{6}$/.test(code)) {
      t1ErrorBox.textContent = "종목코드는 6자리 숫자여야 합니다. (예: 000660)";
      t1ErrorBox.classList.remove("hidden");
      return;
    }

    t1ErrorBox.classList.add("hidden");

    if (isInitial || (t1LastCode && t1LastCode !== code)) {
      t1ConversationId = "";
      if (isInitial) {
        t1ChatMessages.innerHTML = "";
        t1ReportSection.classList.add("hidden");
        t1ReportBody.innerHTML = "";
        t1ContextBar.classList.add("hidden");
        t1SummaryCard.classList.add("hidden");
        t1TechStrip.classList.add("hidden");
      }
    }
    t1LastCode = code;

    let thinkingBubble = null;
    if (isInitial) {
      t1LoadingBox.classList.remove("hidden");
    } else {
      appendChatBubble(t1ChatMessages, "user", `[${code}] ${question}`);
      thinkingBubble = appendChatBubble(t1ChatMessages, "bot", "분석된 데이터를 바탕으로 후속 질문 답변 작성 중...");
    }

    setTab1Busy(true);
    console.log(`[CHAT]       Dify 챗봇 요청 시작 (tab1, code=${code}, initial=${isInitial})`);

    try {
      const res = await fetch("/api/chat/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          question,
          conversation_id: t1ConversationId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 요청에 실패했습니다.");

      t1ConversationId = data.conversation_id || t1ConversationId;

      if (isInitial) {
        setBotFormattedContent(t1ReportBody, data.answer || "응답이 비어 있습니다.");
        t1ReportSection.classList.remove("hidden");
        appendChatBubble(
          t1ChatMessages,
          "bot",
          `${data.stock_data?.name || code} 종합 분석 리포트가 위 패널에 완성되었습니다! 리포트 내용 중 궁금한 점을 아래 추천 버튼이나 입력창으로 질문해 주세요.`
        );
      } else if (thinkingBubble) {
        setBotFormattedContent(thinkingBubble, data.answer || "응답이 비어 있습니다.");
        t1ChatMessages.scrollTop = t1ChatMessages.scrollHeight;
      }

      if (data.stock_data) {
        const s = data.stock_data.snapshot || {};
        if (data.stock_data.asset_type === "etf") {
          const etf = s.etf_info || {};
          t1ContextBar.textContent =
            `수집 근거 반영됨: ${data.stock_data.name} (${code}, ETF) · 현재가 ${formatNumber(s.current_price, "원")} · ` +
            `기초지수 ${etf.base_index || "-"} · 총보수 ${etf.total_fee ?? "-"}% · 뉴스 ${(data.stock_data.news || []).length}건`;
        } else {
          t1ContextBar.textContent =
            `수집 근거 반영됨: ${data.stock_data.name} (${code}) · 현재가 ${formatNumber(s.current_price, "원")} · ` +
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

  // 1) 종목 분석 시작 버튼 또는 코드 입력 후 엔터 -> 즉시 1차 종합 분석 실행
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
});
