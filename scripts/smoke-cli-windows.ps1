param([string]$Unpacked = 'build-output/electron/win-unpacked')

$ErrorActionPreference = 'Stop'
$cliRoot = (Resolve-Path -LiteralPath 'build-output/cli').Path
$launcher = Join-Path $cliRoot 'mardikor.exe'
$changePath = [Reflection.Assembly]::LoadFile($launcher).GetType('Launcher').GetMethod(
  'ChangePath', [Reflection.BindingFlags]'NonPublic,Static')
$testKey = 'Software\MardikorCliSmoke-' + [guid]::NewGuid()
$registry = [Microsoft.Win32.Registry]::CurrentUser
$environment = $registry.CreateSubKey($testKey + '\Environment')
$state = $registry.CreateSubKey($testKey + '\State')
$raw = [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
$expanded = [Microsoft.Win32.RegistryValueKind]::ExpandString
$original = '%SystemRoot%\System32;' + ('C:\Existing\' + ('LongPath;' * 200)) + 'C:\Another'
$bin = 'C:\Program Files\Mardikor\bin'
$moved = 'D:\Apps & tools\Mardikor\bin'
try {
  $environment.SetValue('Path', $original, $expanded)
  $null = $changePath.Invoke($null, @($environment, $state, $bin, $true))
  $null = $changePath.Invoke($null, @($environment, $state, $bin, $true))
  if ($environment.GetValue('Path', $null, $raw) -cne "$original;$bin") { throw 'PATH was truncated or duplicated' }
  if ($environment.GetValueKind('Path') -ne $expanded) { throw 'PATH registry value type changed' }
  $null = $changePath.Invoke($null, @($environment, $state, $moved, $true))
  if ($environment.GetValue('Path', $null, $raw) -cne "$original;$moved") { throw 'Old installation entry was not replaced' }
  $null = $changePath.Invoke($null, @($environment, $state, $moved, $false))
  if ($environment.GetValue('Path', $null, $raw) -cne $original) { throw 'Uninstall did not restore PATH entries' }
  $preexisting = "$original;`"$bin\`""
  $environment.SetValue('Path', $preexisting, $expanded)
  $null = $changePath.Invoke($null, @($environment, $state, $bin, $true))
  $null = $changePath.Invoke($null, @($environment, $state, $bin, $false))
  if ($environment.GetValue('Path', $null, $raw) -cne $preexisting) { throw 'Uninstall removed a preexisting entry' }
} finally {
  $environment.Dispose()
  $state.Dispose()
  $registry.DeleteSubKeyTree($testKey)
}

$app = (Resolve-Path -LiteralPath $Unpacked).Path
$destination = Join-Path $app 'bin'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath $launcher,(Join-Path $cliRoot 'package/bin/mardikor.cjs') -Destination $destination
$env:MARDIKOR_CLI_TEST_EXE = Join-Path $destination 'mardikor.exe'
try {
@'
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
fs.mkdirSync(".test-artifacts", { recursive: true });
const root = fs.mkdtempSync(path.resolve(".test-artifacts/installed-cli-"));
const file = path.join(root, "中文 & 空格.mdk");
const cli = process.env.MARDIKOR_CLI_TEST_EXE;
const run = (args, input) => {
  const result = spawnSync(cli, args, { input, encoding: "utf8", timeout: 15000 });
  assert.ifError(result.error);
  return result;
};
const created = run(["new", file]);
assert.equal(created.status, 0, created.stderr);
const { revision, entries } = JSON.parse(created.stdout);
const id = entries[0].id;
const markdown = "# 标题\r\n\r\n从标准输入写入。\r\n";
const write = run(["write", file, id, "--if-revision", revision], markdown);
assert.equal(write.status, 0, write.stderr);
assert.equal(run(["read", file, id]).stdout, markdown);
const conflict = run(["write", file, id, "--if-revision", revision, "--json"], "冲突");
assert.equal(conflict.status, 3);
assert.equal(JSON.parse(conflict.stderr).code, "E_MDK_REVISION");
console.log("Windows launcher inherited stdin, stdout, stderr and the CLI exit code.");
'@ | node --input-type=module -
  if ($LASTEXITCODE -ne 0) { throw 'Windows CLI launcher smoke test failed.' }
} finally {
  Remove-Item -LiteralPath (Join-Path $destination 'mardikor.exe'),(Join-Path $destination 'mardikor.cjs')
  Remove-Item -LiteralPath Env:MARDIKOR_CLI_TEST_EXE
}
