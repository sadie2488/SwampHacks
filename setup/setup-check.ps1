# Checks that this Windows laptop is ready to work on the project. Safe to run any time: it only looks, never installs.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File setup\setup-check.ps1 [-Lane <lane>]
# Lanes: lane-a (music to data / ML), lane-b (live audio), lane-c (vision + visuals), lane-d (create), commands, playback, shell, server-core, design, deploy
# Every MISSING line says exactly how to fix it. Exit code 0 = ready, 1 = something to fix.
param([string]$Lane = "")

$script:problems = 0
$script:warnings = 0

function Ok($text) { Write-Host ("OK       " + $text) -ForegroundColor Green }
function Missing($text, $fix, $more) {
    $script:problems++
    Write-Host ("MISSING  " + $text) -ForegroundColor Red
    if ($fix) { Write-Host ("         Fix:  " + $fix) }
    if ($more) { Write-Host ("         More: " + $more) }
}
function Warn($text, $fix) {
    $script:warnings++
    Write-Host ("NOTE     " + $text) -ForegroundColor Yellow
    if ($fix) { Write-Host ("         " + $fix) }
}
function Have($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Run($exe, $argList) {
    try { return (& $exe @argList 2>$null | Out-String).Trim() } catch { return "" }
}

Write-Host "Checking this computer (Windows) ..."
Write-Host ""

# --- Git and Git Bash ---
if (Have "git") {
    Ok ((Run "git" @("--version")))
    $bash = (Test-Path "$env:ProgramFiles\Git\bin\bash.exe") -or (Test-Path "${env:ProgramFiles(x86)}\Git\bin\bash.exe") -or (Have "bash")
    if ($bash) { Ok "Git Bash (the shell the project's scripts expect)" }
    else { Missing "Git Bash not found" "Reinstall Git and keep the 'Git Bash' option ticked: winget install --id Git.Git -e" "https://git-scm.com/download/win" }
} else {
    Missing "Git is not installed" "winget install --id Git.Git -e   (then close and reopen this window)" "https://git-scm.com/download/win"
}

# --- Node 20 or newer ---
if (Have "node") {
    $nv = (Run "node" @("-v")) -replace "^v", ""
    $major = 0
    try { $major = ([version]$nv).Major } catch { $major = 0 }
    if ($major -ge 20) { Ok ("Node.js " + $nv) }
    else { Missing ("Node.js " + $nv + " is too old (need 20 or newer)") "winget install --id OpenJS.NodeJS.LTS -e   (then close and reopen this window)" "https://nodejs.org" }
} else {
    Missing "Node.js is not installed" "winget install --id OpenJS.NodeJS.LTS -e   (then close and reopen this window)" "https://nodejs.org"
}

# --- Python and uv ---
$py = ""
if (Have "python") { $py = Run "python" @("--version") } elseif (Have "py") { $py = Run "py" @("--version") }
if ($py -match "Python 3\.(\d+)") {
    if ([int]$Matches[1] -ge 11) { Ok $py } else { Missing ($py + " is too old (need 3.11 or newer)") "uv can fetch one for you after it is installed: uv python install 3.12" "https://docs.astral.sh/uv/" }
} else {
    Warn "Python 3 not found on its own" "That is fine: uv installs and manages Python for the project (uv python install 3.12)"
}
if (Have "uv") { Ok ((Run "uv" @("--version"))) }
else { Missing "uv (Python tool) is not installed" "winget install --id astral-sh.uv -e   (then close and reopen this window)" "https://docs.astral.sh/uv/getting-started/installation/" }

# --- Claude Code ---
if (Have "claude") { Ok ("Claude Code " + (Run "claude" @("--version"))) }
else { Missing "Claude Code is not installed" "npm install -g @anthropic-ai/claude-code   (needs Node.js first)" "https://docs.claude.com/en/docs/claude-code/setup" }

# --- GitHub CLI and sign-in ---
$ghReady = $false
if (Have "gh") {
    Ok ((Run "gh" @("--version")).Split("`n")[0])
    & gh auth status *> $null
    if ($LASTEXITCODE -eq 0) { Ok "Signed in to GitHub"; $ghReady = $true }
    else { Missing "Not signed in to GitHub" "gh auth login   (choose GitHub.com, HTTPS, then 'Login with a web browser')" "https://cli.github.com/manual/gh_auth_login" }
} else {
    Missing "GitHub CLI (gh) is not installed" "winget install --id GitHub.cli -e   (then close and reopen this window)" "https://cli.github.com"
}

# --- Access to the project repository ---
if ($ghReady) {
    $push = Run "gh" @("api", "repos/sadie2488/SwampHacks", "--jq", ".permissions.push")
    if ($push -eq "true") { Ok "You can push to the project repository" }
    elseif ($push -eq "false") { Missing "You are signed in but can't push to the project repository" "Ask the repo owner (sadie2488) to add your GitHub username as a collaborator, then accept the email invite" "https://github.com/sadie2488/SwampHacks/settings/access" }
    else { Missing "Could not check access to the project repository" "Check your internet, then run this again. If it keeps failing: gh auth status" "" }
}

# --- Chrome (everyone: camera, voice and audio features are tested in Chrome) ---
$chrome = (Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe") -or (Test-Path "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") -or (Test-Path "$env:LocalAppData\Google\Chrome\Application\chrome.exe")
if ($chrome) { Ok "Google Chrome" }
else { Missing "Google Chrome is not installed" "winget install --id Google.Chrome -e" "https://www.google.com/chrome/" }

# --- Task-specific ---
if ($Lane -ne "") {
    Write-Host ""
    Write-Host ("Extra checks for lane: " + $Lane)
}
if ($Lane -eq "lane-c" -or $Lane -eq "commands") {
    $cam = $null
    try { $cam = Get-PnpDevice -Class Camera -Status OK -ErrorAction Stop } catch { $cam = $null }
    if (-not $cam) { try { $cam = Get-PnpDevice -Class Image -Status OK -ErrorAction Stop } catch { $cam = $null } }
    if ($cam) { Ok "Webcam found" } else { Missing "No webcam found" "Plug in a webcam or use a laptop with one. Check Settings > Privacy > Camera lets desktop apps use it" "" }
}
if ($Lane -eq "lane-c") {
    $td = (Get-ChildItem "$env:ProgramFiles\Derivative" -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "TouchDesigner*" } | Select-Object -First 1)
    if ($td) { Ok $td.Name } else { Warn "TouchDesigner not found (only needed to build or view the visuals)" "Free non-commercial version: https://derivative.ca/download" }
}
if ($Lane -eq "lane-a") {
    if (Have "nvidia-smi") {
        $gpu = Run "nvidia-smi" @("--query-gpu=name,driver_version", "--format=csv,noheader")
        if ($gpu) { Ok ("NVIDIA GPU: " + $gpu) } else { Missing "nvidia-smi is installed but found no GPU" "Update the NVIDIA driver: https://www.nvidia.com/Download/index.aspx" "" }
    } else {
        Warn "No NVIDIA driver found (model training will use the slow CPU path)" "If this laptop has an NVIDIA GPU: https://www.nvidia.com/Download/index.aspx"
    }
}
if ($Lane -eq "lane-b" -or $Lane -eq "lane-d") {
    Warn "Microphone: the first time the app asks, click Allow in Chrome. Use headphones when practising so the song doesn't leak into the mic" ""
}

Write-Host ""
if ($script:problems -eq 0) {
    Write-Host "RESULT: READY. Everything needed is installed." -ForegroundColor Green
    exit 0
} else {
    Write-Host ("RESULT: " + $script:problems + " thing(s) to fix. Do the 'Fix' lines above, then run this check again.") -ForegroundColor Red
    exit 1
}
