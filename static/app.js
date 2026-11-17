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
  const t1ContextBar = document.getElementById("t1ContextBar");
  const t1ErrorBox = document.getElementById("t1ErrorBox");
  const t1ChatMessages = document.getElementById("t1ChatMessages");
  const t1ChatForm = document.getElementById("t1ChatForm");
  const t1QuestionInput = document.getElementById("t1QuestionInput");
  const t1SendBtn = document.getElementById("t1SendBtn");
  const t1ResetBtn = document.getElementById("t1ResetBtn");

  let t1ConversationId = "";
  let t1LastCode = "";

  function resetTab1Chat(
    notice = "새 대화가 시작되었습니다. 종목을 선택하거나 '종목 분석 시작'을 눌러주세요."
  ) {
    t1ConversationId = "";
    t1LastCode = "";
    t1ChatMessages.innerHTML = "";
    appendChatBubble(t1ChatMessages, "bot", notice);
    t1ContextBar.classList.add("hidden");
    t1ErrorBox.classList.add("hidden");
  }

  function setTab1Busy(isBusy) {
    t1AnalyzeBtn.disabled = isBusy;
    t1SendBtn.disabled = isBusy;
    t1QuestionInput.disabled = isBusy;
    t1CodeInput.disabled = isBusy;
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
        t1ContextBar.classList.add("hidden");
      }
    }
    t1LastCode = code;

    const userDisplay = isInitial
      ? `[${code}] 애널리스트 종합 심층 분석 요청`
      : `[${code}] ${question}`;
    appendChatBubble(t1ChatMessages, "user", userDisplay);

    const loadingMsg = isInitial
      ? "실시간 데이터 수집 및 애널리스트 심층 분석 리포트 작성 중..."
      : "분석된 데이터를 바탕으로 후속 질문 답변 작성 중...";
    const thinkingBubble = appendChatBubble(t1ChatMessages, "bot", loadingMsg);

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
      setBotFormattedContent(thinkingBubble, data.answer || "응답이 비어 있습니다.");
      t1ChatMessages.scrollTop = t1ChatMessages.scrollHeight;

      if (data.stock_data) {
        const s = data.stock_data.snapshot || {};
        t1ContextBar.textContent =
          `수집 근거 반영됨: ${data.stock_data.name} (${code}) · 현재가 ${formatNumber(s.current_price, "원")} · ` +
          `PER ${formatNumber(s.per, "배")} · PBR ${formatNumber(s.pbr, "배")} · 뉴스 ${(data.stock_data.news || []).length}건`;
        t1ContextBar.classList.remove("hidden");
      }
    } catch (err) {
      thinkingBubble.textContent = `오류: ${err.message}`;
      t1ErrorBox.textContent = err.message;
      t1ErrorBox.classList.remove("hidden");
      console.error(`[ERROR]      요청 또는 렌더링 중 오류 발생 (${err.message})`);
    } finally {
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
