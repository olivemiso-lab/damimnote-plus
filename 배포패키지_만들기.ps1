# ════════════════════════════════════════════════════
#  담임노트+ 배포 패키지 만들기
#  - 이 파일을 우클릭 → "PowerShell에서 실행" 하면
#    개발용 백업(.bak)·개인 파일을 뺀 깨끗한 ZIP이 만들어집니다.
# ════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 버전은 js\app.js 의 APP_VERSION 에서 자동으로 읽음
$appjs = Get-Content (Join-Path $root 'js\app.js') -Raw -Encoding UTF8
$ver = 'dev'
if ($appjs -match "APP_VERSION\s*=\s*'([^']+)'") { $ver = $Matches[1] }

$distName = "담임노트플러스_v$ver"
$dist = Join-Path $root "_dist\$distName"
if (Test-Path (Join-Path $root '_dist')) { Remove-Item (Join-Path $root '_dist') -Recurse -Force }
New-Item -ItemType Directory -Force "$dist\css" | Out-Null
New-Item -ItemType Directory -Force "$dist\js\lib" | Out-Null

# ── 배포에 포함할 파일만 복사 (.bak·개인 PDF 등 제외) ──
Copy-Item (Join-Path $root 'index.html') $dist
Copy-Item (Join-Path $root 'css\style.css') "$dist\css"
Get-ChildItem (Join-Path $root 'js') -File | Where-Object { $_.Name -like '*.js' -and $_.Name -notmatch '\.bak' } |
  ForEach-Object { Copy-Item $_.FullName "$dist\js" }
Get-ChildItem (Join-Path $root 'js\lib') -File | Where-Object { $_.Name -notmatch '\.bak' } |
  ForEach-Object { Copy-Item $_.FullName "$dist\js\lib" }

# ── 처음 사용하는 선생님용 안내문 ──
$guide = @"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📒 담임노트+ v$ver — 처음 시작하기
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ 시작 방법 (설치 필요 없음!)
  1. 이 폴더를 통째로 원하는 곳에 두세요. (예: 문서 폴더)
  2. index.html 을 더블클릭하면 바로 실행됩니다.
  3. 크롬 / 엣지 / 웨일 브라우저를 권장합니다.

■ 데이터는 어디에 저장되나요?
  · 지금 쓰는 컴퓨터의 "그 브라우저 안"에만 저장됩니다.
  · 인터넷으로 전송되지 않아요. (100% 오프라인)
  · 그래서 다른 컴퓨터/다른 브라우저에서 열면 빈 화면이 정상입니다.

■ ⚠️ 꼭 지켜주세요 — 데이터 지키기
  · 브라우저에서 "인터넷 사용 기록 삭제(쿠키/사이트 데이터)"를 하면
    학급 데이터가 함께 지워질 수 있습니다!
  · [데이터 관리] 메뉴에서 주기적으로 백업(JSON 파일)을 내려받아
    USB나 개인 드라이브에 보관하세요.
  · 컴퓨터를 바꿀 땐: 백업 내려받기 → 새 컴퓨터에서 복원.

■ 처음 할 일 (5분)
  1. [설정] 학교·학년·반·급훈·시간표 입력
  2. [학생 관리] ⚡일괄 버튼 → 엑셀 명단 복사-붙여넣기로 한 번에 등록
  3. [출석부] 오늘 출석 저장 — 메인 화면 알림이 사라집니다

■ 개인정보 안내
  · 학생 정보는 선생님 컴퓨터 밖으로 나가지 않습니다.
  · 공용 컴퓨터에서는 사용을 권장하지 않습니다.

■ 참고
  · 수행평가 PDF 자동 인식은 계획서 표 양식에 따라 안 될 수 있어요.
    그땐 "새 평가 만들기"로 직접 입력하면 됩니다.
  · 오픈소스: pdf.js(Apache-2.0), qrcode-generator(MIT)

  담임의 기록이 학생의 성장으로 이어집니다. · Silver쌤 & 루미 🌱
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"@
# 메모장 호환을 위해 BOM 있는 UTF-8로 저장
[System.IO.File]::WriteAllText("$dist\처음_시작하기.txt", $guide, (New-Object System.Text.UTF8Encoding($true)))

# ── ZIP 생성 ──
$zip = Join-Path $root "$distName.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $dist -DestinationPath $zip
Remove-Item (Join-Path $root '_dist') -Recurse -Force

Write-Host ""
Write-Host "✅ 배포 패키지 완성: $zip" -ForegroundColor Green
Write-Host "   이 ZIP을 그대로 다른 선생님께 전달하면 됩니다."
Write-Host "   (받는 분: 압축 풀기 → index.html 더블클릭)"
