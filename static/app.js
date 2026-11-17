document.addEventListener("DOMContentLoaded", () => {
  console.log("[PAGE]    페이지 로드 완료");

  const healthStatusEl = document.getElementById("healthStatus");
  const searchForm = document.getElementById("searchForm");
  const stockCodeInput = document.getElementById("stockCodeInput");
  const fetchBtn = document.getElementById("fetchBtn");
  const loadingBox = document.getElementById("loadingBox");
  const errorBox = document.getElementById("errorBox");
  const partialErrorBox = document.getElementById("partialErrorBox");
  const resultSection = document.getElementById("resultSection");

  // 숫자 포맷 헬퍼
  const formatNumber = (val, suffix = "") => {
    if (val === null || val === undefined || Number.isNaN(val)) return "-";
    return `${Number(val).toLocaleString("ko-KR")}${suffix}`;
  };

  // 시가총액(원) -> 조/억 단위 포맷팅
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

  // 서버 상태 점검 (/health)
  async function checkServerHealth() {
    try {
      const res = await fetch("/health");
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        const serperOk = data.services?.serper_api_configured;
        if (serperOk) {
          healthStatusEl.textContent = "서버 정상 (Serper API 연결됨)";
          healthStatusEl.className = "health-badge ok";
        } else {
          healthStatusEl.textContent = "서버 정상 (Serper Key 미설정)";
          healthStatusEl.className = "health-badge warn";
        }
      } else {
        throw new Error("헬스체크 응답 이상");
      }
    } catch (err) {
      console.error("[ERROR]   수집 중 오류 발생 (서버 상태 확인 실패)", err.message);
      healthStatusEl.textContent = "서버 연결 오류";
      healthStatusEl.className = "health-badge fail";
    }
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  function hideMessages() {
    errorBox.classList.add("hidden");
    partialErrorBox.classList.add("hidden");
  }

  function setLoading(isLoading) {
    fetchBtn.disabled = isLoading;
    stockCodeInput.disabled = isLoading;
    loadingBox.classList.toggle("hidden", !isLoading);
  }

  // 데이터 렌더링
  function renderResult(data) {
    const snap = data.snapshot || {};

    // 1. 시세 히어로 카드
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

    // 2. 핵심 투자정보 카드 그리드
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

      const labelEl = document.createElement("div");
      labelEl.className = "metric-label";
      labelEl.textContent = m.label;

      const valueEl = document.createElement("div");
      valueEl.className = "metric-value";
      valueEl.textContent = m.value;

      card.appendChild(labelEl);
      card.appendChild(valueEl);
      metricsGrid.appendChild(card);
    });

    // 3. 기업실적분석 테이블
    const financialBody = document.getElementById("financialBody");
    financialBody.innerHTML = "";

    const financials = data.financials || [];
    if (financials.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 8;
      td.textContent = "수집된 실적 데이터가 없습니다.";
      tr.appendChild(td);
      financialBody.appendChild(tr);
    } else {
      financials.forEach((row) => {
        const tr = document.createElement("tr");
        if (row.is_consensus) {
          tr.className = "consensus-row";
        }

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

        cells.forEach((cellVal, idx) => {
          const td = document.createElement("td");
          if (idx === 1) {
            const badge = document.createElement("span");
            badge.className = row.is_consensus ? "badge-consensus" : "badge-actual";
            badge.textContent = cellVal;
            td.appendChild(badge);
          } else {
            td.textContent = cellVal;
          }
          tr.appendChild(td);
        });

        financialBody.appendChild(tr);
      });
    }

    // 4. 최신 관련 뉴스
    const newsList = document.getElementById("newsList");
    newsList.innerHTML = "";
    const newsItems = data.news || [];

    if (newsItems.length === 0) {
      const li = document.createElement("li");
      li.className = "news-item";
      li.textContent = "수집된 관련 뉴스가 없습니다.";
      newsList.appendChild(li);
    } else {
      newsItems.forEach((item) => {
        const li = document.createElement("li");
        li.className = "news-item";

        const titleLink = document.createElement("a");
        titleLink.className = "news-title";
        titleLink.href = item.link || "#";
        titleLink.target = "_blank";
        titleLink.rel = "noopener noreferrer";
        titleLink.textContent = item.title || "제목 없음";

        const meta = document.createElement("div");
        meta.className = "news-meta";
        meta.textContent = `${item.source || "언론사"} · ${item.date || "날짜 미상"}`;

        li.appendChild(titleLink);
        li.appendChild(meta);

        if (item.snippet) {
          const snippet = document.createElement("p");
          snippet.className = "news-snippet";
          snippet.textContent = item.snippet;
          li.appendChild(snippet);
        }

        newsList.appendChild(li);
      });
    }

    // 5. 부분 실패 경고 및 원본 JSON 출력
    const errors = data.errors || [];
    if (errors.length > 0) {
      partialErrorBox.textContent =
        "일부 영역 수집 중 경고: " + errors.map((e) => `[${e.area}] ${e.message}`).join(" / ");
      partialErrorBox.classList.remove("hidden");
    }

    document.getElementById("rawJsonOutput").textContent = JSON.stringify(data, null, 2);
    resultSection.classList.remove("hidden");

    console.log("[RENDER]  화면 데이터 카드 렌더링 완료");
  }

  // 데이터 수집 요청
  async function fetchStock(code) {
    const cleaned = code.trim();
    if (!/^\d{6}$/.test(cleaned)) {
      const msg = "종목코드는 6자리 숫자여야 합니다. (예: 000660)";
      showError(msg);
      console.error(`[ERROR]   수집 중 오류 발생 (${msg})`);
      return;
    }

    hideMessages();
    setLoading(true);
    console.log(`[SEARCH]  종목 수집 요청 시작 (${cleaned})`);

    try {
      const res = await fetch("/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleaned }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
      }

      if (!data.name && data.errors?.length) {
        throw new Error(data.errors[0].message);
      }

      console.log(
        `[PARSED]  기본 정보 수집 완료 (${data.name}, ${formatNumber(data.snapshot?.current_price, "원")})`
      );
      console.log(`[NEWS]    뉴스 수집 완료 (${(data.news || []).length}건)`);

      renderResult(data);
    } catch (err) {
      showError(err.message);
      console.error(`[ERROR]   수집 중 오류 발생 (${err.message})`);
    } finally {
      setLoading(false);
    }
  }

  // 이벤트 바인딩
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    fetchStock(stockCodeInput.value);
  });

  document.querySelectorAll(".chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.code;
      stockCodeInput.value = code;
      fetchStock(code);
    });
  });

  checkServerHealth();
});
