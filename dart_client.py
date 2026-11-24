import os
import io
import json
import time
import zipfile
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("StockAssistant")

CORP_MAP_CACHE_FILE = os.path.join(os.path.dirname(__file__), "dart_corp_map.json")
CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7일


def _get_dart_api_key() -> str:
    key = os.getenv("DART_API_KEY", "").strip()
    if not key or key.startswith("your_"):
        raise ValueError("DART_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.")
    return key


def _load_or_refresh_corp_map(api_key: str) -> dict:
    """종목코드(6자리) -> DART 고유번호(8자리) 매핑을 캐시에서 불러오거나 새로 다운로드합니다."""
    if os.path.exists(CORP_MAP_CACHE_FILE):
        age = time.time() - os.path.getmtime(CORP_MAP_CACHE_FILE)
        if age < CACHE_TTL_SECONDS:
            try:
                with open(CORP_MAP_CACHE_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

    logger.info("[DART] Open DART 전체 기업 고유번호(corpCode.xml) 다운로드 시작")
    url = "https://opendart.fss.or.kr/api/corpCode.xml"
    resp = requests.get(url, params={"crtfc_key": api_key}, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"Open DART corpCode 다운로드 실패 (HTTP {resp.status_code})")

    # ZIP 압축 해제 및 XML 파싱 (상장 종목코드가 있는 기업만 추출)
    corp_map = {}
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        xml_name = zf.namelist()[0]
        with zf.open(xml_name) as xml_file:
            tree = ET.parse(xml_file)
            root = tree.getroot()
            for item in root.findall("list"):
                stock_code = (item.findtext("stock_code") or "").strip()
                corp_code = (item.findtext("corp_code") or "").strip()
                corp_name = (item.findtext("corp_name") or "").strip()
                if stock_code and corp_code:
                    corp_map[stock_code] = {
                        "corp_code": corp_code,
                        "corp_name": corp_name,
                    }

    try:
        with open(CORP_MAP_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(corp_map, f, ensure_ascii=False)
        logger.info("[DART] 기업 고유번호 매핑 캐시 저장 완료 (상장사 %d개)", len(corp_map))
    except Exception as e:
        logger.warning("[DART] 캐시 파일 저장 실패 (무시): %s", e)

    return corp_map


def _classify_disclosure(title: str) -> str:
    """공시 제목을 초보자가 알아보기 쉬운 카테고리로 분류합니다."""
    if any(k in title for k in ("분기보고서", "반기보고서", "사업보고서")):
        return "정기보고서"
    if "잠정" in title and "실적" in title:
        return "잠정실적"
    if "배당" in title:
        return "주주환원"
    if "자기주식" in title:
        return "자사주"
    if any(k in title for k in ("임원", "주요주주", "대량보유")):
        return "지분변동"
    if "주요사항" in title:
        return "주요사항"
    return "기타공시"


def fetch_recent_disclosures(stock_code: str, days: int = 90, limit: int = 10) -> list:
    """Open DART API를 호출하여 최근 N일(기본 90일)간의 주요 공시 목록을 가져옵니다."""
    api_key = _get_dart_api_key()
    corp_map = _load_or_refresh_corp_map(api_key)

    corp_info = corp_map.get(str(stock_code).strip())
    if not corp_info:
        # ETF 등 비상장법인은 DART 공시 대상이 아니므로 빈 목록 반환
        return []

    corp_code = corp_info["corp_code"]
    end_dt = datetime.today()
    bgn_dt = end_dt - timedelta(days=days)

    logger.info("[DART] 최근 공시 조회 시작 (stock=%s, corp_code=%s)", stock_code, corp_code)

    url = "https://opendart.fss.or.kr/api/list.json"
    params = {
        "crtfc_key": api_key,
        "corp_code": corp_code,
        "bgn_de": bgn_dt.strftime("%Y%m%d"),
        "end_de": end_dt.strftime("%Y%m%d"),
        "page_no": 1,
        "page_count": 30,
    }

    resp = requests.get(url, params=params, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"Open DART 공시 목록 API 실패 (HTTP {resp.status_code})")

    data = resp.json()
    status = data.get("status")
    if status == "013":
        # 조회된 데이터 없음
        return []
    if status != "000":
        raise RuntimeError(f"Open DART 오류 ({status}): {data.get('message')}")

    disclosures = []
    for item in data.get("list", [])[:limit]:
        rcept_dt = item.get("rcept_dt", "")
        date_str = f"{rcept_dt[:4]}-{rcept_dt[4:6]}-{rcept_dt[6:8]}" if len(rcept_dt) == 8 else rcept_dt
        rcept_no = item.get("rcept_no", "")
        title = item.get("report_nm", "")

        disclosures.append({
            "date": date_str,
            "category": _classify_disclosure(title),
            "title": title,
            "submitter": item.get("flr_nm", ""),
            "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}" if rcept_no else "",
        })

    logger.info("[DART] 공시 %d건 수집 완료 (stock=%s)", len(disclosures), stock_code)
    return disclosures


_CATALOG_CACHE = None


def _get_stock_catalog() -> list:
    """국내 상장 주식(Open DART) + 국내 ETF(FinanceDataReader) 통합 검색 카탈로그를 로드합니다."""
    global _CATALOG_CACHE
    if _CATALOG_CACHE is not None:
        return _CATALOG_CACHE

    catalog_map = {}

    # 1. Open DART 상장사 캐시 (주식)
    try:
        api_key = os.getenv("DART_API_KEY", "").strip()
        if api_key and not api_key.startswith("your_"):
            corp_map = _load_or_refresh_corp_map(api_key)
            for code, info in corp_map.items():
                catalog_map[code] = {
                    "code": code,
                    "name": info.get("corp_name", ""),
                    "type": "주식",
                }
    except Exception as e:
        logger.warning("[SEARCH] DART 카탈로그 로드 실패: %s", e)

    # 2. FinanceDataReader ETF 목록
    try:
        import FinanceDataReader as fdr
        etf_df = fdr.StockListing("ETF/KR")
        if etf_df is not None and not etf_df.empty:
            for _, row in etf_df.iterrows():
                code = str(row.get("Symbol", "")).strip()
                name = str(row.get("Name", "")).strip()
                if code and name:
                    catalog_map[code] = {
                        "code": code,
                        "name": name,
                        "type": "ETF",
                    }
    except Exception as e:
        logger.warning("[SEARCH] FDR ETF 목록 로드 실패: %s", e)

    _CATALOG_CACHE = list(catalog_map.values())
    logger.info("[SEARCH] 통합 종목 검색 카탈로그 준비 완료 (총 %d개 종목/ETF)", len(_CATALOG_CACHE))
    return _CATALOG_CACHE


def search_stock_catalog(query: str, limit: int = 10) -> list:
    """네이버 통합 검색 API(국내+미국 주식/ETF)로 자동완성 후보를 조회하고, 실패 시 로컬 카탈로그로 fallback합니다."""
    q = (query or "").strip()
    if not q:
        return []

    # 1차: 네이버 증권 통합 검색 API (국내 주식/ETF + 미국 주식/ETF 실시간 지원)
    try:
        resp = requests.get(
            "https://m.stock.naver.com/front-api/search",
            params={"q": q, "target": "stock", "size": limit, "page": 1},
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://stock.naver.com/"},
            timeout=5,
        )
        if resp.status_code == 200:
            items = ((resp.json() or {}).get("result") or {}).get("items") or []
            results = []
            for item in items:
                nation = item.get("nationCode", "")
                if nation not in ("KOR", "USA"):
                    continue
                is_etf = bool(item.get("isEtf")) or item.get("category") == "etf"
                prefix = "미국" if nation == "USA" else "국내"
                kind = f"{prefix} {'ETF' if is_etf else '주식'}"
                reuters_code = item.get("reutersCode") or item.get("code")
                if reuters_code and item.get("name"):
                    results.append({
                        "code": reuters_code,
                        "symbol": item.get("code", reuters_code),
                        "name": item.get("name"),
                        "type": kind,
                        "nation": nation,
                    })
            if results:
                return results[:limit]
    except Exception as e:
        logger.warning("[SEARCH] 네이버 통합 검색 fallback 전환: %s", e)

    # 2차: 로컬 DART+FDR 카탈로그 fallback
    q_lower = q.lower()
    catalog = _get_stock_catalog()

    exact_matches = []
    prefix_matches = []
    contains_matches = []

    for item in catalog:
        name_lower = item["name"].lower()
        code_lower = item["code"].lower()
        if name_lower == q_lower or code_lower == q_lower:
            exact_matches.append(item)
        elif name_lower.startswith(q_lower) or code_lower.startswith(q_lower):
            prefix_matches.append(item)
        elif q_lower in name_lower or q_lower in code_lower:
            contains_matches.append(item)

    prefix_matches.sort(key=lambda x: len(x["name"]))
    contains_matches.sort(key=lambda x: len(x["name"]))

    return (exact_matches + prefix_matches + contains_matches)[:limit]


def resolve_stock_code(query_or_code: str) -> str:
    """국내 6자리 또는 로이터코드(NVDA.O)면 그대로 반환하고, 종목명/티커(NVDA, 애플)면 네이버 검색으로 코드를 찾습니다."""
    cleaned = (query_or_code or "").strip()
    if not cleaned:
        return cleaned
    if cleaned.isdigit() and len(cleaned) == 6:
        return cleaned
    if "." in cleaned and cleaned.replace(".", "").replace("-", "").isalnum():
        return cleaned.upper()

    matches = search_stock_catalog(cleaned, limit=1)
    if matches:
        return matches[0]["code"]
    return cleaned.upper()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    res = fetch_recent_disclosures("005930", days=90, limit=5)
    print(json.dumps(res, ensure_ascii=False, indent=2))
