param(
    [Parameter(Position = 0)]
    [string]$Mode = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Host.UI.RawUI.WindowTitle = '小红书评论采集工具'

$appDir = $PSScriptRoot
$extensionDir = Join-Path $appDir 'xhs_chrome_extension'
$manifest = Join-Path $extensionDir 'manifest.json'
$signServer = Join-Path $appDir 'xhs_sign_server.js'
$signer = Join-Path $appDir 'xhs_main_260411.js'
$serviceUrl = 'http://127.0.0.1:18765'
$setupOnly = $Mode -eq '--setup-only'
$instructionsOnly = $Mode -eq '--instructions-only'
$firstSetup = $false

function Wait-BeforeExit {
    if (-not $script:setupOnly -and -not $script:instructionsOnly) {
        [void](Read-Host '按回车键关闭窗口')
    }
}

function Stop-WithMessage {
    param([string[]]$Message)

    foreach ($line in $Message) {
        Write-Host $line -ForegroundColor Red
    }
    Write-Host
    Wait-BeforeExit
    exit 1
}

function Find-Node {
    $candidates = @(
        (Join-Path $extensionDir 'node\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    )

    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ($programFilesX86) {
        $candidates += Join-Path $programFilesX86 'nodejs\node.exe'
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

function Find-Npm {
    param([string]$NodePath)

    $besideNode = Join-Path (Split-Path -Parent $NodePath) 'npm.cmd'
    if (Test-Path -LiteralPath $besideNode) {
        return $besideNode
    }

    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

function Test-Dependency {
    param([string]$NodePath)

    Push-Location $appDir
    try {
        & $NodePath -e "require.resolve('crypto-js')" *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        Pop-Location
    }
}

function Install-Dependencies {
    param(
        [string]$NodePath,
        [string]$NpmPath
    )

    $script:firstSetup = $true
    Write-Host '[首次使用 2/2] 正在安装采集工具所需组件...' -ForegroundColor Yellow
    Write-Host '这通常需要几秒到几分钟，请保持网络连接，不要关闭窗口。'
    Write-Host

    Push-Location $appDir
    try {
        & $NpmPath ci --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com
        if ($LASTEXITCODE -ne 0) {
            Write-Host
            Write-Host '第一次安装未成功，正在自动重试...' -ForegroundColor Yellow
            & $NpmPath install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com
        }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Dependency -NodePath $NodePath)) {
        Stop-WithMessage @(
            '[安装失败] 所需组件没有安装成功。',
            '请检查网络后再次双击本文件；仍失败时请把本窗口截图发给技术支持。'
        )
    }

    Write-Host
    Write-Host '[完成] 所需组件已安装。' -ForegroundColor Green
    Write-Host
}

function Show-Instructions {
    Write-Host '[启动成功] 本窗口需要在采集期间保持打开。' -ForegroundColor Green
    Write-Host
    Write-Host '接下来请在 Chrome 中：'
    Write-Host '1. 打开 chrome://extensions/'
    Write-Host '2. 开启右上角“开发者模式”'
    Write-Host '3. 点击“加载已解压的扩展程序”'
    Write-Host '4. 选择下面这个文件夹：'
    Write-Host "   $extensionDir" -ForegroundColor Cyan
    Write-Host '5. 登录小红书，点击插件开始采集'
    Write-Host
    Write-Host '插件路径已复制到剪贴板，可以在选择文件夹时直接粘贴。'
    Write-Host ('=' * 50)
    Write-Host
}

function Show-FirstUseWindows {
    try {
        Set-Clipboard -Value $extensionDir
    }
    catch {
        # 剪贴板不可用不影响采集。
    }

    $chromeCandidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
    )
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ($programFilesX86) {
        $chromeCandidates += Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe'
    }

    $chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($chrome) {
        Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions/'
    }
    Start-Process -FilePath explorer.exe -ArgumentList $extensionDir
}

Write-Host ('=' * 50)
Write-Host '      小红书关键词笔记与评论采集工具'
Write-Host ('=' * 50)
Write-Host

if (-not (Test-Path -LiteralPath $manifest)) {
    Stop-WithMessage @(
        '[无法启动] 插件文件不完整。',
        '请重新下载并完整解压项目，不要只复制启动文件。'
    )
}
if (-not (Test-Path -LiteralPath $signServer)) {
    Stop-WithMessage @(
        '[无法启动] 缺少签名服务文件：xhs_sign_server.js',
        '请重新下载并完整解压项目。'
    )
}
if (-not (Test-Path -LiteralPath $signer)) {
    Stop-WithMessage @(
        '[无法启动] 缺少签名文件：xhs_main_260411.js',
        '请重新下载并完整解压项目。'
    )
}

$node = Find-Node
if (-not $node) {
    $firstSetup = $true
    Write-Host '[首次使用 1/2] 电脑中没有运行环境，正在自动安装 Node.js...' -ForegroundColor Yellow
    Write-Host '安装过程中如果弹出确认窗口，请点击“是”或“允许”。'
    Write-Host

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        & $winget.Source install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
        $node = Find-Node
    }

    if (-not $node) {
        Write-Host '[需要安装一次] 系统无法自动安装 Node.js。' -ForegroundColor Yellow
        Write-Host '即将打开官方下载页面，请下载安装 LTS 版本。'
        Write-Host '安装时一直点击“下一步”即可，完成后再次双击“启动采集工具.bat”。'
        Write-Host
        Start-Process 'https://nodejs.org/zh-cn/download/'
        Wait-BeforeExit
        exit 1
    }
    Write-Host '[完成] Node.js 已安装。' -ForegroundColor Green
    Write-Host
}

$npm = Find-Npm -NodePath $node
if (-not $npm) {
    Stop-WithMessage @(
        '[无法启动] 已找到 Node.js，但没有找到配套的 npm。',
        '请重新安装 Node.js LTS，然后再次双击本文件。',
        '下载地址：https://nodejs.org/'
    )
}

if ($setupOnly -or -not (Test-Dependency -NodePath $node)) {
    Install-Dependencies -NodePath $node -NpmPath $npm
}

if ($setupOnly) {
    Write-Host '[检查通过] 新电脑初始化已完成。' -ForegroundColor Green
    exit 0
}

if ($instructionsOnly) {
    Show-Instructions
    exit 0
}

try {
    $health = Invoke-RestMethod -Uri "$serviceUrl/health" -TimeoutSec 2
}
catch {
    $health = $null
}

if ($health -and $health.ok) {
    Write-Host '[可以使用] 采集服务已经在运行。' -ForegroundColor Green
    Write-Host
    Write-Host '请回到 Chrome，登录小红书后点击插件开始采集。'
    Write-Host "插件文件夹：$extensionDir"
    Write-Host
    Wait-BeforeExit
    exit 0
}

if ($firstSetup) {
    Show-FirstUseWindows
}
else {
    try {
        Set-Clipboard -Value $extensionDir
    }
    catch {
        # 剪贴板不可用不影响采集。
    }
}

Show-Instructions
& $node $signServer

Write-Host
Write-Host '[服务已停止] 如果不是您主动关闭，请把本窗口截图发给技术支持。' -ForegroundColor Yellow
Write-Host
Wait-BeforeExit
exit 0
