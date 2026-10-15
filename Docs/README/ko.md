# Kawaikara WebExtension

[English](../../README.md) · [日本語](ja.md)

Kawaikara Provider가 제공하는 브라우저 메뉴와 페이지 기능을 사용합니다.
카와이카라에서 영상 열기·다운로드 같은 기능은 설치된 Provider의 선언에 따라 제공됩니다.
확장은 브라우저와 Kawaikara를 연결하고, 사용자가 켠 Provider 기능을 적용합니다.

## 설치

**Google Chrome 121 이상**, **Mozilla Firefox 140 이상**과 호환되는 Kawaikara 앱이 필요합니다.

로컬 빌드는 [빌드 안내](../Build.md)를 따른 뒤 브라우저에서 로드합니다.

- **Chrome:** `chrome://extensions`에서 개발자 모드를 켜고 **압축 해제된 확장 프로그램 로드**로 `dist/chrome`을 선택합니다.
- **Firefox:** `about:debugging#/runtime/this-firefox`의 **임시 부가 기능 로드**에서 `dist/firefox/manifest.json`을 선택합니다. 임시 설치는 Firefox를 종료하면 해제됩니다.

## 사용 흐름

1. Kawaikara를 실행하고 **설정 → 고급 → Extension 사용하기**를 누릅니다.
2. 기본 브라우저에 연결 페이지가 열리고, 성공하면 같은 탭이 확장 설정으로 바뀝니다. 해당 브라우저에 확장이 설치되고 활성화되어 있어야 합니다.
3. 사용할 Provider의 WebExtension 기능을 선택한 뒤 **적용하기**를 누르고 요약된 권한 요청을 승인합니다.
4. 지원 사이트에서 Provider가 제공하는 메뉴와 페이지 기능을 사용합니다.

확장 설정의 연결하기로 시작해 Kawaikara에서 승인할 수도 있습니다.
Provider는 각각 켜거나 끌 수 있으며 연결을 해제하면 연결 정보와 캐시된 기능이 제거됩니다.

앱이 꺼져도 승인된 기능은 캐시로 유지됩니다. 기능을 누르면 Kawaikara 실행과 재연결을
요청한 뒤 실행합니다. 자동 실행에는 앱 실행 경로의 OS 등록이 필요하며 개발 빌드는
앱을 직접 실행해야 할 수 있습니다.

## 문서

빌드·검증·연결 문제 해결·구현·번역·버전 정책은 [Docs](../Index.md)에서 관리합니다.
