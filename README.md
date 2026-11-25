# 📈 나의 투자도우미 (My Investment Assistant)

국내/미국 주식, ETF, 가상자산(바이낸스 USDT 현물·선물·펀딩비·청산 로드맵·히트맵·공포탐욕·도미넌스·미국 거시지표)을 실시간으로 수집·시각화하고 Dify AI로 분석하는 웹 대시보드입니다.

---

## 다른 PC에서 바로 실행하기 (1분 셋업)

### 1) 저장소 클론
```bash
git clone https://github.com/ghdnjsch123-cyber/investment-assistant.git
cd investment-assistant
```

### 2) 원클릭 실행
- **Windows**: `run_windows.bat` 더블클릭 (또는 터미널에서 `run_windows.bat`)
  - `venv` 생성 → `requirements.txt` 설치 → `.env` 자동 생성 → 브라우저(`http://127.0.0.1:5050`) 자동 실행
- **macOS / Linux**:
```bash
bash run_mac_linux.sh
```

### 3) API 키 설정 (웹 화면에서 바로 입력 가능!)
1. 브라우저(`http://127.0.0.1:5050`) 상단의 **`⚙️ API 키 설정`** 버튼을 클릭합니다.
2. 아래 API 키를 입력하고 **저장 및 즉시 적용**을 누르면 로컬 `.env` 파일에 자동 저장됩니다.
   - `DIFY_ANALYSIS_API_KEY`: 종목·코인 종합 AI 분석 챗봇 키
   - `DIFY_TECHNICAL_API_KEY`: 기술적 지표 AI 해석 챗봇 키
   - `SERPER_API_KEY`: 구글 뉴스 검색 키
   - `DART_API_KEY`: 금융감독원 Open DART 공시·재무제표 키
   - *(바이낸스 현물/선물/펀딩비/청산 로드맵, 크립토 히트맵, 공포·탐욕 지수, BTC 도미넌스, 미국 거시지표 일정은 별도 API 키 없이 즉시 작동합니다.)*
