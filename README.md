# Kawaikara Web Extension

Chrome과 Firefox에서 지원 사이트의 현재 페이지나 링크를 Kawaikara 데스크톱 앱으로 전달하는 WebExtension입니다.

## 기능

- 지원 사이트에서 확장 아이콘을 누르면 현재 페이지를 Kawaikara에서 열기
- 지원 사이트의 페이지 또는 `<video>` 요소를 우클릭해 **Kawaikara에서 열기**
- 페이지 또는 영상의 **Kawaikara 링크 복사**
- YouTube와 CHZZK 영상의 자체 우클릭 메뉴에도 열기와 링크 복사 항목 표시
- 지원 사이트로 향하는 링크를 우클릭해 **링크를 Kawaikara에서 열기**
- 한국어, 영어, 일본어 메뉴
- 열기는 `kawaikara://open?url=...`, 공유용 복사는 `https://kawaikara.github.io/open/?url=...` 사용

지원 사이트 목록은 `src/supported-sites.js`에서 관리합니다.

## 빌드와 검사

Node.js 20 이상에서 다음을 실행

```sh
npm run check
```

결과물은 다음 디렉터리에 생성됨

- Chrome: `dist/chrome`
- Firefox: `dist/firefox`

## 개발용 설치

Chrome에서는 `chrome://extensions`에서 **개발자 모드**를 켜고 **압축해제된 확장 프로그램을 로드합니다**를 눌러 `dist/chrome`을 선택합니다.

Firefox에서는 `about:debugging#/runtime/this-firefox`에서 **임시 부가 기능 로드**를 누르고 `dist/firefox/manifest.json`을 선택합니다.

데스크톱 앱도 이 저장소의 최신 버전이어야 합니다. 처음 열 때 브라우저 또는 운영체제가 `kawaikara://` 외부 앱 실행 여부를 물을 수 있습니다.


## TODO
개발자용과 유저용 채널 분리

