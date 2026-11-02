param(
  [string]$Job,
  [string]$JobB64
)

# Remote helper for frontend/scripts/lab/lab-test.mjs (Windows lab PC).
# Invoked as: powershell -NoProfile -ExecutionPolicy Bypass -File lab.ps1 <job.json>
# Modes: status | extract | setup | run | doctor
# Exit codes: 0 ok, 95 usage, 96 extract failure, 97 setup failure, 124 timeout, otherwise the command's own code.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8

$EXIT_USAGE = 95
$EXIT_EXTRACT = 96
$EXIT_SETUP = 97
$EXIT_TIMEOUT = 124

function Info([string]$message) { Write-Output ("[lab] " + $message) }
function Fail([int]$code, [string]$message) {
  Write-Output ("[lab] FAIL " + $message)
  exit $code
}

function Quote-Arg([string]$value) {
  if ($value -eq '') { return "''" }
  return "'" + ([string]$value).Replace("'", "''") + "'"
}

try {
  if ($JobB64) {
    $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($JobB64))
    $cfg = $json | ConvertFrom-Json
  } elseif ($Job) {
    if (-not (Test-Path -LiteralPath $Job)) { Fail $EXIT_USAGE "job file missing: $Job" }
    $cfg = Get-Content -LiteralPath $Job -Raw -Encoding UTF8 | ConvertFrom-Json
  } else {
    Fail $EXIT_USAGE 'no job given (-Job or -JobB64)'
  }
} catch {
  Fail $EXIT_USAGE "job unreadable: $($_.Exception.Message)"
}

function Resolve-Tool([string]$name, [string]$fallback) {
  $found = Get-Command $name -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  return $fallback
}

switch ($cfg.mode) {
  'status' {
    $repoMarker = Join-Path $cfg.repoDir 'pytest.ini'
    $present = Test-Path -LiteralPath $repoMarker
    $shaFile = Join-Path $cfg.toolsDir 'repo.sha256'
    $sha = '-'
    if (Test-Path -LiteralPath $shaFile) { $sha = (Get-Content -LiteralPath $shaFile -Raw -Encoding UTF8).Trim() }
    if ($present) { Write-Output 'REPO_PRESENT=yes' } else { Write-Output 'REPO_PRESENT=no' }
    Write-Output ("REPO_SHA256=" + $sha)
    $hashFile = Join-Path $cfg.toolsDir 'hashes.json'
    $b64 = ''
    if (Test-Path -LiteralPath $hashFile) { $b64 = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($hashFile)) }
    Write-Output ("MANIFEST=" + $b64)
    exit 0
  }

  'extract' {
    if (-not (Test-Path -LiteralPath $cfg.archive)) { Fail $EXIT_EXTRACT "archive missing: $($cfg.archive)" }
    if (-not (Test-Path -LiteralPath $cfg.repoDir)) { New-Item -ItemType Directory -Force -Path $cfg.repoDir | Out-Null }
    $size = (Get-Item -LiteralPath $cfg.archive).Length
    Info ("extract start bytes=" + $size)
    & tar.exe -xf $cfg.archive -C $cfg.repoDir
    if ($LASTEXITCODE -ne 0) { Fail $EXIT_EXTRACT ("tar exit " + $LASTEXITCODE) }
    if (-not (Test-Path -LiteralPath (Join-Path $cfg.repoDir 'pytest.ini'))) { Fail $EXIT_EXTRACT 'sentinel pytest.ini missing after extract' }
    if (-not (Test-Path -LiteralPath (Join-Path $cfg.repoDir 'frontend/package.json'))) { Fail $EXIT_EXTRACT 'sentinel frontend/package.json missing after extract' }

    if ($cfg.manifest -and (Test-Path -LiteralPath $cfg.manifest)) {
      $keep = New-Object 'System.Collections.Generic.HashSet[string]'
      Get-Content -LiteralPath $cfg.manifest -Encoding UTF8 | ForEach-Object {
        if ($_ -ne '') { [void]$keep.Add($_.Replace('\', '/')) }
      }
      $skipDirs = @('node_modules', '.venv', '.git', '__pycache__', '.pytest_cache', '.cache', '.build', '.omo', 'dist')
      $removed = New-Object 'System.Collections.Generic.List[string]'
      $walk = $null
      $walk = {
        param([string]$dir, [string]$prefix)
        foreach ($entry in (Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue)) {
          $rel = if ($prefix) { $prefix + '/' + $entry.Name } else { $entry.Name }
          if ($entry.PSIsContainer) {
            if ($skipDirs -contains $entry.Name) { continue }
            & $walk $entry.FullName $rel
          } elseif (-not $keep.Contains($rel)) {
            Remove-Item -LiteralPath $entry.FullName -Force -ErrorAction SilentlyContinue
            $removed.Add($rel) | Out-Null
          }
        }
      }
      foreach ($top in @('frontend/src', 'frontend/scripts', 'frontend/public', 'frontend/config', 'weather', 'backend', 'common', 'docs', 'car_vision_model', 'TrafficSafety')) {
        $full = Join-Path $cfg.repoDir $top
        if (Test-Path -LiteralPath $full) {
          $parent = Split-Path -Parent $top
          $base = Split-Path -Leaf $top
          $pref = if ($parent) { $parent.Replace('\', '/') + '/' + $base } else { $base }
          & $walk $full $pref
        }
      }
      if ($removed.Count -gt 0) { Info ("pruned " + $removed.Count + " file(s) not in the upload: " + (($removed | Select-Object -First 5) -join ', ')) }
    }

    # Publish the per-file hashes only after a complete extract, so an interrupted transfer is re-sent.
    if ($cfg.manifestHash -and (Test-Path -LiteralPath $cfg.manifestHash)) {
      Move-Item -LiteralPath $cfg.manifestHash -Destination (Join-Path $cfg.toolsDir 'hashes.json') -Force
    }
    Set-Content -LiteralPath (Join-Path $cfg.toolsDir 'repo.sha256') -Value $cfg.contentKey -Encoding ASCII
    Remove-Item -Path (Join-Path $cfg.toolsDir 'repo-*.tar') -Force -ErrorAction SilentlyContinue
    Info 'extract ok'
    exit 0
  }

  'setup' {
    $deps = Join-Path $cfg.branchDir 'deps'
    New-Item -ItemType Directory -Force -Path $deps | Out-Null
    $bunMarker = Join-Path $deps ('bun-' + $cfg.bunHash + '.ok')
    $pyMarker = Join-Path $deps ('venv-' + $cfg.pyHash + '.ok')
    $venvPython = Join-Path $cfg.venvDir 'Scripts\python.exe'
    $frontendDir = Join-Path $cfg.repoDir 'frontend'

    if (-not (Test-Path -LiteralPath $frontendDir)) { Fail $EXIT_SETUP 'repo/frontend missing; extract first' }

    if (-not (Test-Path -LiteralPath $bunMarker)) {
      Info 'deps: bun install --frozen-lockfile'
      Push-Location -LiteralPath $frontendDir
      try { & bun install --frozen-lockfile } finally { Pop-Location }
      if ($LASTEXITCODE -ne 0) { Fail $EXIT_SETUP ("bun install exit " + $LASTEXITCODE) }
      Set-Content -LiteralPath $bunMarker -Value $cfg.bunHash -Encoding ASCII
      Info 'deps: bun install ok'
    }

    if (-not (Test-Path -LiteralPath $venvPython)) {
      $uv = Resolve-Tool 'uv' $cfg.uvExe
      Info ("deps: uv venv " + $cfg.venvDir)
      & $uv venv $cfg.venvDir --python 3.14
      if ($LASTEXITCODE -ne 0) { Fail $EXIT_SETUP ("uv venv exit " + $LASTEXITCODE) }
    }

    if (-not (Test-Path -LiteralPath $pyMarker)) {
      $uv = Resolve-Tool 'uv' $cfg.uvExe
      Info 'deps: uv pip install -r weather/requirements.txt -r backend/simulation/requirements.txt'
      & $uv pip install -r (Join-Path $cfg.repoDir 'weather/requirements.txt') -r (Join-Path $cfg.repoDir 'backend/simulation/requirements.txt') --python $venvPython
      if ($LASTEXITCODE -ne 0) { Fail $EXIT_SETUP ("uv pip install exit " + $LASTEXITCODE) }
      Set-Content -LiteralPath $pyMarker -Value $cfg.pyHash -Encoding ASCII
      Info 'deps: uv pip install ok'
    }

    Info 'setup ok'
    exit 0
  }

  'run' {
    $argv = @($cfg.argv)
    if ($argv.Count -eq 0) { Fail $EXIT_USAGE 'empty command' }
    $exe = $cfg.exe
    if ($exe) {
      if ($argv.Count -gt 1) { $argv = $argv[1..($argv.Count - 1)] } else { $argv = @() }
    } else {
      $exe = $argv[0]
      if ($argv.Count -gt 1) { $argv = $argv[1..($argv.Count - 1)] } else { $argv = @() }
    }
    $timeoutS = [int]$cfg.timeoutS
    if ($timeoutS -le 0) { $timeoutS = 1800 }

    # PowerShell 5.1 cannot read the exit code of a Start-Process -PassThru child, so the command runs
    # in a nested PowerShell that prints the code into a file. The child inherits the ssh console, so
    # output stays live, and taskkill /T bounds a hung command.
    $quotePs = { param($value) (Quote-Arg ([string]$value)) }
    $envLines = @()
    if ($cfg.env) {
      foreach ($prop in $cfg.env.PSObject.Properties) { $envLines += ('$env:' + $prop.Name + ' = ' + (Quote-Arg ([string]$prop.Value))) }
    }
    $exeAndArgs = ((& $quotePs $exe) + ' ' + (($argv | ForEach-Object { & $quotePs $_ }) -join ' ')).TrimEnd()
    $template = @'
Set-Location -LiteralPath '{0}'
{1}
& {2}
$code = $LASTEXITCODE
if ($null -eq $code) { $code = 0 }
Set-Content -LiteralPath '{3}' -Value $code -Encoding ASCII
Write-Output ("[lab] child exit " + $code)
exit $code
'@
    $innerPath = Join-Path $cfg.toolsDir ('run-' + $cfg.stamp + '.ps1')
    $codeFile = Join-Path $cfg.toolsDir ('run-' + $cfg.stamp + '.code')
    if (Test-Path -LiteralPath $codeFile) { Remove-Item -LiteralPath $codeFile -Force }
    $inner = $template.Replace('{0}', $cfg.cwd).Replace('{1}', ($envLines -join "`n")).Replace('{2}', $exeAndArgs).Replace('{3}', $codeFile)
    Set-Content -LiteralPath $innerPath -Value $inner -Encoding UTF8

    Info ("run cwd=" + $cfg.cwd + " timeout=" + $timeoutS + "s cmd=" + $exeAndArgs)
    $proc = Start-Process -FilePath 'powershell' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $innerPath + '"') -NoNewWindow -PassThru
    if (-not $proc.WaitForExit($timeoutS * 1000)) {
      Info ("timeout after " + $timeoutS + "s; killing pid " + $proc.Id)
      & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
      try { $proc.WaitForExit(10000) | Out-Null } catch { }
      Fail $EXIT_TIMEOUT ("command timed out after " + $timeoutS + "s")
    }
    $code = 1
    if (Test-Path -LiteralPath $codeFile) {
      $raw = (Get-Content -LiteralPath $codeFile -Raw -ErrorAction SilentlyContinue)
      if ($null -ne $raw -and $raw.Trim() -match '^-?[0-9]+$') { $code = [int]$raw.Trim() }
    }
    Remove-Item -LiteralPath $innerPath -Force -ErrorAction SilentlyContinue
    Info ("exit " + $code)
    exit $code
  }

  'doctor' {
    $problems = New-Object 'System.Collections.Generic.List[string]'
    foreach ($spec in @(
      @{ name = 'bun'; argv = @('--version') },
      @{ name = 'node'; argv = @('--version') },
      @{ name = 'git'; argv = @('--version') },
      @{ name = 'uv'; argv = @('--version') },
      @{ name = 'tar'; argv = @('--version') }
    )) {
      $tool = Get-Command $spec.name -ErrorAction SilentlyContinue
      if (-not $tool) { Write-Output ("lab " + $spec.name + ": MISSING"); $problems.Add($spec.name) | Out-Null; continue }
      $toolArgv = $spec.argv
      $version = (& $spec.name @toolArgv) 2>&1 | Select-Object -First 1
      Write-Output ("lab " + $spec.name + ": " + ([string]$version).Trim())
    }
    $venvPython = Join-Path $cfg.venvDir 'Scripts\python.exe'
    if (Test-Path -LiteralPath $venvPython) {
      $pyVersion = (& $venvPython --version) 2>&1 | Select-Object -First 1
      Write-Output ("lab python: " + ([string]$pyVersion).Trim())
    } else {
      Write-Output 'lab python: MISSING (.venv)'
      $problems.Add('venv') | Out-Null
    }
    $deps = Join-Path $cfg.branchDir 'deps'
    $bunMarker = Test-Path -LiteralPath (Join-Path $deps ('bun-' + $cfg.bunHash + '.ok'))
    $pyMarker = Test-Path -LiteralPath (Join-Path $deps ('venv-' + $cfg.pyHash + '.ok'))
    $repoReady = Test-Path -LiteralPath (Join-Path $cfg.repoDir 'pytest.ini')
    Write-Output ("lab deps: bun=" + $(if ($bunMarker) { 'ok' } else { 'missing' }) + " venv=" + $(if ($pyMarker) { 'ok' } else { 'missing' }))
    Write-Output ("lab repo: " + $(if ($repoReady) { 'ok' } else { 'missing' }))
    if (-not $bunMarker) { $problems.Add('bun-deps') | Out-Null }
    if (-not $pyMarker) { $problems.Add('venv-deps') | Out-Null }
    if (-not $repoReady) { $problems.Add('repo') | Out-Null }
    if ($problems.Count -eq 0) { Write-Output 'LAB READY=yes' } else { Write-Output ("LAB READY=no problems=" + ($problems -join ',')) }
    exit 0
  }

  default { Fail $EXIT_USAGE ("unknown mode " + $cfg.mode) }
}
