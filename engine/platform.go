package main

import "runtime"

// isWindows: PaperROAD 는 맥 전용이에요. (업데이트 코드를 MSROAD 와 같은 모양으로 두려고 남겨 둔 표시)
var isWindows = runtime.GOOS == "windows"
