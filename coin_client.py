"""
coin_client.py
Binance Spot & Futures (USDT 기본) + Upbit (김치프리미엄 참고) + 공포·탐욕 지수 수집 모듈
- API 키 불필요 (Binance Public REST API & Upbit Public API & Alternative.me)
"""

from __future__ import annotations

import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from typing import Any

import pandas as pd
import requests

from quant_engine import compute_tv_indicators_from_df

UPBIT_API_BASE = "https://api.upbit.com/v1"
BINANCE_SPOT_BASE = "https://api.binance.com/api/v3"
BINANCE_FUTURES_BASE = "https://fapi.binance.com/fapi/v1"
FNG_API_URL = "https://api.alternative.me/fng/"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

_KST = timezone(timedelta(hours=9))

_MAJOR_COINS_FALLBACK: list[dict[str, str]] = [
    {"symbol": "BTC", "korean_name": "비트코인", "english_name": "Bitcoin"},
    {"symbol": "ETH", "korean_name": "이더리움", "english_name": "Ethereum"},
    {"symbol": "XRP", "korean_name": "리플", "english_name": "Ripple"},
    {"symbol": "SOL", "korean_name": "솔라나", "english_name": "Solana"},
    {"symbol": "BNB", "korean_name": "바이낸스코인", "english_name": "BNB"},
    {"symbol": "DOGE", "korean_name": "도지코인", "english_name": "Dogecoin"},
    {"symbol": "ADA", "korean_name": "에이다", "english_name": "Cardano"},
    {"symbol": "AVAX", "korean_name": "아발란체", "english_name": "Avalanche"},
    {"symbol": "TRX", "korean_name": "트론", "english_name": "TRON"},
    {"symbol": "LINK", "korean_name": "체인링크", "english_name": "Chainlink"},
    {"symbol": "SUI", "korean_name": "수이", "english_name": "Sui"},
    {"symbol": "TON", "korean_name": "톤코인", "english_name": "Toncoin"},
    {"symbol": "DOT", "korean_name": "폴카닷", "english_name": "Polkadot"},
    {"symbol": "LTC", "korean_name": "라이트코인", "english_name": "Litecoin"},
    {"symbol": "BCH", "korean_name": "비트코인캐시", "english_name": "Bitcoin Cash"},
    {"symbol": "NEAR", "korean_name": "니어프로토콜", "english_name": "NEAR Protocol"},
    {"symbol": "APT", "korean_name": "앱토스", "english_name": "Aptos"},
    {"symbol": "ARB", "korean_name": "아비트럼", "english_name": "Arbitrum"},
    {"symbol": "OP", "korean_name": "옵티미즘", "english_name": "Optimism"},
    {"symbol": "PEPE", "korean_name": "페페", "english_name": "Pepe"},
    {"symbol": "SHIB", "korean_name": "시바이누", "english_name": "Shiba Inu"},
]

_MARKET_CACHE: dict[str, Any] = {"ts": 0.0, "items": []}


def _calc_price_decimals(price: float) -> int:
    if price >= 100:
        return 2
    if price >= 1.0:
        return 2
    if price >= 0.01:
        return 4
    return 6


def get_upbit_markets(force_refresh: bool = False) -> list[dict[str, str]]:
    """업비트 원화 마켓 목록을 활용해 한글명/티커/USDT 페어 목록 반환 (1시간 캐시)."""
    now = time.time()
    if not force_refresh and _MARKET_CACHE["items"] and (now - _MARKET_CACHE["ts"] < 3600):
        return _MARKET_CACHE["items"]

    by_symbol: dict[str, dict[str, str]] = {}
    for item in _MAJOR_COINS_FALLBACK:
        sym = item["symbol"]
        by_symbol[sym] = {
            "market": f"{sym}USDT",
            "usdt_symbol": f"{sym}USDT",
            "upbit_market": f"KRW-{sym}",
            "symbol": sym,
            "korean_name": item["korean_name"],
            "english_name": item["english_name"],
        }

    try:
        resp = requests.get(
            f"{UPBIT_API_BASE}/market/all",
            params={"isDetails": "false"},
            headers=_HEADERS,
            timeout=6,
        )
        resp.raise_for_status()
        for row in resp.json():
            mkt = str(row.get("market") or "")
            if not mkt.startswith("KRW-"):
                continue
            sym = mkt.replace("KRW-", "").strip().upper()
            if not sym:
                continue
            by_symbol[sym] = {
                "market": f"{sym}USDT",
                "usdt_symbol": f"{sym}USDT",
                "upbit_market": mkt,
                "symbol": sym,
                "korean_name": str(row.get("korean_name") or sym),
                "english_name": str(row.get("english_name") or sym),
            }
    except Exception:
        pass

    items = list(by_symbol.values())
    _MARKET_CACHE["ts"] = now
    _MARKET_CACHE["items"] = items
    return items


def search_coins(query: str, limit: int = 12) -> list[dict[str, str]]:
    """한글명, 영문명, 심볼(BTC), USDT(BTCUSDT) 기준 코인 자동완성 검색."""
    q = (query or "").strip()
    markets = get_upbit_markets()
    if not q:
        priority = ["BTC", "ETH", "XRP", "SOL", "BNB", "DOGE", "ADA", "AVAX", "LINK", "SUI"]
        ranked = [m for sym in priority for m in markets if m["symbol"] == sym]
        return ranked[:limit]

    q_lower = q.lower()
    q_upper = q.upper().replace("KRW-", "").replace("USDT", "").strip()

    exact: list[dict[str, str]] = []
    starts: list[dict[str, str]] = []
    contains: list[dict[str, str]] = []

    for item in markets:
        sym = item["symbol"]
        usdt = item["usdt_symbol"]
        k_name = item["korean_name"]
        e_name = item["english_name"].lower()

        if sym == q_upper or usdt.lower() == q_lower or k_name == q or e_name == q_lower:
            exact.append(item)
        elif sym.startswith(q_upper) or k_name.startswith(q) or e_name.startswith(q_lower):
            starts.append(item)
        elif q_upper in sym or q in k_name or q_lower in e_name:
            contains.append(item)

    merged = exact + starts + contains
    return merged[:limit]


def resolve_coin_market(query: str) -> dict[str, str]:
    """사용자 입력(BTCUSDT, BTC, 비트코인, KRW-BTC 등)을 Binance USDT 페어 정보로 정규화."""
    raw = (query or "").strip()
    if not raw:
        raw = "BTCUSDT"

    matches = search_coins(raw, limit=5)
    if matches:
        return matches[0]

    cleaned = raw.upper().replace("KRW-", "").strip()
    if cleaned.endswith("USDT") and len(cleaned) > 4:
        sym = cleaned[:-4]
    else:
        sym = cleaned

    return {
        "market": f"{sym}USDT",
        "usdt_symbol": f"{sym}USDT",
        "upbit_market": f"KRW-{sym}",
        "symbol": sym,
        "korean_name": sym,
        "english_name": sym,
    }


def _fetch_usd_krw_rate() -> float:
    """실시간 원/달러 환율 조회 (실패 시 1400.0 폴백)."""
    try:
        resp = requests.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/KRW=X",
            params={"range": "1d", "interval": "1d"},
            headers=_HEADERS,
            timeout=5,
        )
        if resp.ok:
            meta = resp.json()["chart"]["result"][0]["meta"]
            rate = float(meta.get("regularMarketPrice") or 0)
            if rate > 500:
                return rate
    except Exception:
        pass
    return 1400.0


def fetch_kimchi_premium(symbol: str, binance_usdt_price: float) -> dict[str, Any]:
    """업비트 KRW 시세와 바이낸스 USDT 시세(환율 반영) 비교로 김치프리미엄 계산."""
    upbit_market = f"KRW-{symbol.upper()}"
    usd_krw = _fetch_usd_krw_rate()
    result: dict[str, Any] = {
        "available": False,
        "usd_krw": round(usd_krw, 2),
        "upbit_krw_price": None,
        "binance_krw_equiv": round(binance_usdt_price * usd_krw, 0) if binance_usdt_price > 0 else None,
        "premium_pct": None,
    }
    try:
        resp = requests.get(
            f"{UPBIT_API_BASE}/ticker",
            params={"markets": upbit_market},
            headers=_HEADERS,
            timeout=5,
        )
        if not resp.ok:
            return result
        data = resp.json()
        if not data:
            return result
        upbit_krw = float(data[0].get("trade_price") or 0)
        if upbit_krw > 0 and binance_usdt_price > 0:
            krw_equiv = binance_usdt_price * usd_krw
            premium = ((upbit_krw - krw_equiv) / krw_equiv) * 100.0
            result["available"] = True
            result["upbit_krw_price"] = upbit_krw
            result["binance_krw_equiv"] = round(krw_equiv, 0)
            result["premium_pct"] = round(premium, 2)
    except Exception:
        pass
    return result


def fetch_binance_spot(usdt_symbol: str) -> dict[str, Any]:
    """바이낸스 현물(Spot) 24시간 시세 및 거래대금 조회 (API 키 불필요)."""
    resp = requests.get(
        f"{BINANCE_SPOT_BASE}/ticker/24hr",
        params={"symbol": usdt_symbol},
        headers=_HEADERS,
        timeout=8,
    )
    resp.raise_for_status()
    d = resp.json()

    last_price = float(d.get("lastPrice") or 0)
    price_change = float(d.get("priceChange") or 0)
    change_pct = float(d.get("priceChangePercent") or 0)
    high_24h = float(d.get("highPrice") or 0)
    low_24h = float(d.get("lowPrice") or 0)
    open_24h = float(d.get("openPrice") or 0)
    volume_base = float(d.get("volume") or 0)
    quote_volume_usdt = float(d.get("quoteVolume") or 0)

    return {
        "available": True,
        "exchange": "Binance Spot",
        "symbol": usdt_symbol,
        "price": last_price,
        "price_change": price_change,
        "change_pct": round(change_pct, 2),
        "high_24h": high_24h,
        "low_24h": low_24h,
        "open_24h": open_24h,
        "volume_24h_coin": volume_base,
        "volume_24h_usdt": quote_volume_usdt,
        "price_dec": _calc_price_decimals(last_price),
    }


def fetch_binance_futures(usdt_symbol: str, spot_price: float = 0.0) -> dict[str, Any]:
    """바이낸스 무기한 선물(USDT-M Perpetual) 펀딩비, 마크가격, 미결제약정, 거래대금 조회."""
    result: dict[str, Any] = {
        "available": False,
        "exchange": "Binance Futures (USDT-M)",
        "symbol": usdt_symbol,
    }
    try:
        p_resp = requests.get(
            f"{BINANCE_FUTURES_BASE}/premiumIndex",
            params={"symbol": usdt_symbol},
            headers=_HEADERS,
            timeout=8,
        )
        if not p_resp.ok:
            result["reason"] = "해당 코인은 바이낸스 USDT 무기한 선물 미지원"
            return result
        p_data = p_resp.json()

        mark_price = float(p_data.get("markPrice") or 0)
        index_price = float(p_data.get("indexPrice") or 0)
        funding_rate = float(p_data.get("lastFundingRate") or 0)
        funding_rate_pct = funding_rate * 100.0
        next_funding_ms = int(p_data.get("nextFundingTime") or 0)

        next_funding_kst = "-"
        countdown_str = "-"
        if next_funding_ms > 0:
            next_dt = datetime.fromtimestamp(next_funding_ms / 1000.0, tz=_KST)
            now_dt = datetime.now(_KST)
            diff_sec = max(0, int((next_dt - now_dt).total_seconds()))
            hours, rem = divmod(diff_sec, 3600)
            mins = rem // 60
            next_funding_kst = next_dt.strftime("%H:%M KST")
            countdown_str = f"{hours}시간 {mins:02d}분 후"

        if funding_rate_pct >= 0.03:
            funding_bias = "과열 롱 우세 (롱→숏 지급)"
        elif funding_rate_pct > 0.005:
            funding_bias = "완만한 롱 우세 (롱→숏 지급)"
        elif funding_rate_pct <= -0.02:
            funding_bias = "과열 숏 우세 (숏→롱 지급)"
        elif funding_rate_pct < -0.005:
            funding_bias = "완만한 숏 우세 (숏→롱 지급)"
        else:
            funding_bias = "중립 균형 (매수·매도 팽팽)"

        # 미결제약정 (Open Interest)
        oi_coin = 0.0
        oi_usdt = 0.0
        try:
            oi_resp = requests.get(
                f"{BINANCE_FUTURES_BASE}/openInterest",
                params={"symbol": usdt_symbol},
                headers=_HEADERS,
                timeout=6,
            )
            if oi_resp.ok:
                oi_coin = float(oi_resp.json().get("openInterest") or 0)
                oi_usdt = oi_coin * (mark_price or spot_price)
        except Exception:
            pass

        # 선물 24h 티커
        fut_price = mark_price
        fut_change_pct = 0.0
        fut_vol_usdt = 0.0
        fut_vol_coin = 0.0
        fut_high = 0.0
        fut_low = 0.0
        try:
            t_resp = requests.get(
                f"{BINANCE_FUTURES_BASE}/ticker/24hr",
                params={"symbol": usdt_symbol},
                headers=_HEADERS,
                timeout=6,
            )
            if t_resp.ok:
                td = t_resp.json()
                fut_price = float(td.get("lastPrice") or mark_price)
                fut_change_pct = float(td.get("priceChangePercent") or 0)
                fut_vol_usdt = float(td.get("quoteVolume") or 0)
                fut_vol_coin = float(td.get("volume") or 0)
                fut_high = float(td.get("highPrice") or 0)
                fut_low = float(td.get("lowPrice") or 0)
        except Exception:
            pass

        ref_price = spot_price if spot_price > 0 else index_price
        basis_pct = ((fut_price - ref_price) / ref_price * 100.0) if ref_price > 0 else 0.0

        result.update(
            {
                "available": True,
                "price": fut_price,
                "mark_price": mark_price,
                "index_price": index_price,
                "change_pct": round(fut_change_pct, 2),
                "high_24h": fut_high,
                "low_24h": fut_low,
                "basis_pct": round(basis_pct, 4),
                "funding_rate_pct": round(funding_rate_pct, 4),
                "funding_rate_annual_pct": round(funding_rate_pct * 3 * 365, 2),
                "next_funding_kst": next_funding_kst,
                "next_funding_countdown": countdown_str,
                "funding_bias": funding_bias,
                "open_interest_coin": round(oi_coin, 2),
                "open_interest_usdt": round(oi_usdt, 0),
                "volume_24h_coin": fut_vol_coin,
                "volume_24h_usdt": fut_vol_usdt,
            }
        )
    except Exception as exc:
        result["reason"] = str(exc)

    return result


_GLOBAL_CACHE: dict[str, Any] = {"ts": 0.0, "data": {}}


def fetch_btc_dominance() -> dict[str, Any]:
    """CoinGecko Global API로 비트코인 도미넌스, 이더리움 비중, 전체 시가총액 조회 (5분 캐시)."""
    now = time.time()
    if _GLOBAL_CACHE["data"] and (now - _GLOBAL_CACHE["ts"] < 300):
        return _GLOBAL_CACHE["data"]

    try:
        resp = requests.get(
            "https://api.coingecko.com/api/v3/global",
            headers=_HEADERS,
            timeout=8,
        )
        resp.raise_for_status()
        d = resp.json().get("data") or {}
        mcp = d.get("market_cap_percentage") or {}
        btc_dom = round(float(mcp.get("btc") or 0), 2)
        eth_dom = round(float(mcp.get("eth") or 0), 2)
        alt_dom = round(max(0.0, 100.0 - btc_dom - eth_dom), 2)
        total_mcap = float((d.get("total_market_cap") or {}).get("usd") or 0)
        mcap_chg_24h = round(float(d.get("market_cap_change_percentage_24h_usd") or 0), 2)

        if btc_dom >= 55.0:
            interp = "비트코인 독주 구간 (자금이 BTC에 집중 → 알트코인 상대 약세 유의)"
        elif btc_dom <= 48.0:
            interp = "알트코인 강세 구간 (BTC 비중 하락 → 알트코인 순환매 활발)"
        else:
            interp = "균형 구간 (BTC와 주요 알트코인 동반 수급)"

        result = {
            "available": True,
            "btc_dominance": btc_dom,
            "eth_dominance": eth_dom,
            "alt_dominance": alt_dom,
            "total_market_cap_usd": round(total_mcap, 0),
            "market_cap_change_24h_pct": mcap_chg_24h,
            "interpretation": interp,
        }
        _GLOBAL_CACHE["ts"] = now
        _GLOBAL_CACHE["data"] = result
        return result
    except Exception:
        return _GLOBAL_CACHE["data"] or {"available": False}


def fetch_fear_and_greed() -> dict[str, Any]:
    """Alternative.me 가상자산 공포·탐욕 지수 조회 (오늘/어제/지난주/지난달 포함)."""
    cls_map = {
        "Extreme Fear": "극단적 공포",
        "Fear": "공포",
        "Neutral": "중립",
        "Greed": "탐욕",
        "Extreme Greed": "극단적 탐욕",
    }

    def _parse_row(row: dict[str, Any]) -> dict[str, Any]:
        val = int(row.get("value", 50))
        raw_cls = str(row.get("value_classification") or "Neutral")
        return {
            "value": val,
            "classification": raw_cls,
            "classification_kr": cls_map.get(raw_cls, raw_cls),
        }

    try:
        resp = requests.get(FNG_API_URL, params={"limit": 31}, headers=_HEADERS, timeout=6)
        resp.raise_for_status()
        rows = resp.json().get("data") or []
        if not rows:
            return {}
        today = _parse_row(rows[0])
        yesterday = _parse_row(rows[1] if len(rows) > 1 else rows[0])
        last_week = _parse_row(rows[7] if len(rows) > 7 else rows[-1])
        last_month = _parse_row(rows[30] if len(rows) > 30 else rows[-1])
        return {
            "value": today["value"],
            "prev_value": yesterday["value"],
            "diff": today["value"] - yesterday["value"],
            "classification": today["classification"],
            "classification_kr": today["classification_kr"],
            "yesterday": yesterday,
            "last_week": last_week,
            "last_month": last_month,
        }
    except Exception:
        return {}


def fetch_coin_chart_with_indicators(
    market_or_query: str,
    timeframe: str = "day",
    market_type: str = "spot",
) -> dict[str, Any]:
    """바이낸스 USDT 캔들(현물/선물)을 수집하고 32종+ 기술적 지표를 계산해 반환."""
    info = resolve_coin_market(market_or_query)
    usdt_symbol = info["usdt_symbol"]

    tf_map = {
        "1m": ("1m", True),
        "5m": ("5m", True),
        "15m": ("15m", True),
        "30m": ("30m", True),
        "60m": ("1h", True),
        "day": ("1d", False),
        "week": ("1w", False),
        "month": ("1M", False),
    }
    interval, is_minute = tf_map.get(timeframe, ("1d", False))

    use_futures = (market_type or "spot").lower() == "futures"
    base_url = f"{BINANCE_FUTURES_BASE}/klines" if use_futures else f"{BINANCE_SPOT_BASE}/klines"

    resp = requests.get(
        base_url,
        params={"symbol": usdt_symbol, "interval": interval, "limit": 200},
        headers=_HEADERS,
        timeout=10,
    )
    if not resp.ok and use_futures:
        # 선물 미지원 코인일 경우 현물 캔들로 자동 폴백
        use_futures = False
        resp = requests.get(
            f"{BINANCE_SPOT_BASE}/klines",
            params={"symbol": usdt_symbol, "interval": interval, "limit": 200},
            headers=_HEADERS,
            timeout=10,
        )
    resp.raise_for_status()
    raw_rows = resp.json()
    if not raw_rows:
        raise ValueError(f"{usdt_symbol} 차트 데이터를 불러오지 못했습니다.")

    records = []
    for r in raw_rows:
        dt = datetime.fromtimestamp(int(r[0]) / 1000.0, tz=_KST)
        records.append(
            {
                "Date": dt,
                "Open": float(r[1]),
                "High": float(r[2]),
                "Low": float(r[3]),
                "Close": float(r[4]),
                "Volume": float(r[5]),
            }
        )

    df = pd.DataFrame(records).set_index("Date")
    last_close = float(df["Close"].iloc[-1])
    price_dec = _calc_price_decimals(last_close)

    tv_data = compute_tv_indicators_from_df(
        df=df,
        code=usdt_symbol,
        tf_key=timeframe,
        is_minute=is_minute,
        is_foreign=True,
        price_dec=price_dec,
    )
    tv_data["market_type"] = "futures" if use_futures else "spot"
    tv_data["usdt_symbol"] = usdt_symbol
    tv_data["korean_name"] = info["korean_name"]
    tv_data["price_dec"] = price_dec
    return tv_data


def fetch_coin_news(symbol: str, korean_name: str, limit: int = 8) -> list[dict[str, str]]:
    """Google News RSS로 최신 가상자산 뉴스 수집."""
    query_str = f"{korean_name} {symbol} 코인" if korean_name != symbol else f"{symbol} crypto"
    encoded = urllib.parse.quote(query_str)
    url = f"https://news.google.com/rss/search?q={encoded}&hl=ko&gl=KR&ceid=KR:ko"
    items: list[dict[str, str]] = []
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=7)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        for item in root.findall(".//item")[:limit]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub_date = (item.findtext("pubDate") or "").strip()
            source_el = item.find("source")
            source = source_el.text.strip() if source_el is not None and source_el.text else "Google News"
            if title:
                items.append(
                    {
                        "title": title,
                        "link": link,
                        "pub_date": pub_date,
                        "source": source,
                    }
                )
    except Exception:
        pass
    return items


def _summarize_technical(tv_chart: dict[str, Any]) -> dict[str, Any]:
    """tv_chart의 최신 캔들 및 주요 지표 요약."""
    ohlcv = tv_chart.get("ohlcv") or []
    if not ohlcv:
        return {}
    last = ohlcv[-1]
    prev = ohlcv[-2] if len(ohlcv) > 1 else last

    def _last_val(key: str) -> float | None:
        arr = tv_chart.get(key) or []
        if not arr:
            return None
        return arr[-1].get("value")

    close = float(last["close"])
    ma20 = _last_val("ma20")
    ma60 = _last_val("ma60")
    rsi14 = _last_val("rsi14")
    macd_hist = _last_val("macd_hist")
    adx14 = _last_val("adx14")
    bb_upper = _last_val("bb_upper")
    bb_lower = _last_val("bb_lower")

    highs = [float(c["high"]) for c in ohlcv]
    lows = [float(c["low"]) for c in ohlcv]
    period_high = max(highs)
    period_low = min(lows)
    pos_pct = ((close - period_low) / (period_high - period_low) * 100.0) if period_high > period_low else 50.0

    return {
        "close": close,
        "prev_close": float(prev["close"]),
        "ma20": ma20,
        "ma60": ma60,
        "rsi14": rsi14,
        "macd_hist": macd_hist,
        "adx14": adx14,
        "bb_upper": bb_upper,
        "bb_lower": bb_lower,
        "period_high": period_high,
        "period_low": period_low,
        "range_position_pct": round(pos_pct, 1),
    }


def fetch_liquidation_roadmap(
    usdt_symbol: str,
    mark_price: float,
    open_interest_usdt: float,
    price_dec: int = 2,
) -> dict[str, Any]:
    """바이낸스 선물 롱/숏 비율 + 미결제약정 + 레버리지별 예상 청산 가격대 로드맵 생성."""
    if not mark_price or mark_price <= 0:
        return {"available": False, "reason": "선물 마크가격 없음"}

    base_data_url = "https://fapi.binance.com/futures/data"
    global_long_pct = 50.0
    global_short_pct = 50.0
    global_ls_ratio = 1.0
    top_long_pct = 50.0
    top_short_pct = 50.0
    top_ls_ratio = 1.0
    taker_buy_sell_ratio = 1.0

    try:
        r1 = requests.get(
            f"{base_data_url}/globalLongShortAccountRatio",
            params={"symbol": usdt_symbol, "period": "1h", "limit": 1},
            headers=_HEADERS,
            timeout=6,
        )
        if r1.ok and r1.json():
            row = r1.json()[0]
            global_long_pct = round(float(row.get("longAccount", 0.5)) * 100.0, 2)
            global_short_pct = round(float(row.get("shortAccount", 0.5)) * 100.0, 2)
            global_ls_ratio = round(float(row.get("longShortRatio", 1.0)), 2)
    except Exception:
        pass

    try:
        r2 = requests.get(
            f"{base_data_url}/topLongShortPositionRatio",
            params={"symbol": usdt_symbol, "period": "1h", "limit": 1},
            headers=_HEADERS,
            timeout=6,
        )
        if r2.ok and r2.json():
            row = r2.json()[0]
            top_long_pct = round(float(row.get("longAccount", 0.5)) * 100.0, 2)
            top_short_pct = round(float(row.get("shortAccount", 0.5)) * 100.0, 2)
            top_ls_ratio = round(float(row.get("longShortRatio", 1.0)), 2)
    except Exception:
        pass

    try:
        r3 = requests.get(
            f"{base_data_url}/takerlongshortRatio",
            params={"symbol": usdt_symbol, "period": "1h", "limit": 1},
            headers=_HEADERS,
            timeout=6,
        )
        if r3.ok and r3.json():
            taker_buy_sell_ratio = round(float(r3.json()[0].get("buySellRatio", 1.0)), 2)
    except Exception:
        pass

    oi_total = float(open_interest_usdt or 0.0)
    oi_long_usdt = round(oi_total * (top_long_pct / 100.0), 0)
    oi_short_usdt = round(oi_total * (top_short_pct / 100.0), 0)

    # 레버리지별 유지증거금(MMR) 반영 예상 청산 변동폭(%) 및 추정 비중
    tiers_cfg = [
        {"leverage": 100, "move_pct": 0.6, "weight": 0.08, "tag": "초단타 스캘핑 구간"},
        {"leverage": 50, "move_pct": 1.5, "weight": 0.14, "tag": "고배율 단기 변동 구간"},
        {"leverage": 25, "move_pct": 3.5, "weight": 0.22, "tag": "핵심 청산 유동성 구간"},
        {"leverage": 20, "move_pct": 4.4, "weight": 0.24, "tag": "주요 스윙 청산 구간"},
        {"leverage": 10, "move_pct": 9.2, "weight": 0.20, "tag": "중기 추세 분기점"},
        {"leverage": 5, "move_pct": 19.0, "weight": 0.12, "tag": "대규모 연쇄 청산 마지노선"},
    ]

    short_squeeze_levels = []
    long_squeeze_levels = []
    cum_short_usdt = 0.0
    cum_long_usdt = 0.0

    for cfg in tiers_cfg:
        mv = cfg["move_pct"]
        wt = cfg["weight"]
        short_liq_price = round(mark_price * (1.0 + mv / 100.0), price_dec)
        long_liq_price = round(mark_price * (1.0 - mv / 100.0), price_dec)
        est_short_usdt = round(oi_short_usdt * wt, 0)
        est_long_usdt = round(oi_long_usdt * wt, 0)
        cum_short_usdt += est_short_usdt
        cum_long_usdt += est_long_usdt

        short_squeeze_levels.append(
            {
                "leverage": f"{cfg['leverage']}x",
                "move_pct": round(mv, 1),
                "liq_price": short_liq_price,
                "est_liq_usdt": est_short_usdt,
                "cum_liq_usdt": round(cum_short_usdt, 0),
                "tag": cfg["tag"],
            }
        )
        long_squeeze_levels.append(
            {
                "leverage": f"{cfg['leverage']}x",
                "move_pct": round(-mv, 1),
                "liq_price": long_liq_price,
                "est_liq_usdt": est_long_usdt,
                "cum_liq_usdt": round(cum_long_usdt, 0),
                "tag": cfg["tag"],
            }
        )

    if top_long_pct >= 58.0 or global_long_pct >= 65.0:
        squeeze_diagnosis = "하방 롱 청산 압력 우위 (롱 포지션 쏠림 → 하락 시 연쇄 롱 스퀴즈 주의)"
        dominant_side = "long_heavy"
    elif top_short_pct >= 58.0 or global_short_pct >= 65.0:
        squeeze_diagnosis = "상방 숏 청산 압력 우위 (숏 포지션 쏠림 → 반등 시 숏 스퀴즈 급등 가능)"
        dominant_side = "short_heavy"
    else:
        squeeze_diagnosis = "양방향 균형 구간 (20x~50x 고배율 매물대 중심 단기 변동성 유의)"
        dominant_side = "balanced"

    return {
        "available": True,
        "mark_price": mark_price,
        "global_long_pct": global_long_pct,
        "global_short_pct": global_short_pct,
        "global_ls_ratio": global_ls_ratio,
        "top_long_pct": top_long_pct,
        "top_short_pct": top_short_pct,
        "top_ls_ratio": top_ls_ratio,
        "taker_buy_sell_ratio": taker_buy_sell_ratio,
        "oi_long_usdt": oi_long_usdt,
        "oi_short_usdt": oi_short_usdt,
        "dominant_side": dominant_side,
        "squeeze_diagnosis": squeeze_diagnosis,
        "short_squeeze_levels": short_squeeze_levels,
        "long_squeeze_levels": long_squeeze_levels,
    }


def collect_coin_data(query: str) -> dict[str, Any]:
    """코인 종합 데이터 수집: 바이낸스 현물(Spot) + 선물(Futures & 펀딩비) + 롱숏 청산 로드맵 + 김프 + 공포탐욕 + 차트 + 뉴스."""
    info = resolve_coin_market(query)
    usdt_symbol = info["usdt_symbol"]
    symbol = info["symbol"]

    spot = fetch_binance_spot(usdt_symbol)
    futures = fetch_binance_futures(usdt_symbol, spot_price=spot["price"])
    liquidation_roadmap = (
        fetch_liquidation_roadmap(
            usdt_symbol,
            mark_price=futures.get("mark_price", 0),
            open_interest_usdt=futures.get("open_interest_usdt", 0),
            price_dec=spot["price_dec"],
        )
        if futures.get("available")
        else {"available": False, "reason": futures.get("reason", "선물 미지원")}
    )
    kimchi = fetch_kimchi_premium(symbol, binance_usdt_price=spot["price"])
    fear_greed = fetch_fear_and_greed()
    btc_dominance = fetch_btc_dominance()
    tv_chart = fetch_coin_chart_with_indicators(usdt_symbol, timeframe="day", market_type="spot")
    technical = _summarize_technical(tv_chart)
    news = fetch_coin_news(symbol, info["korean_name"])

    # 현물 대비 선물 거래대금 비율
    fut_spot_vol_ratio = None
    if futures.get("available") and spot.get("volume_24h_usdt", 0) > 0:
        fut_spot_vol_ratio = round(futures["volume_24h_usdt"] / spot["volume_24h_usdt"], 2)

    return {
        "coin_info": info,
        "spot": spot,
        "futures": futures,
        "liquidation_roadmap": liquidation_roadmap,
        "kimchi": kimchi,
        "fut_spot_vol_ratio": fut_spot_vol_ratio,
        "fear_greed": fear_greed,
        "btc_dominance": btc_dominance,
        "technical": technical,
        "tv_chart": tv_chart,
        "news": news,
        "price_dec": spot["price_dec"],
        "collected_at": datetime.now(_KST).strftime("%Y-%m-%d %H:%M:%S KST"),
    }


if __name__ == "__main__":
    import json

    sample = collect_coin_data("BTCUSDT")
    preview = {
        "coin_info": sample["coin_info"],
        "spot": sample["spot"],
        "futures": sample["futures"],
        "kimchi": sample["kimchi"],
        "fut_spot_vol_ratio": sample["fut_spot_vol_ratio"],
        "fear_greed": sample["fear_greed"],
        "technical": sample["technical"],
        "ohlcv_len": len(sample["tv_chart"]["ohlcv"]),
        "news_len": len(sample["news"]),
    }
    print(json.dumps(preview, ensure_ascii=False, indent=2))
