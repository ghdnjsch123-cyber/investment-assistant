# 📈 나의 투자도우미 (My Investment Assistant)

국내/미국 주식, ETF, 가상자산(바이낸스 USDT 현물·선물·펀딩비·청산 로드맵·히트맵·공포탐욕·도미넌스·미국 거시지표)을 실시간으로 수집·시각화하고 Dify AI로 분석하는 웹 서비스입니다.

---

## 🌐 누구나 웹 주소로 바로 이용하게 배포하기 (권장 · 보안 안전)

API 키를 GitHub나 프론트엔드 코드에 노출하지 않고, **서버 환경변수에만 안전하게 저장**해두면 어떤 PC/모바일에서 접속해도 별도 키 입력 없이 모든 기능을 즉시 이용할 수 있습니다.

### Render 무료/유료 웹 배포 방법 (`render.yaml` / `Procfile` 포함)
1. [Render](https://render.com) 로그인 → **New +** → **Blueprint** (또는 **Web Service**) 선택
2. GitHub 저장소 `ghdnjsch123-cyber/investment-assistant` 연결
3. Render 대시보드의 **Environment** 탭에 아래 비밀키 등록:
   - `DIFY_BASE_URL`: `https://api.dify.ai/v1`
   - `DIFY_ANALYSIS_API_KEY`
   - `DIFY_TECHNICAL_API_KEY`
   - `SERPER_API_KEY`
   - `DART_API_KEY`
   - `GEMINI_API_KEY`
4. 배포 완료 후 생성된 URL(`https://xxx.onrender.com`)에 접속하면 **어느 PC에서나 로그인·키 입력 없이 바로 사용**할 수 있습니다.

---

## 💻 로컬 PC에서 직접 실행하기

- **Windows**: `run_windows.bat` 실행
- **macOS / Linux**: `bash run_mac_linux.sh`
