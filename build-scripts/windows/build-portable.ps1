$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Push-Location -LiteralPath $ProjectRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    & npm.cmd exec -- electron-builder --win portable
    if ($LASTEXITCODE -ne 0) { throw 'Portable packaging failed.' }
    Write-Host 'Portable package: build-output\electron\Mardikor*.exe'
} finally {
    Pop-Location
}
