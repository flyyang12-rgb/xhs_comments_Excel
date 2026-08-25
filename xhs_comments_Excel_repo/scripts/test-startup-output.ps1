$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$batch = Join-Path $repo '启动采集工具.bat'
$command = '"' + $batch + '" --instructions-only'
$output = (& cmd.exe /d /s /c $command 2>&1 | Out-String)
$exitCode = $LASTEXITCODE

Write-Output $output

if ($exitCode -ne 0) {
    throw "启动指引退出码异常：$exitCode"
}

if ($output -match 'not recognized|不是内部或外部命令|无法识别') {
    throw '启动指引被命令解释器错误解析'
}

$requiredText = @(
    '启动成功',
    'chrome://extensions/',
    '加载已解压的扩展程序',
    'xhs_chrome_extension',
    '登录小红书'
)

foreach ($text in $requiredText) {
    if (-not $output.Contains($text)) {
        throw "启动指引缺少内容：$text"
    }
}

Write-Output 'Startup instruction output: PASS'
