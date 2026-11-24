import os
import re
import logging
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("StockAssistant")

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://stock.naver.com/",
}


def validate_stock_code(code: str) -> str:
    """종목코드가 6자리 숫자인지 검증하고 정제된 문자열을 반환합니다."""
    if not code or not isinstance(code, str):
        raise ValueError("종목코드가 입력되지 않았습니다.")
    cleaned = code.strip()
    if not re.fullmatch(r"\d{6}", cleaned):
        raise ValueError("종목코드는 6자리 숫자여야 합니다. (예: 000660)")
    return cleaned


def clean_number(value, is_float: bool = False):
    """콤마 및 단위가 섞인 문자열에서 순수 숫자만 추출합니다."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if is_float else int(value)

    text = str(value).strip().replace(",", "")
    if not text or text in ("-", "N/A"):
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    num_str = match.group(0)
    return float(num_str) if (is_float or "." in num_str) else int(num_str)


def parse_korean_market_cap(value: str):
    """'782조 4,266억' 형태의 시가총액 문자열을 원(KRW) 단위 순수 정수로 변환합니다."""
    if not value:
        return None
    text = str(value).replace(",", "").strip()
    total = 0

    jo_match = re.search(r"(\d+)\s*조", text)
    if jo_match:
        total += int(jo_match.group(1)) * 1_0000_0000_0000

    eok_match = re.search(r"(\d+)\s*억", text)
    if eok_match:
        total += int(eok_match.group(1)) * 1_0000_0000

    if total == 0:
        return clean_number(text, is_float=False)
    return total


def fetch_basic_info(code: str) -> dict:
    """네이버 증권 내부 JSON API(basic)를 호출해 공식 종목명과 기본 시세를 가져옵니다."""
    code = validate_stock_code(code)
    url = f"https://m.stock.naver.com/api/stock/{code}/basic"

    logger.info("[NAVER] 네이버 증권 JSON API 접근 시작 (User-Agent 적용): %s", url)

    try:
        resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=10)
    except requests.Timeout as e:
        raise TimeoutError("네이버 증권 서버 응답 시간이 초과되었습니다.") from e
    except requests.RequestException as e:
        raise ConnectionError(f"네이버 증권 API 연결에 실패했습니다: {e}") from e

    if resp.status_code == 404:
        raise ValueError(f"종목코드 '{code}'에 해당하는 종목을 찾을 수 없습니다.")
    if resp.status_code != 200:
        raise RuntimeError(f"네이버 증권 API 호출 실패 (HTTP {resp.status_code})")

    try:
        data = resp.json()
    except ValueError as e:
        raise ValueError("네이버 증권 응답을 JSON으로 변환하는 데 실패했습니다.") from e

    stock_name = data.get("stockName")
    if not stock_name:
        raise ValueError("공식 종목명을 파싱할 수 없습니다. (네이버 데이터 구조 확인 필요)")

    current_price = clean_number(data.get("closePrice"), is_float=False)
    change_rate = clean_number(data.get("fluctuationsRatio"), is_float=True)
    change_price = clean_number(data.get("compareToPreviousClosePrice"), is_float=False)
    asset_type = "etf" if data.get("stockEndType") == "etf" else "stock"
    market_name = (data.get("stockExchangeType") or {}).get("nameKor", "")

    logger.info("[PARSE] 기본 시세 추출 완료 (name=%s, type=%s, current_price=%s)", stock_name, asset_type, current_price)

    return {
        "code": code,
        "name": stock_name,
        "asset_type": asset_type,
        "market": market_name,
        "snapshot": {
            "current_price": current_price,
            "change_rate": change_rate,
            "change_price": change_price,
        },
    }


def fetch_integration_info(code: str) -> dict:
    """네이버 증권 integration API에서 밸류에이션, 시총, 52주 최고/최저, 목표주가를 가져옵니다."""
    code = validate_stock_code(code)
    url = f"https://m.stock.naver.com/api/stock/{code}/integration"

    logger.info("[NAVER] 네이버 증권 투자정보 JSON API 접근 시작: %s", url)

    try:
        resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=10)
    except requests.Timeout as e:
        raise TimeoutError("네이버 증권 투자정보 서버 응답 시간이 초과되었습니다.") from e
    except requests.RequestException as e:
        raise ConnectionError(f"네이버 증권 투자정보 API 연결 실패: {e}") from e

    if resp.status_code != 200:
        raise RuntimeError(f"네이버 증권 투자정보 API 호출 실패 (HTTP {resp.status_code})")

    try:
        data = resp.json()
    except ValueError as e:
        raise ValueError("투자정보 응답을 JSON으로 변환하는 데 실패했습니다.") from e

    # totalInfos 리스트를 code 기준 딕셔너리로 변환
    total_map = {
        item.get("code"): item.get("value")
        for item in data.get("totalInfos", [])
        if item.get("code")
    }
    consensus = data.get("consensusInfo") or {}
    etf_ind = data.get("etfKeyIndicator") or {}
    is_etf = data.get("stockEndType") == "etf" or bool(etf_ind)

    high52 = clean_number(
        total_map.get("highPriceOf52WeeksAdjusted") or total_map.get("highPriceOf52Weeks"),
        is_float=False,
    )
    low52 = clean_number(
        total_map.get("lowPriceOf52WeeksAdjusted") or total_map.get("lowPriceOf52Weeks"),
        is_float=False,
    )

    metrics = {
        "market_cap": parse_korean_market_cap(total_map.get("marketValue") or etf_ind.get("marketValue")),
        "high52": high52,
        "low52": low52,
        "volume": clean_number(total_map.get("accumulatedTradingVolume"), is_float=False),
        "trading_value": total_map.get("accumulatedTradingValue"),
        "open_price": clean_number(total_map.get("openPrice"), is_float=False),
        "high_price": clean_number(total_map.get("highPrice"), is_float=False),
        "low_price": clean_number(total_map.get("lowPrice"), is_float=False),
        "foreign_rate": clean_number(total_map.get("foreignRate"), is_float=True),
        "per": clean_number(total_map.get("per"), is_float=True),
        "eps": clean_number(total_map.get("eps"), is_float=False),
        "forward_per": clean_number(total_map.get("cnsPer"), is_float=True),
        "forward_eps": clean_number(total_map.get("cnsEps"), is_float=False),
        "pbr": clean_number(total_map.get("pbr"), is_float=True),
        "bps": clean_number(total_map.get("bps"), is_float=False),
        "dividend_yield": clean_number(
            total_map.get("dividendYieldRatio") or etf_ind.get("dividendYieldTtm"),
            is_float=True,
        ),
        "target_price": clean_number(consensus.get("priceTargetMean"), is_float=False),
    }

    # 최근 수급 (외국인 / 기관 / 개인 순매수)
    deal_trends = data.get("dealTrendInfos") or []
    if deal_trends:
        latest_deal = deal_trends[0]
        metrics["investor_trend"] = {
            "date": latest_deal.get("bizdate", ""),
            "foreigner": clean_number(latest_deal.get("foreignerPureBuyQuant"), is_float=False),
            "organ": clean_number(latest_deal.get("organPureBuyQuant"), is_float=False),
            "individual": clean_number(latest_deal.get("individualPureBuyQuant"), is_float=False),
        }

    # ETF 전용 핵심 지표 (KODEX 200 등)
    if is_etf:
        dev_sign = etf_ind.get("deviationSign", "")
        dev_val = clean_number(etf_ind.get("deviationRate"), is_float=True)
        if dev_val is not None and dev_sign == "-" and dev_val > 0:
            dev_val = -dev_val

        metrics["etf_info"] = {
            "base_index": total_map.get("etfBaseIdx") or "-",
            "issuer": etf_ind.get("issuerName") or total_map.get("issueName") or "-",
            "nav": clean_number(total_map.get("nav") or etf_ind.get("nav"), is_float=True),
            "total_nav": etf_ind.get("totalNav") or "-",
            "deviation_rate": dev_val,
            "total_fee": clean_number(etf_ind.get("totalFee") or total_map.get("fundPay"), is_float=True),
            "return_1m": clean_number(etf_ind.get("returnRate1m") or total_map.get("oneMonthEarnRate"), is_float=True),
            "return_3m": clean_number(etf_ind.get("returnRate3m") or total_map.get("threeMonthEarnRate"), is_float=True),
            "return_6m": clean_number(total_map.get("sixMonthEarnRate"), is_float=True),
            "return_1y": clean_number(etf_ind.get("returnRate1y") or total_map.get("oneYearEarnRate"), is_float=True),
        }

    logger.info(
        "[PARSE] 투자지표 추출 완료 (is_etf=%s, per=%s, pbr=%s, target_price=%s)",
        is_etf,
        metrics["per"],
        metrics["pbr"],
        metrics["target_price"],
    )
    return metrics


def fetch_financials(code: str) -> list:
    """와이즈리포트 iframe 및 실적 API(cF1001)를 호출해 연간 기업실적분석과 추정치 신호등을 파싱합니다."""
    code = validate_stock_code(code)
    iframe_url = f"https://navercomp.wisereport.co.kr/v3/company/c1010001.aspx?cmp_cd={code}"
    ajax_url = "https://navercomp.wisereport.co.kr/v3/company/ajax/cF1001.aspx"
    headers = {
        **DEFAULT_HEADERS,
        "Referer": iframe_url,
    }

    logger.info("[IFRAME] 와이즈리포트 실적 페이지 접근 시작: %s", iframe_url)

    try:
        resp_page = requests.get(iframe_url, headers=headers, timeout=10)
    except requests.Timeout as e:
        raise TimeoutError("와이즈리포트 서버 응답 시간이 초과되었습니다.") from e
    except requests.RequestException as e:
        raise ConnectionError(f"와이즈리포트 연결 실패: {e}") from e

    if resp_page.status_code != 200:
        raise RuntimeError(f"와이즈리포트 iframe 접근 실패 (HTTP {resp_page.status_code})")

    enc_match = re.search(r"encparam:\s*'([^']+)'", resp_page.text)
    if not enc_match:
        raise ValueError("와이즈리포트 실적 토큰(encparam)을 추출할 수 없습니다.")
    encparam = enc_match.group(1)

    try:
        resp_ajax = requests.get(
            ajax_url,
            params={
                "cmp_cd": code,
                "fin_typ": "0",
                "freq_typ": "Y",
                "encparam": encparam,
                "id": "0",
            },
            headers=headers,
            timeout=10,
        )
    except requests.Timeout as e:
        raise TimeoutError("와이즈리포트 실적 데이터 요청 시간이 초과되었습니다.") from e
    except requests.RequestException as e:
        raise ConnectionError(f"와이즈리포트 실적 데이터 요청 실패: {e}") from e

    if resp_ajax.status_code != 200:
        raise RuntimeError(f"와이즈리포트 실적 API 호출 실패 (HTTP {resp_ajax.status_code})")

    soup = BeautifulSoup(resp_ajax.text, "html.parser")
    target_tables = [t for t in soup.select("table") if "매출액" in t.get_text()]
    if not target_tables:
        raise ValueError("와이즈리포트 실적 테이블을 찾을 수 없습니다. (데이터 구조 변경 가능성)")

    table = target_tables[-1]
    thead_rows = table.select("thead tr")
    if not thead_rows:
        raise ValueError("실적 테이블 헤더를 파싱할 수 없습니다.")

    period_headers = [th.get_text(" ", strip=True) for th in thead_rows[-1].select("th")]
    if not period_headers:
        raise ValueError("실적 테이블 기간 헤더가 비어 있습니다.")

    # 추출 대상 지표 (라벨 -> JSON 키, 실수 여부)
    target_rows = {
        "매출액": ("revenue", False),
        "영업이익": ("operating_income", False),
        "영업이익률": ("operating_margin", True),
        "ROE(%)": ("roe", True),
        "부채비율": ("debt_ratio", True),
        "영업활동현금흐름": ("operating_cash_flow", False),
    }

    row_values = {}
    for tr in table.select("tbody tr"):
        th = tr.select_one("th")
        if not th:
            continue
        label = th.get_text(strip=True)
        if label in target_rows:
            key, is_float = target_rows[label]
            tds = [clean_number(td.get_text(strip=True), is_float=is_float) for td in tr.select("td")]
            row_values[key] = tds

    financials = []
    for idx, raw_header in enumerate(period_headers):
        period_match = re.search(r"(\d{4})/(\d{2})", raw_header)
        period_str = f"{period_match.group(1)}.{period_match.group(2)}" if period_match else raw_header
        is_consensus = "(E)" in raw_header

        item = {
            "period": period_str,
            "period_type": "annual",
            "is_consensus": is_consensus,
            "revenue": row_values.get("revenue", [None] * len(period_headers))[idx] if idx < len(row_values.get("revenue", [])) else None,
            "operating_income": row_values.get("operating_income", [None] * len(period_headers))[idx] if idx < len(row_values.get("operating_income", [])) else None,
            "operating_margin": row_values.get("operating_margin", [None] * len(period_headers))[idx] if idx < len(row_values.get("operating_margin", [])) else None,
            "roe": row_values.get("roe", [None] * len(period_headers))[idx] if idx < len(row_values.get("roe", [])) else None,
            "debt_ratio": row_values.get("debt_ratio", [None] * len(period_headers))[idx] if idx < len(row_values.get("debt_ratio", [])) else None,
            "operating_cash_flow": row_values.get("operating_cash_flow", [None] * len(period_headers))[idx] if idx < len(row_values.get("operating_cash_flow", [])) else None,
        }
        financials.append(item)

    logger.info("[IFRAME] 와이즈리포트 실적 테이블 파싱 완료 (총 %d개 연도, is_consensus 구분 완료)", len(financials))
    return financials


def fetch_news(stock_name: str, limit: int = 5) -> list:
    """파싱된 공식 종목명을 검색어로 Serper News API를 호출하여 최신 관련 뉴스를 수집합니다."""
    if not stock_name:
        raise ValueError("종목명이 없어 뉴스를 검색할 수 없습니다.")

    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key or api_key == "your_serper_api_key_here":
        raise ValueError("SERPER_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.")

    url = "https://google.serper.dev/news"
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "q": stock_name,
        "gl": "kr",
        "hl": "ko",
        "num": limit,
    }

    logger.info("[SERPER] Serper News API 호출 시작 (query=%s)", stock_name)

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=10)
    except requests.Timeout as e:
        raise TimeoutError("Serper News API 응답 시간이 초과되었습니다.") from e
    except requests.RequestException as e:
        raise ConnectionError(f"Serper News API 연결에 실패했습니다: {e}") from e

    if resp.status_code in (401, 403):
        raise PermissionError("Serper API Key가 유효하지 않거나 권한이 없습니다.")
    if resp.status_code != 200:
        raise RuntimeError(f"Serper News API 호출 실패 (HTTP {resp.status_code})")

    try:
        data = resp.json()
    except ValueError as e:
        raise ValueError("Serper News API 응답을 JSON으로 변환하는 데 실패했습니다.") from e

    raw_news = data.get("news", [])[:limit]
    articles = []
    for item in raw_news:
        articles.append({
            "title": item.get("title", ""),
            "link": item.get("link", ""),
            "snippet": item.get("snippet", ""),
            "date": item.get("date", ""),
            "source": item.get("source", ""),
        })

    logger.info("[SERPER] 뉴스 수집 완료 (수집된 기사 수=%d)", len(articles))
    return articles


def fetch_market_environment() -> dict:
    """코스피, 코스닥, 원/달러 환율 현황을 네이버 증권 API로 조회합니다."""
    env = {}
    targets = [
        ("kospi", "https://m.stock.naver.com/api/index/KOSPI/basic", None),
        ("kosdaq", "https://m.stock.naver.com/api/index/KOSDAQ/basic", None),
        ("usdkrw", "https://m.stock.naver.com/front-api/marketIndex/productDetail", {"category": "exchange", "reutersCode": "FX_USDKRW"}),
    ]
    for key, url, params in targets:
        try:
            resp = requests.get(url, params=params, headers=DEFAULT_HEADERS, timeout=5)
            if resp.status_code != 200:
                continue
            raw = resp.json()
            data = raw.get("result") if "result" in raw else raw
            env[key] = {
                "value": clean_number(data.get("closePrice"), is_float=True),
                "change_rate": clean_number(data.get("fluctuationsRatio"), is_float=True),
            }
        except Exception as e:
            logger.warning("[NAVER] 시장 지표(%s) 조회 실패: %s", key, e)
    return env


def collect_stock_data(code: str) -> dict:
    """종목코드를 받아 시세, 밸류에이션, 실적, 뉴스, 시장환경을 통합 수집합니다. (부분 실패 허용)"""
    code = validate_stock_code(code)
    result = {
        "code": code,
        "name": None,
        "asset_type": "stock",
        "market": "",
        "snapshot": {},
        "financials": [],
        "news": [],
        "market_env": {},
        "errors": [],
    }

    # 1. 기본 시세 및 공식 종목명 (필수 선행 단계)
    try:
        basic = fetch_basic_info(code)
        result["name"] = basic["name"]
        result["asset_type"] = basic.get("asset_type", "stock")
        result["market"] = basic.get("market", "")
        result["snapshot"].update(basic["snapshot"])
    except Exception as e:
        logger.error("[ERROR] 기본 시세 수집 실패: %s", e, exc_info=True)
        result["errors"].append({"area": "basic", "message": str(e)})
        return result

    # 2. 투자정보 및 밸류에이션 / ETF 지표 (부분 실패 허용)
    try:
        integration = fetch_integration_info(code)
        result["snapshot"].update(integration)
        # 52주 최저~최고 대비 현재가 위치(%) 계산
        cur = result["snapshot"].get("current_price")
        hi = result["snapshot"].get("high52")
        lo = result["snapshot"].get("low52")
        if cur is not None and hi is not None and lo is not None and hi > lo:
            pos = ((cur - lo) / (hi - lo)) * 100.0
            result["snapshot"]["position_52w"] = round(max(0.0, min(100.0, pos)), 1)
    except Exception as e:
        logger.error("[ERROR] 투자정보 수집 실패: %s", e, exc_info=True)
        result["errors"].append({"area": "integration", "message": str(e)})

    # 3. 와이즈리포트 기업실적분석 (ETF가 아닌 일반 주식일 때만 조회)
    if result["asset_type"] != "etf":
        try:
            result["financials"] = fetch_financials(code)
        except Exception as e:
            logger.error("[ERROR] 기업실적분석 수집 실패: %s", e, exc_info=True)
            result["errors"].append({"area": "financials", "message": str(e)})

    # 4. 공식 종목명 기반 Serper 뉴스 검색 (부분 실패 허용)
    try:
        result["news"] = fetch_news(result["name"], limit=5)
    except Exception as e:
        logger.error("[ERROR] 뉴스 수집 실패: %s", e, exc_info=True)
        result["errors"].append({"area": "news", "message": str(e)})

    # 5. 시장 환경(코스피, 코스닥, 원/달러) 조회 (부분 실패 허용)
    try:
        result["market_env"] = fetch_market_environment()
    except Exception as e:
        logger.warning("[NAVER] 시장 환경 조회 중 오류: %s", e)

    return result


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    import json
    data = collect_stock_data("000660")
    print(json.dumps(data, ensure_ascii=False, indent=2))
