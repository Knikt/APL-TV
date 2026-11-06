<#
  build.ps1: builds APL TV's .wgt, signs it with your Samsung certificate and, with -Install, installs it
  on the screen. APL TV needs no root: it installs in Developer Mode (sdb, Host PC IP = this PC) like any
  app. When the screen has Vetro (http://<screen>:8099), the package goes through Vetro instead, so
  Developer Mode can stay off.

    .\tools\build.ps1 -TizenCli <path to tizen.bat> [-Profile APLPartner] [-Install -Ip 192.168.1.50] [-Dev] [-Launch]

  -Dev keeps js/dev.local.js: the app's log can then be read from the PC at http://<screen>:8765/dev/log.
  Never published: js/keys.local.js (your TMDB key) and the fonts and sounds copied from APL Launcher.
#>
param(
    [Parameter(Mandatory = $true)][string]$TizenCli,
    [string]$Profile = "APLPartner",
    [switch]$Install,
    [string]$Ip,
    [switch]$Dev,
    [switch]$Launch
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "app"
$dist = Join-Path $root "dist"
$work = Join-Path $dist "work"
$appId = "APLTVMedia.TV"; $pkg = "APLTVMedia"

$version = ([regex]::Match((Get-Content -LiteralPath (Join-Path $app "config.xml") -Raw), '<widget[^>]*\sversion="([^"]+)"')).Groups[1].Value
Write-Host "APL TV $version" -ForegroundColor Cyan

# ---------- copy, without what must not be in the package ----------
if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
Copy-Item -Path (Join-Path $app "*") -Destination $work -Recurse -Force
Get-ChildItem -LiteralPath $work -Recurse -File | Where-Object { $_.Name -like "*signature*.xml" -or $_.Name -eq ".manifest.tmp" -or $_.Extension -eq ".wgt" } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -Confirm:$false }
if (-not $Dev) {
    Remove-Item -LiteralPath (Join-Path $work "js\dev.local.js") -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath (Join-Path $work "js\dev.local.js") -Value "/* release build */" -Encoding UTF8
}
if (-not (Test-Path (Join-Path $work "js\keys.local.js"))) { Copy-Item (Join-Path $work "js\keys.example.js") (Join-Path $work "js\keys.local.js") }

# ---------- zip, then sign ----------
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$unsigned = Join-Path $dist "apl-tv-unsigned.wgt"
if (Test-Path $unsigned) { Remove-Item -LiteralPath $unsigned -Force }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($unsigned, 'Create')
try {
    Get-ChildItem -LiteralPath $work -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($work.Length + 1).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal')
    }
} finally { $zip.Dispose() }

$signed = Join-Path $dist "signed"
if (Test-Path $signed) { Remove-Item -LiteralPath $signed -Recurse -Force }
New-Item -ItemType Directory -Force -Path $signed | Out-Null
$out = & cmd /c "`"$TizenCli`" package -t wgt -s $Profile -o `"$signed`" -- `"$unsigned`" 2>&1"
$out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
$wgt = Get-ChildItem -LiteralPath $signed -Filter *.wgt | Select-Object -First 1
if (-not $wgt) { $wgt = Get-Item -LiteralPath $unsigned }
$zip = [IO.Compression.ZipFile]::OpenRead($wgt.FullName)
try { $hasSig = [bool]($zip.Entries | Where-Object { $_.FullName -eq "author-signature.xml" }) } finally { $zip.Dispose() }
if (-not $hasSig) { throw "The package was not signed. Tizen said: $out" }
$final = Join-Path $dist ("apl-tv-v$version" + $(if ($Dev) { "-dev" } else { "" }) + ".wgt")
Copy-Item -LiteralPath $wgt.FullName -Destination $final -Force
Remove-Item -LiteralPath $signed -Recurse -Force; Remove-Item -LiteralPath $unsigned -Force
Write-Host "Signed: $final" -ForegroundColor Green
if (-not $Install) { return }
if (-not $Ip) { throw "-Install needs the screen's address: -Ip 192.168.1.50" }

$base = "http://$Ip`:8099"
$vetro = $false
try { $vetro = [bool](Invoke-RestMethod -Uri "$base/exec" -Method Post -ContentType 'application/json' -Body '{"cmd":"true"}' -TimeoutSec 5).ok } catch {}

# ---------- no Vetro: Developer Mode (sdb), like any app ----------
if (-not $vetro) {
    Write-Host "Vetro does not answer: installing in Developer Mode." -ForegroundColor Cyan
    $sdb = Join-Path (Split-Path (Split-Path (Split-Path $TizenCli))) "sdb.exe"
    if (-not (Test-Path -LiteralPath $sdb)) { throw "sdb.exe not found next to Tizen Studio ($sdb)" }
    & $sdb connect "$Ip`:26101" | Out-Host
    $serial = (& $sdb devices | Select-String -SimpleMatch $Ip | Select-Object -First 1)
    if (-not $serial) { throw "The screen refused the connection. On the screen: Apps, 1 2 3 4 5, Developer Mode On, Host PC IP = this PC's address, then restart the screen." }
    $serial = ($serial.Line.Trim() -split '\s+')[0]
    $out = & cmd /c "`"$TizenCli`" install -n `"$final`" -s $serial 2>&1"
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    $said = $out -join "`n"
    if ($said -match 'fail|error' -or $said -notmatch 'success|Installed the package') { throw "The screen did not install APL TV. Tizen said: $($out -join ' ')" }
    Write-Host "APL TV $version is installed." -ForegroundColor Green
    if ($Launch) { & cmd /c "`"$TizenCli`" run -p $appId -s $serial 2>&1" | Out-Null; Write-Host "Launched." -ForegroundColor Green }
    return
}

# ---------- Vetro on the screen: no Developer Mode needed ----------
function Tv([string]$Cmd, [int]$Timeout = 60) {
    $body = @{ cmd = $Cmd } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Uri "$base/exec" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec $Timeout
    if (-not $r.ok) { throw "the screen refused a command ($($r.stderr)$($r.error))" }
    return [string]$r.output
}
$tmp = "/tmp/apl-tv.wgt"
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($final))
Tv ": > $tmp.b64" | Out-Null
for ($o = 0; $o -lt $b64.Length; $o += 48000) {
    $part = $b64.Substring($o, [Math]::Min(48000, $b64.Length - $o))
    Tv "printf '%s' '$part' >> $tmp.b64" | Out-Null
}
$sum = Tv "base64 -d $tmp.b64 > $tmp && rm -f $tmp.b64 && chmod 644 $tmp && sha256sum $tmp"
$local = (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sum -notmatch $local) { throw "the package arrived damaged on the screen" }
Write-Host "Copied to the screen, hash checked." -ForegroundColor Green
$res = Tv "pkgcmd -i -t wgt -p $tmp 2>&1 | tail -5; echo exit=`$?" 180
Write-Host ($res.Trim() -replace '(?m)^', '  ') -ForegroundColor DarkGray
Tv "rm -f $tmp" | Out-Null
$n = Tv "pkgcmd -l 2>/dev/null | grep -F '[$pkg]' | grep -cF 'version [$version]' || true"
if ((($n.Trim() -split '\s+')[-1]) -in @('', '0')) { throw "the screen did not install APL TV $version" }
Write-Host "APL TV $version is installed." -ForegroundColor Green
if ($Launch) {
    Invoke-RestMethod -Uri "$base/apps/launch" -Method Post -ContentType 'application/json' -Body (@{ appId = $appId } | ConvertTo-Json -Compress) -TimeoutSec 25 | Out-Null
    Write-Host "Launched." -ForegroundColor Green
}
