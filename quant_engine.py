import logging
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import FinanceDataReader as fdr

logger = logging.getLogger("StockAssistant")


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


def calculate_technical_indicators(code: str, days: int = 365, display_days: int = 120) -> dict:
    """MA(5/20/60/120), RSI(14), MACD(12,26,9), 볼린저밴드(20,2)를 계산합니다."""
    df = fetch_price_history(code, days=days)
    name = _resolve_stock_name(code)
    close = df["Close"].astype(float)

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
        "close": int(round(float(last_row["Close"]))),
        "ma5": _val("MA5", 0),
        "ma20": _val("MA20", 0),
        "ma60": _val("MA60", 0),
        "ma120": _val("MA120", 0),
        "bb_upper": _val("BB_UPPER", 0),
        "bb_mid": _val("MA20", 0),
        "bb_lower": _val("BB_LOWER", 0),
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
            "open": round(o, 0),
            "high": round(h, 0),
            "low": round(l, 0),
            "close": round(c, 0),
            "volume": round(v, 0),
        })

    series = {
        "dates": [idx.strftime("%Y-%m-%d") for idx in view.index],
        "ohlcv": ohlcv,
        "close": _to_clean_list(view["Close"], 0),
        "ma5": _to_clean_list(view["MA5"], 0),
        "ma20": _to_clean_list(view["MA20"], 0),
        "ma60": _to_clean_list(view["MA60"], 0),
        "ma120": _to_clean_list(view["MA120"], 0),
        "bb_upper": _to_clean_list(view["BB_UPPER"], 0),
        "bb_lower": _to_clean_list(view["BB_LOWER"], 0),
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
