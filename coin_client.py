import time
import logging
import requests
import pandas as pd
from collector import fetch_news, fetch_market_environment
from quant_engine import compute_tv_indicators_from_df

logger = logging.getLogger("StockAssistant")

UPBIT_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
}

_COIN_MARKET_CACHE = None
_COIN_CACHE_TIME = 0.0
COIN_CACHE_TTL = 3600  # 1시간

UPBIT_TIMEFRAMES = {
    "minute1": ("minutes/1", True),
    "minute5": ("minutes/5", True),
    "minute10": ("minutes/10", True),
    "minute15": ("minutes/15", True),
    "minute30": ("minutes/30", True),
    "minute60": ("minutes/60", True),
    "day": ("days", False),
    "week": ("weeks", False),
    "month": ("months", False),
}


def get_upbit_markets() -> list:
    """업비트 원화(KRW) 마켓 전체 코인 목록을 조회하고 캐싱합니다."""
    global _COIN_MARKET_CACHE, _COIN_CACHE_TIME
    if _COIN_MARKET_CACHE is not None and (time.time() - _COIN_CACHE_TIME) < COIN_CACHE_TTL:
        return _COIN_MARKET_CACHE

    url = "https://api.upbit.com/v1/market/all"
    resp = requests.get(url, params={"isDetails": "true"}, headers=UPBIT_HEADERS, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"업비트 마켓 목록 조회 실패 (HTTP {resp.status_code})")

    markets = []
    for item in resp.json():
        mkt = item.get("market", "")
        if not mkt.startswith("KRW-"):
            continue
        symbol = mkt.replace("KRW-", "")
        event = item.get("market_event") or {}
        markets.append({
            "market": mkt,
            "symbol": symbol,
            "korean_name": item.get("korean_name", symbol),
            "english_name": item.get("english_name", symbol),
            "warning": bool(event.get("warning", False)),
        })

    _COIN_MARKET_CACHE = markets
    _COIN_CACHE_TIME = time.time()
    logger.info("[UPBIT] 원화 마켓 코인 %d개 로드 완료", len(markets))
    return markets


def search_coins(query: str, limit: int = 10) -> list:
    """코인 한글명, 영문명, 티커(BTC)로 자동완성 후보를 검색합니다."""
    q = (query or "").strip().lower()
    if not q:
        return []

    markets = get_upbit_markets()
    exact, prefix, contains = [], [], []

    for m in markets:
        k_name = m["korean_name"].lower()
        e_name = m["english_name"].lower()
        sym = m["symbol"].lower()
        mkt = m["market"].lower()

        if q in (sym, k_name, e_name, mkt):
            exact.append(m)
        elif sym.startswith(q) or k_name.startswith(q) or e_name.startswith(q):
            prefix.append(m)
        elif q in sym or q in k_name or q in e_name:
            contains.append(m)

    prefix.sort(key=lambda x: len(x["korean_name"]))
    contains.sort(key=lambda x: len(x["korean_name"]))
    return (exact + prefix + contains)[:limit]


def resolve_coin_market(query_or_market: str) -> dict:
    """'비트코인', 'BTC', 'KRW-BTC' 등 어떤 입력도 업비트 마켓 정보로 변환합니다."""
    cleaned = (query_or_market or "").strip()
    if not cleaned:
        raise ValueError("코인명 또는 티커를 입력해 주세요. (예: 비트코인, BTC)")

    matches = search_coins(cleaned, limit=1)
    if matches:
        return matches[0]

    upper = cleaned.upper()
    if not upper.startswith("KRW-"):
        upper = f"KRW-{upper}"
    raise ValueError(f"업비트 원화 마켓에서 '{cleaned}' 코인을 찾을 수 없습니다.")


def fetch_fear_and_greed() -> dict:
    """Alternative.me 공포·탐욕 지수(0~100)를 조회합니다."""
    try:
        resp = requests.get("https://api.alternative.me/fng/", timeout=5)
        if resp.status_code != 200:
            return {}
        row = (resp.json().get("data") or [{}])[0]
        val = int(row.get("value", 0))
        raw_cls = row.get("value_classification", "")
        kr_map = {
            "Extreme Fear": "극단적 공포",
            "Fear": "공포",
            "Neutral": "중립",
            "Greed": "탐욕",
            "Extreme Greed": "극단적 탐욕",
        }
        return {
            "value": val,
            "classification": raw_cls,
            "classification_kr": kr_map.get(raw_cls, raw_cls),
        }
    except Exception as e:
        logger.warning("[COIN] 공포·탐욕 지수 조회 실패: %s", e)
        return {}


def fetch_kimchi_premium(symbol: str, krw_price: float, usdkrw: float = None) -> float:
    """바이낸스 USDT 시세 및 원/달러 환율을 기준으로 김치프리미엄(%)을 계산합니다."""
    try:
        if not usdkrw:
            env = fetch_market_environment()
            usdkrw = (env.get("usdkrw") or {}).get("value")
        if not usdkrw or not krw_price:
            return None

        resp = requests.get(
            "https://api.binance.com/api/v3/ticker/price",
            params={"symbol": f"{symbol}USDT"},
            timeout=5,
        )
        if resp.status_code != 200:
            return None
        usdt_price = float(resp.json().get("price", 0))
        if usdt_price <= 0:
            return None

        global_krw = usdt_price * float(usdkrw)
        premium = ((float(krw_price) - global_krw) / global_krw) * 100.0
        return round(premium, 2)
    except Exception:
        return None


def fetch_coin_snapshot(market_info: dict) -> dict:
    """업비트 Ticker API에서 코인 현재가, 등락률, 24시간 거래대금, 52주 최고/최저를 조회합니다."""
    market = market_info["market"]
    resp = requests.get(
        "https://api.upbit.com/v1/ticker",
        params={"markets": market},
        headers=UPBIT_HEADERS,
        timeout=10,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"업비트 시세 조회 실패 (HTTP {resp.status_code})")

    rows = resp.json()
    if not rows:
        raise ValueError(f"'{market}' 시세 데이터가 없습니다.")
    t = rows[0]

    cur = float(t.get("trade_price", 0))
    hi52 = float(t.get("highest_52_week_price", 0))
    lo52 = float(t.get("lowest_52_week_price", 0))
    pos_52w = None
    if hi52 > lo52 > 0:
        pos_52w = round(max(0.0, min(100.0, ((cur - lo52) / (hi52 - lo52)) * 100.0)), 1)

    return {
        "current_price": cur,
        "change_rate": round(float(t.get("signed_change_rate", 0)) * 100.0, 2),
        "change_price": float(t.get("signed_change_price", 0)),
        "open_price": float(t.get("opening_price", 0)),
        "high_price": float(t.get("high_price", 0)),
        "low_price": float(t.get("low_price", 0)),
        "volume_24h": round(float(t.get("acc_trade_volume_24h", 0)), 2),
        "trade_value_24h": int(round(float(t.get("acc_trade_price_24h", 0)))),
        "high52": hi52,
        "low52": lo52,
        "position_52w": pos_52w,
    }


def fetch_coin_chart_with_indicators(market: str, timeframe: str = "day") -> dict:
    """업비트 캔들 API(분/일/주/월봉)를 조회해 32종+ 기술적 지표와 TradingView 차트 데이터를 생성합니다."""
    tf_key = timeframe if timeframe in UPBIT_TIMEFRAMES else "day"
    endpoint, is_minute = UPBIT_TIMEFRAMES[tf_key]

    url = f"https://api.upbit.com/v1/candles/{endpoint}"
    resp = requests.get(
        url,
        params={"market": market, "count": 200},
        headers=UPBIT_HEADERS,
        timeout=10,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"업비트 캔들 조회 실패 (HTTP {resp.status_code})")

    rows = resp.json()
    if not isinstance(rows, list) or len(rows) < 5:
        raise ValueError(f"'{market}'의 {tf_key} 캔들 데이터가 충분하지 않습니다.")

    df = pd.DataFrame(rows)
    df["Date"] = pd.to_datetime(df["candle_date_time_kst"])
    df = df.rename(columns={
        "opening_price": "Open",
        "high_price": "High",
        "low_price": "Low",
        "trade_price": "Close",
        "candle_acc_trade_volume": "Volume",
    })
    df = df.set_index("Date").sort_index()
    df = df[~df.index.duplicated(keep="last")]
    for col in ("Open", "High", "Low", "Close", "Volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["Close"])

    # 1,000원 미만 저가 코인은 소수점 2자리, 그 이상은 정수
    latest_close = float(df["Close"].iloc[-1])
    price_dec = 2 if latest_close < 1000 else 0

    return compute_tv_indicators_from_df(
        df=df,
        code=market,
        tf_key=tf_key,
        is_minute=is_minute,
        is_foreign=False,
        price_dec=price_dec,
    )


def collect_coin_data(query_or_market: str) -> dict:
    """코인 시세 + 공포·탐욕 지수 + 김치프리미엄 + 최신 뉴스 + 일봉 차트·지표를 통합 수집합니다."""
    market_info = resolve_coin_market(query_or_market)
    market = market_info["market"]
    name = market_info["korean_name"]
    symbol = market_info["symbol"]

    logger.info("[UPBIT] 코인 통합 데이터 수집 시작 (market=%s, name=%s)", market, name)

    snapshot = fetch_coin_snapshot(market_info)
    fng = fetch_fear_and_greed()
    market_env = fetch_market_environment()
    usdkrw = (market_env.get("usdkrw") or {}).get("value")
    kimchi_premium = fetch_kimchi_premium(symbol, snapshot["current_price"], usdkrw=usdkrw)

    news = []
    try:
        news = fetch_news(f"{name} 코인", limit=5)
    except Exception as e:
        logger.warning("[COIN] 코인 뉴스 수집 실패 (무시): %s", e)

    tv_chart = None
    technical = {}
    try:
        tv_chart = fetch_coin_chart_with_indicators(market, timeframe="day")
        if tv_chart and tv_chart.get("ohlcv"):
            last_bar = tv_chart["ohlcv"][-1]
            def _last_val(arr):
                return arr[-1]["value"] if arr else None
            technical = {
                "date": last_bar["label"],
                "close": last_bar["close"],
                "ma20": _last_val(tv_chart.get("ma20")),
                "ma60": _last_val(tv_chart.get("ma60")),
                "rsi14": _last_val(tv_chart.get("rsi14")),
                "macd": _last_val(tv_chart.get("macd")),
                "bb_upper": _last_val(tv_chart.get("bb_upper")),
                "bb_lower": _last_val(tv_chart.get("bb_lower")),
            }
            if technical["bb_upper"] and technical["bb_lower"] and technical["bb_upper"] > technical["bb_lower"]:
                pos = ((technical["close"] - technical["bb_lower"]) / (technical["bb_upper"] - technical["bb_lower"])) * 100.0
                technical["bb_position_pct"] = round(max(0.0, min(100.0, pos)), 1)
    except Exception as e:
        logger.warning("[COIN] 코인 차트/지표 계산 실패: %s", e)

    return {
        "market": market,
        "symbol": symbol,
        "name": name,
        "english_name": market_info["english_name"],
        "warning": market_info["warning"],
        "snapshot": snapshot,
        "fear_greed": fng,
        "kimchi_premium": kimchi_premium,
        "market_env": market_env,
        "technical": technical,
        "news": news,
        "tv_chart": tv_chart,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    import json
    d = collect_coin_data("비트코인")
    preview = {k: v for k, v in d.items() if k != "tv_chart"}
    preview["tv_chart_candles"] = len((d.get("tv_chart") or {}).get("ohlcv", []))
    print(json.dumps(preview, ensure_ascii=False, indent=2))
