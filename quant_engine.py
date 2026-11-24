import logging
from datetime import datetime, timedelta
import requests
import numpy as np
import pandas as pd
import FinanceDataReader as fdr
import ta

logger = logging.getLogger("StockAssistant")

NAVER_CHART_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://stock.naver.com/",
}


def fetch_naver_chart_history(code: str, is_foreign: bool = False, days: int = 365) -> pd.DataFrame:
    """네이버 증권 차트 JSON API에서 국내/해외 종목의 일봉 OHLCV 데이터를 직접 조회합니다."""
    cleaned_code = str(code).strip()
    end_dt = datetime.today() + timedelta(days=1)
    start_dt = end_dt - timedelta(days=days)

    market_seg = "foreign" if is_foreign else "domestic"
    url = f"https://api.stock.naver.com/chart/{market_seg}/item/{cleaned_code}/day"
    params = {
        "startDateTime": start_dt.strftime("%Y%m%d0000"),
        "endDateTime": end_dt.strftime("%Y%m%d0000"),
    }

    logger.info("[NAVER-CHART] 네이버 차트 JSON API 조회 (code=%s, foreign=%s)", cleaned_code, is_foreign)
    resp = requests.get(url, params=params, headers=NAVER_CHART_HEADERS, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"네이버 차트 API 호출 실패 (HTTP {resp.status_code})")

    rows = resp.json()
    if not isinstance(rows, list) or len(rows) < 20:
        raise ValueError(f"네이버 차트 데이터 부족 (code={cleaned_code})")

    df = pd.DataFrame(rows)
    df["Date"] = pd.to_datetime(df["localDate"], format="%Y%m%d")
    df = df.set_index("Date").sort_index()
    df = df.rename(columns={
        "openPrice": "Open",
        "highPrice": "High",
        "lowPrice": "Low",
        "closePrice": "Close",
        "accumulatedTradingVolume": "Volume",
    })
    for col in ("Open", "High", "Low", "Close", "Volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.dropna(subset=["Close"])


SUPPORTED_TIMEFRAMES = {
    "minute1": ("minute1", True),
    "minute5": ("minute5", True),
    "minute10": ("minute10", True),
    "minute30": ("minute30", True),
    "minute60": ("minute60", True),
    "day": ("day", False),
    "week": ("week", False),
    "month": ("month", False),
}


def fetch_naver_chart_with_indicators(
    code: str,
    timeframe: str = "day",
    is_foreign: bool = None,
) -> dict:
    """네이버 증권 차트 API에서 분봉(1/5/10/30/60분)·일·주·월봉 OHLCV와 MA/볼린저/RSI/MACD를 계산합니다."""
    cleaned_code = str(code).strip()
    if is_foreign is None:
        is_foreign = not (cleaned_code.isdigit() and len(cleaned_code) == 6)

    tf_key = timeframe if timeframe in SUPPORTED_TIMEFRAMES else "day"
    naver_tf, is_minute = SUPPORTED_TIMEFRAMES[tf_key]
    market_seg = "foreign" if is_foreign else "domestic"
    url = f"https://api.stock.naver.com/chart/{market_seg}/item/{cleaned_code}/{naver_tf}"

    params = {}
    if not is_minute:
        days_back = 365 if tf_key == "day" else (365 * 3 if tf_key == "week" else 365 * 8)
        end_dt = datetime.today() + timedelta(days=1)
        start_dt = end_dt - timedelta(days=days_back)
        params = {
            "startDateTime": start_dt.strftime("%Y%m%d0000"),
            "endDateTime": end_dt.strftime("%Y%m%d0000"),
        }

    logger.info("[NAVER-CHART] 타임프레임 조회 (code=%s, tf=%s, foreign=%s)", cleaned_code, tf_key, is_foreign)
    resp = requests.get(url, params=params, headers=NAVER_CHART_HEADERS, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"네이버 차트 API 호출 실패 (HTTP {resp.status_code})")

    rows = resp.json()
    if not isinstance(rows, list) or len(rows) == 0:
        raise ValueError(f"'{cleaned_code}'의 {tf_key} 차트 데이터가 현재 제공되지 않습니다.")

    df = pd.DataFrame(rows)
    if is_minute:
        # localDateTime: YYYYMMDDHHMMSS -> KST를 차트에 그대로 표시하기 위해 UTC 기준 timestamp로 변환
        dt_series = pd.to_datetime(df["localDateTime"], format="%Y%m%d%H%M%S")
        df["Date"] = dt_series
        df = df.rename(columns={
            "openPrice": "Open",
            "highPrice": "High",
            "lowPrice": "Low",
            "currentPrice": "Close",
            "accumulatedTradingVolume": "Volume",
        })
    else:
        df["Date"] = pd.to_datetime(df["localDate"], format="%Y%m%d")
        df = df.rename(columns={
            "openPrice": "Open",
            "highPrice": "High",
            "lowPrice": "Low",
            "closePrice": "Close",
            "accumulatedTradingVolume": "Volume",
        })

    df = df.set_index("Date").sort_index()
    # 중복 시간 제거
    df = df[~df.index.duplicated(keep="last")]
    for col in ("Open", "High", "Low", "Close", "Volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["Close"])

    price_dec = 2 if is_foreign else 0
    return compute_tv_indicators_from_df(
        df=df,
        code=cleaned_code,
        tf_key=tf_key,
        is_minute=is_minute,
        is_foreign=is_foreign,
        price_dec=price_dec,
    )


def compute_tv_indicators_from_df(
    df: pd.DataFrame,
    code: str,
    tf_key: str = "day",
    is_minute: bool = False,
    is_foreign: bool = False,
    price_dec: int = 0,
) -> dict:
    """OHLCV DataFrame으로부터 32종+ 기술적 지표와 TradingView용 JSON 시계열을 계산합니다."""
    df = df.copy()
    close = df["Close"].astype(float)
    high = df["High"].astype(float).fillna(close) if "High" in df.columns else close
    low = df["Low"].astype(float).fillna(close) if "Low" in df.columns else close
    vol = df["Volume"].astype(float).fillna(0.0) if "Volume" in df.columns else pd.Series(0.0, index=df.index)

    # 1. 이동평균선 (MA5/20/60/120, EMA20)
    df["MA5"] = close.rolling(window=5).mean()
    df["MA20"] = close.rolling(window=20).mean()
    df["MA60"] = close.rolling(window=60).mean()
    df["MA120"] = close.rolling(window=120).mean()
    df["EMA20"] = close.ewm(span=20, adjust=False).mean()

    # 2. 볼린저밴드 (20, 2)
    std20 = close.rolling(window=20).std()
    df["BB_UPPER"] = df["MA20"] + (std20 * 2.0)
    df["BB_LOWER"] = df["MA20"] - (std20 * 2.0)

    # 3. 일목균형표 (전환선 9, 기준선 26)
    df["ICHI_CONV"] = (high.rolling(9).max() + low.rolling(9).min()) / 2.0
    df["ICHI_BASE"] = (high.rolling(26).max() + low.rolling(26).min()) / 2.0

    # 4. VWAP (거래량가중평균가격 - 누적/20일 이동 VWAP)
    typical_price = (high + low + close) / 3.0
    tp_vol = (typical_price * vol).rolling(20).sum()
    vol_sum20 = vol.rolling(20).sum().replace(0, np.nan)
    df["VWAP20"] = tp_vol / vol_sum20

    # 5. RSI (14일)
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["RSI14"] = 100.0 - (100.0 / (1.0 + rs))
    df.loc[avg_loss == 0, "RSI14"] = 100.0

    # 6. MACD (12, 26, 9)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_SIGNAL"] = df["MACD"].ewm(span=9, adjust=False).mean()
    df["MACD_HIST"] = df["MACD"] - df["MACD_SIGNAL"]

    # 7. 스토캐스틱 (14, 3, 3)
    low14 = low.rolling(14).min()
    high14 = high.rolling(14).max()
    fast_k = ((close - low14) / (high14 - low14).replace(0, np.nan)) * 100.0
    df["STOCH_K"] = fast_k.rolling(3).mean()
    df["STOCH_D"] = df["STOCH_K"].rolling(3).mean()

    # 8. CCI (20일)
    tp_sma = typical_price.rolling(20).mean()
    mad = typical_price.rolling(20).apply(lambda x: np.mean(np.abs(x - np.mean(x))), raw=True)
    df["CCI20"] = (typical_price - tp_sma) / (0.015 * mad.replace(0, np.nan))

    # 9. ATR (14일)
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    df["ATR14"] = tr.rolling(14).mean()

    # 10. OBV (On-Balance Volume)
    direction = np.sign(close.diff()).fillna(0.0)
    df["OBV"] = (direction * vol).cumsum()

    # 11. Williams %R (14일)
    df["WILLR14"] = ((high14 - close) / (high14 - low14).replace(0, np.nan)) * -100.0

    # 12. MFI (14일 - 자금흐름지수)
    raw_mf = typical_price * vol
    pos_mf = raw_mf.where(typical_price > typical_price.shift(1), 0.0).rolling(14).sum()
    neg_mf = raw_mf.where(typical_price < typical_price.shift(1), 0.0).rolling(14).sum().replace(0, np.nan)
    mfr = pos_mf / neg_mf
    df["MFI14"] = 100.0 - (100.0 / (1.0 + mfr))

    # 13. ta 라이브러리 기반 확장 지표 (오버레이 & 보조차트)
    df["EMA5"] = close.ewm(span=5, adjust=False).mean()
    df["EMA60"] = close.ewm(span=60, adjust=False).mean()
    df["EMA120"] = close.ewm(span=120, adjust=False).mean()

    try:
        kc = ta.volatility.KeltnerChannel(high=high, low=low, close=close, window=20)
        df["KC_HIGH"] = kc.keltner_channel_hband()
        df["KC_LOW"] = kc.keltner_channel_lband()
    except Exception:
        pass

    try:
        dc = ta.volatility.DonchianChannel(high=high, low=low, close=close, window=20)
        df["DC_HIGH"] = dc.donchian_channel_hband()
        df["DC_LOW"] = dc.donchian_channel_lband()
    except Exception:
        pass

    try:
        psar_ind = ta.trend.PSARIndicator(high=high, low=low, close=close)
        df["PSAR"] = psar_ind.psar()
    except Exception:
        pass

    try:
        adx_ind = ta.trend.ADXIndicator(high=high, low=low, close=close, window=14)
        df["ADX"] = adx_ind.adx()
        df["ADX_POS"] = adx_ind.adx_pos()
        df["ADX_NEG"] = adx_ind.adx_neg()
    except Exception:
        pass

    try:
        aroon_ind = ta.trend.AroonIndicator(high=high, low=low, window=25)
        df["AROON_UP"] = aroon_ind.aroon_up()
        df["AROON_DOWN"] = aroon_ind.aroon_down()
    except Exception:
        pass

    try:
        df["AO"] = ta.momentum.AwesomeOscillatorIndicator(high=high, low=low).awesome_oscillator()
    except Exception:
        pass

    try:
        df["ROC"] = ta.momentum.ROCIndicator(close=close, window=12).roc()
    except Exception:
        pass

    try:
        df["TSI"] = ta.momentum.TSIIndicator(close=close).tsi()
    except Exception:
        pass

    try:
        df["UO"] = ta.momentum.UltimateOscillator(high=high, low=low, close=close).ultimate_oscillator()
    except Exception:
        pass

    try:
        df["CMF"] = ta.volume.ChaikinMoneyFlowIndicator(high=high, low=low, close=close, volume=vol, window=20).chaikin_money_flow()
    except Exception:
        pass

    try:
        vortex = ta.trend.VortexIndicator(high=high, low=low, close=close, window=14)
        df["VI_POS"] = vortex.vortex_indicator_pos()
        df["VI_NEG"] = vortex.vortex_indicator_neg()
    except Exception:
        pass

    try:
        kst_ind = ta.trend.KSTIndicator(close=close)
        df["KST"] = kst_ind.kst()
        df["KST_SIG"] = kst_ind.kst_sig()
    except Exception:
        pass

    try:
        df["FI"] = ta.volume.ForceIndexIndicator(close=close, volume=vol, window=13).force_index()
    except Exception:
        pass

    view = df.tail(180).copy()

    def _tv_time(ts):
        if is_minute:
            # LightweightCharts는 epoch seconds를 UTC로 표시하므로 KST 시각 그대로 보이도록 정수 변환
            return int(ts.timestamp()) + (9 * 3600)
        return ts.strftime("%Y-%m-%d")

    times = [_tv_time(idx) for idx in view.index]
    ohlcv = []
    for idx, (_, row) in enumerate(view.iterrows()):
        c = float(row["Close"])
        o = float(row["Open"]) if pd.notna(row["Open"]) and float(row["Open"]) > 0 else c
        h = float(row["High"]) if pd.notna(row["High"]) and float(row["High"]) > 0 else max(o, c)
        l = float(row["Low"]) if pd.notna(row["Low"]) and float(row["Low"]) > 0 else min(o, c)
        v = float(row["Volume"]) if "Volume" in view.columns and pd.notna(row["Volume"]) else 0.0
        ohlcv.append({
            "time": times[idx],
            "label": view.index[idx].strftime("%Y-%m-%d %H:%M" if is_minute else "%Y-%m-%d"),
            "open": round(o, price_dec),
            "high": round(h, price_dec),
            "low": round(l, price_dec),
            "close": round(c, price_dec),
            "volume": round(v, 0),
        })

    def _tv_line(col: str, dec: int):
        if col not in view.columns:
            return []
        out = []
        for i, v in enumerate(view[col]):
            if pd.notna(v) and np.isfinite(float(v)):
                out.append({"time": times[i], "value": round(float(v), dec)})
        return out

    return {
        "code": code,
        "timeframe": tf_key,
        "is_minute": is_minute,
        "is_foreign": is_foreign,
        "ohlcv": ohlcv,
        "ma5": _tv_line("MA5", price_dec),
        "ma20": _tv_line("MA20", price_dec),
        "ma60": _tv_line("MA60", price_dec),
        "ma120": _tv_line("MA120", price_dec),
        "ema5": _tv_line("EMA5", price_dec),
        "ema20": _tv_line("EMA20", price_dec),
        "ema60": _tv_line("EMA60", price_dec),
        "ema120": _tv_line("EMA120", price_dec),
        "bb_upper": _tv_line("BB_UPPER", price_dec),
        "bb_lower": _tv_line("BB_LOWER", price_dec),
        "kc_high": _tv_line("KC_HIGH", price_dec),
        "kc_low": _tv_line("KC_LOW", price_dec),
        "dc_high": _tv_line("DC_HIGH", price_dec),
        "dc_low": _tv_line("DC_LOW", price_dec),
        "psar": _tv_line("PSAR", price_dec),
        "ichi_conv": _tv_line("ICHI_CONV", price_dec),
        "ichi_base": _tv_line("ICHI_BASE", price_dec),
        "vwap20": _tv_line("VWAP20", price_dec),
        "rsi14": _tv_line("RSI14", 2),
        "macd": _tv_line("MACD", 2),
        "macd_signal": _tv_line("MACD_SIGNAL", 2),
        "macd_hist": _tv_line("MACD_HIST", 2),
        "stoch_k": _tv_line("STOCH_K", 2),
        "stoch_d": _tv_line("STOCH_D", 2),
        "cci20": _tv_line("CCI20", 2),
        "atr14": _tv_line("ATR14", 2),
        "obv": _tv_line("OBV", 0),
        "willr14": _tv_line("WILLR14", 2),
        "mfi14": _tv_line("MFI14", 2),
        "adx": _tv_line("ADX", 2),
        "adx_pos": _tv_line("ADX_POS", 2),
        "adx_neg": _tv_line("ADX_NEG", 2),
        "aroon_up": _tv_line("AROON_UP", 2),
        "aroon_down": _tv_line("AROON_DOWN", 2),
        "ao": _tv_line("AO", 2),
        "roc": _tv_line("ROC", 2),
        "tsi": _tv_line("TSI", 2),
        "uo": _tv_line("UO", 2),
        "cmf": _tv_line("CMF", 4),
        "vi_pos": _tv_line("VI_POS", 3),
        "vi_neg": _tv_line("VI_NEG", 3),
        "kst": _tv_line("KST", 2),
        "kst_sig": _tv_line("KST_SIG", 2),
        "fi": _tv_line("FI", 0),
    }


def fetch_price_history(code: str, days: int = 365) -> pd.DataFrame:
    """FinanceDataReader를 사용해 지정한 기간(기본 1년)의 일봉 주가 데이터를 조회합니다."""
    cleaned_code = str(code).strip()
    if not cleaned_code:
        raise ValueError("종목코드가 입력되지 않았습니다.")

    end_dt = datetime.today()
    start_dt = end_dt - timedelta(days=days)
    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    logger.info("[FDR] FinanceDataReader 주가 데이터 조회 (code=%s, %s ~ %s)", cleaned_code, start_str, end_str)

    try:
        df = fdr.DataReader(cleaned_code, start_str, end_str)
    except Exception as e:
        raise RuntimeError(f"종목 '{cleaned_code}'의 주가 데이터를 조회하는 중 오류가 발생했습니다: {e}") from e

    if df is None or df.empty or "Close" not in df.columns:
        raise ValueError(f"종목 '{cleaned_code}'의 주가 데이터가 없습니다. 종목코드를 확인해 주세요.")

    df = df.dropna(subset=["Close"]).copy()
    if len(df) < 20:
        raise ValueError(f"종목 '{cleaned_code}'의 거래일 데이터가 충분하지 않습니다. (최소 20일 필요)")

    return df


def calculate_basic_stats(df: pd.DataFrame) -> dict:
    """주가 데이터프레임에서 수익률, 연율화 변동성, 최대낙폭(MDD)을 계산합니다."""
    close = df["Close"].astype(float)
    daily_returns = close.pct_change().dropna()

    total_return = (close.iloc[-1] / close.iloc[0] - 1.0) * 100.0
    annual_return = daily_returns.mean() * 252 * 100.0
    annual_volatility = daily_returns.std() * np.sqrt(252) * 100.0

    # MDD 계산: 누적 최고점 대비 현재가의 하락률 중 최솟값
    cum_max = close.cummax()
    drawdown = (close / cum_max - 1.0) * 100.0
    mdd = drawdown.min()

    stats = {
        "latest_close": int(round(close.iloc[-1])),
        "trading_days": int(len(close)),
        "total_return_pct": round(float(total_return), 2),
        "annual_return_pct": round(float(annual_return), 2),
        "annual_volatility_pct": round(float(annual_volatility), 2),
        "mdd_pct": round(float(mdd), 2),
    }
    logger.info("[QUANT] 기본 통계 계산 완료 (return=%.2f%%, vol=%.2f%%, mdd=%.2f%%)",
                stats["total_return_pct"], stats["annual_volatility_pct"], stats["mdd_pct"])
    return stats


def _resolve_stock_name(code: str) -> str:
    """가능한 경우 네이버 기본 API에서 종목명을 조회하고, 실패 시 코드를 반환합니다."""
    try:
        from collector import fetch_basic_info
        return fetch_basic_info(code).get("name") or code
    except Exception:
        return code


def calculate_rebalancing_portfolio(
    codes: list,
    num_simulations: int = 3000,
    risk_free_rate: float = 0.03,
) -> dict:
    """단순화 몬테카를로 시뮬레이션과 효율적 프론티어로 적정 자산 배분 비중을 계산합니다. (Dify 미사용)"""
    # 중복 제거 및 순서 유지
    unique_codes = []
    for c in codes:
        cleaned = str(c).strip()
        if cleaned and cleaned not in unique_codes:
            unique_codes.append(cleaned)

    if len(unique_codes) < 2:
        raise ValueError("리밸런싱 계산에는 최소 2개 이상의 서로 다른 종목코드가 필요합니다.")
    if len(unique_codes) > 10:
        raise ValueError("초보자용 시뮬레이션은 최대 10개 종목까지만 지원합니다.")

    price_series = {}
    asset_summaries = []
    for code in unique_codes:
        df = fetch_price_history(code, days=365)
        stats = calculate_basic_stats(df)
        name = _resolve_stock_name(code)
        price_series[code] = df["Close"].astype(float)
        asset_summaries.append({
            "code": code,
            "name": name,
            **stats,
        })

    # 공통 거래일 기준으로 주가 병합
    prices_df = pd.DataFrame(price_series).dropna()
    if len(prices_df) < 20:
        raise ValueError("선택한 종목들의 공통 거래일 데이터가 20일 미만으로 부족합니다.")

    returns_df = prices_df.pct_change().dropna()
    mean_returns = returns_df.mean() * 252
    cov_matrix = returns_df.cov() * 252
    num_assets = len(unique_codes)

    # 몬테카를로 시뮬레이션 (호출할 때마다 새로 시뮬레이션)
    all_weights = np.zeros((num_simulations, num_assets))
    ret_arr = np.zeros(num_simulations)
    vol_arr = np.zeros(num_simulations)
    sharpe_arr = np.zeros(num_simulations)

    for i in range(num_simulations):
        w = np.random.random(num_assets)
        w /= np.sum(w)
        all_weights[i, :] = w

        p_ret = float(np.sum(mean_returns.values * w))
        p_vol = float(np.sqrt(np.dot(w.T, np.dot(cov_matrix.values, w))))
        ret_arr[i] = p_ret
        vol_arr[i] = p_vol
        sharpe_arr[i] = (p_ret - risk_free_rate) / p_vol if p_vol > 0 else 0.0

    max_sharpe_idx = int(np.argmax(sharpe_arr))
    min_vol_idx = int(np.argmin(vol_arr))

    def _build_portfolio_info(idx: int) -> dict:
        w = all_weights[idx]
        # 포트폴리오 과거 백테스트 일간 수익률로 MDD 계산
        port_daily = returns_df.values @ w
        port_cum = np.cumprod(1.0 + port_daily)
        port_peak = np.maximum.accumulate(port_cum)
        port_mdd = float(np.min(port_cum / port_peak - 1.0) * 100.0)

        weights_pct = {
            unique_codes[j]: round(float(w[j] * 100.0), 1)
            for j in range(num_assets)
        }
        return {
            "weights_pct": weights_pct,
            "expected_return_pct": round(float(ret_arr[idx] * 100.0), 2),
            "volatility_pct": round(float(vol_arr[idx] * 100.0), 2),
            "sharpe_ratio": round(float(sharpe_arr[idx]), 2),
            "mdd_pct": round(port_mdd, 2),
        }

    max_sharpe_port = _build_portfolio_info(max_sharpe_idx)
    min_vol_port = _build_portfolio_info(min_vol_idx)

    # 산점도(효율적 프론티어) 차트용 샘플 250개 추출
    sample_indices = np.linspace(0, num_simulations - 1, min(250, num_simulations), dtype=int)
    frontier_points = [
        {
            "x": round(float(vol_arr[idx] * 100.0), 2),
            "y": round(float(ret_arr[idx] * 100.0), 2),
            "sharpe": round(float(sharpe_arr[idx]), 2),
        }
        for idx in sample_indices
    ]

    logger.info(
        "[QUANT] 몬테카를로 리밸런싱 완료 (simulations=%d, max_sharpe=%.2f, min_vol=%.2f%%)",
        num_simulations,
        max_sharpe_port["sharpe_ratio"],
        min_vol_port["volatility_pct"],
    )

    return {
        "assets": asset_summaries,
        "simulations": num_simulations,
        "common_trading_days": int(len(prices_df)),
        "max_sharpe": max_sharpe_port,
        "min_volatility": min_vol_port,
        "frontier_points": frontier_points,
    }


def _to_clean_list(series: pd.Series, decimals: int = 2) -> list:
    """NaN을 None으로 변환하여 JSON 직렬화가 가능한 리스트를 반환합니다."""
    return [None if pd.isna(v) else round(float(v), decimals) for v in series]


def calculate_technical_indicators(
    code: str,
    days: int = 365,
    display_days: int = 120,
    is_foreign: bool = None,
) -> dict:
    """네이버 차트 API(우선) 또는 FDR로 주가를 받아 MA, RSI, MACD, 볼린저밴드 및 캔들 OHLCV를 계산합니다."""
    cleaned_code = str(code).strip()
    if is_foreign is None:
        is_foreign = not (cleaned_code.isdigit() and len(cleaned_code) == 6)

    try:
        df = fetch_naver_chart_history(cleaned_code, is_foreign=is_foreign, days=days)
    except Exception as naver_err:
        logger.warning("[NAVER-CHART] 네이버 차트 조회 실패, FDR fallback 시도 (%s): %s", cleaned_code, naver_err)
        fdr_code = cleaned_code.split(".")[0] if is_foreign else cleaned_code
        df = fetch_price_history(fdr_code, days=days)

    name = _resolve_stock_name(cleaned_code)
    close = df["Close"].astype(float)
    price_dec = 2 if is_foreign else 0

    # 1. 이동평균선
    df["MA5"] = close.rolling(window=5).mean()
    df["MA20"] = close.rolling(window=20).mean()
    df["MA60"] = close.rolling(window=60).mean()
    df["MA120"] = close.rolling(window=120).mean()

    # 2. 볼린저밴드 (20일 이동평균 ± 2 * 표준편차)
    std20 = close.rolling(window=20).std()
    df["BB_UPPER"] = df["MA20"] + (std20 * 2.0)
    df["BB_LOWER"] = df["MA20"] - (std20 * 2.0)

    # 3. RSI (14일)
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["RSI14"] = 100.0 - (100.0 / (1.0 + rs))
    df.loc[avg_loss == 0, "RSI14"] = 100.0

    # 4. MACD (12, 26, 9)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_SIGNAL"] = df["MACD"].ewm(span=9, adjust=False).mean()
    df["MACD_HIST"] = df["MACD"] - df["MACD_SIGNAL"]

    # 차트 표시용 최근 N거래일 슬라이싱
    view = df.tail(display_days).copy()
    last_row = view.iloc[-1]
    last_date = view.index[-1].strftime("%Y-%m-%d")

    def _val(col: str, decimals: int = 2):
        v = last_row[col]
        return None if pd.isna(v) else round(float(v), decimals)

    latest = {
        "date": last_date,
        "close": round(float(last_row["Close"]), price_dec) if is_foreign else int(round(float(last_row["Close"]))),
        "ma5": _val("MA5", price_dec),
        "ma20": _val("MA20", price_dec),
        "ma60": _val("MA60", price_dec),
        "ma120": _val("MA120", price_dec),
        "bb_upper": _val("BB_UPPER", price_dec),
        "bb_mid": _val("MA20", price_dec),
        "bb_lower": _val("BB_LOWER", price_dec),
        "rsi14": _val("RSI14", 2),
        "macd": _val("MACD", 2),
        "macd_signal": _val("MACD_SIGNAL", 2),
        "macd_hist": _val("MACD_HIST", 2),
    }

    ohlcv = []
    for idx, row in view.iterrows():
        c = float(row["Close"])
        o = float(row["Open"]) if "Open" in view.columns and pd.notna(row["Open"]) and float(row["Open"]) > 0 else c
        h = float(row["High"]) if "High" in view.columns and pd.notna(row["High"]) and float(row["High"]) > 0 else max(o, c)
        l = float(row["Low"]) if "Low" in view.columns and pd.notna(row["Low"]) and float(row["Low"]) > 0 else min(o, c)
        v = float(row["Volume"]) if "Volume" in view.columns and pd.notna(row["Volume"]) else 0.0
        ohlcv.append({
            "time": idx.strftime("%Y-%m-%d"),
            "open": round(o, price_dec),
            "high": round(h, price_dec),
            "low": round(l, price_dec),
            "close": round(c, price_dec),
            "volume": round(v, 0),
        })

    series = {
        "dates": [idx.strftime("%Y-%m-%d") for idx in view.index],
        "ohlcv": ohlcv,
        "close": _to_clean_list(view["Close"], price_dec),
        "ma5": _to_clean_list(view["MA5"], price_dec),
        "ma20": _to_clean_list(view["MA20"], price_dec),
        "ma60": _to_clean_list(view["MA60"], price_dec),
        "ma120": _to_clean_list(view["MA120"], price_dec),
        "bb_upper": _to_clean_list(view["BB_UPPER"], price_dec),
        "bb_lower": _to_clean_list(view["BB_LOWER"], price_dec),
        "rsi14": _to_clean_list(view["RSI14"], 2),
        "macd": _to_clean_list(view["MACD"], 2),
        "macd_signal": _to_clean_list(view["MACD_SIGNAL"], 2),
        "macd_hist": _to_clean_list(view["MACD_HIST"], 2),
    }

    logger.info(
        "[QUANT] 기술지표 계산 완료 (code=%s, rsi14=%s, macd=%s)",
        code,
        latest["rsi14"],
        latest["macd"],
    )

    return {
        "code": str(code).strip(),
        "name": name,
        "latest": latest,
        "series": series,
    }


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    import json
    tech = calculate_technical_indicators("000660")
    print("LATEST:", json.dumps(tech["latest"], ensure_ascii=False, indent=2))
    print("SERIES_DAYS:", len(tech["series"]["dates"]))
