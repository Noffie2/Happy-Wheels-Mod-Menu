param([string]$GameDir = "")
$ErrorActionPreference = "Stop"

$Version = "1.0"
$PatchOffset = [Int64]245002095
$OriginalHeaderHash = "d51cded8579e882063f1edc8b4169bf1d449d075b32a5760be274fd987d1cfb1"
$V04HeaderHash = "47cc89be844d5936ea4c06a9876d3e23b0cf9817a3734967c8b1a5705010b571"
$V05HeaderHash = "bcaeb50767e54998f317ce267fb44bc6e65e391a5d2a3f7d1ad95ee7216f201e"
$V07HeaderHash = "d8281838e4905252d89be75bb28f564e36209a2ec6e01b089c9e76f60c64d550"
$V08HeaderHash = "a005a9eecf6aa616d9e9ba395209f192c2d47b489390444956ab8b6f9beba8c3"
$V10OlderHeaderHash = "61c184a9e3a3ef5b6fc66f32e2b8c4194c0eb64f926eb93971a35aa660ac8f06"
$V10PreviousHeaderHash = "8487d476702798ad1877ce610e9b07cfc7f7ba48652f4fa7b339b8e16d9abbe2"
$V10NewestPreviousHeaderHash = "a6319c7f337b09ec019923786d03fcea17f8ec2075ceb4ad03351cb40d7951bf"
$NewHeaderHash = "e0f821c83965fa4e8b5d8b02b10cb50ceea9e393ef076ce019d16cafcb896447"
$OriginalAsarSha256 = "6acaa11e926f966e0bc73f678bdf1038e9ee3a4f62a8d178856712db2f6c4da8"
$V04AsarSha256 = "c320e8ce853e695086e314c950c04712a7c3f29e5564d25604ae28289bdc1c76"
$V05AsarSha256 = "e9a2b1c67d944bc4ab05818de998dc17e005c0b97994d9f4251bf7ce2abe4512"
$V07AsarSha256 = "9fa2204b5faecd6109d1d7f373116dc371febac924149bfd8d55f6cb27277f64"
$V08AsarSha256 = "f0324ec62c9119d584779d31848965591d1b33170f4dcc0c3ab317093ec16046"
$V10OlderAsarSha256 = "0969efdd763790747722bf00ab25e53a58ca150170265d05d190d9d27f8f3451"
$V10PreviousAsarSha256 = "7b16296d3b9820e5b40121390a09ac2884921804121ef967a5ed0abc6a137ab8"
$V10NewestPreviousAsarSha256 = "04f0dd69d466a9a4115bd1314b3929d73f037ac3effb14d14f8aaa1503cdddb0"
$PatchedAsarSha256 = "c00470ca0381e136de9fa0ddc785ba55e1f456d1aef8eefecd79be99c3a5727a"
$OriginalExeSha256 = "aa5079850eff5a3d08cae28e329be34dce664fb016e5469b19db4c95812b4477"
$V04ExeSha256 = "86690ed52a306253307b05140c77f1c1ec83ef2f7e32f3511a7cee01280aa67b"
$V05ExeSha256 = "fd58f154b832ff2fe396925e01cbdb7268ea86489843126660dd8c5bde1a5a72"
$V07ExeSha256 = "e3244a795404265e0ae260536fa847476b2f5ed1e37f4b50a1631707eef22a12"
$V08ExeSha256 = "934624fb8fea65f73840a5da3644cad3f345b702ba943223795ba6e018aa1ca1"
$V10OlderExeSha256 = "162ee51a6174b19e999ff54ef346980ca68391b0adbf48f7e80fd51fca03affc"
$V10PreviousExeSha256 = "fe1e1f9aedfd3bc5e36fae4c24380434b3ab7fdef1c5b00bb008316b2b373d74"
$V10NewestPreviousExeSha256 = "4e68c783c95654b5763e0f7e2e08fc35480778891b26bf1b0eacdfd0bca12cea"
$PatchedExeSha256 = "800227b413a46d52c67ed8322ac6545adbd175ddb720e97b447085240de9e3df"

function Hash([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Step([int]$N,[string]$Text) { Write-Host ("[STEP {0}/9] {1}" -f $N,$Text) -ForegroundColor Cyan }
function Add-Candidate([System.Collections.Generic.List[string]]$List,[string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    try { $full=[IO.Path]::GetFullPath($Path) } catch { return }
    if (-not $List.Contains($full)) { $List.Add($full) }
}
function Find-GameDirectory([string]$Explicit) {
    $c=[System.Collections.Generic.List[string]]::new(); Add-Candidate $c $Explicit
    $p=$PSScriptRoot
    for($i=0;$i -lt 5 -and $p;$i++){ Add-Candidate $c $p; $parent=Split-Path -Parent $p; if($parent -eq $p){break}; $p=$parent }
    try {
        $steam=(Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
        if($steam){
            Add-Candidate $c (Join-Path $steam 'steamapps\common\Happy Wheels')
            $vdf=Join-Path $steam 'steamapps\libraryfolders.vdf'
            if(Test-Path -LiteralPath $vdf){
                $txt=Get-Content -LiteralPath $vdf -Raw
                foreach($m in [regex]::Matches($txt,'"path"\s+"([^"]+)"')){ $lib=$m.Groups[1].Value -replace '\\\\','\'; Add-Candidate $c (Join-Path $lib 'steamapps\common\Happy Wheels') }
            }
        }
    } catch {}
    Add-Candidate $c 'E:\Games\.Steam\steamapps\common\Happy Wheels'
    foreach($d in $c){
        if((Test-Path -LiteralPath (Join-Path $d 'Happy Wheels.exe')) -and (Test-Path -LiteralPath (Join-Path $d 'resources\app.asar')) -and (Test-Path -LiteralPath (Join-Path $d 'resources\webroot\js\index.js'))){ return $d }
    }
    throw 'Could not find Happy Wheels.exe, resources\app.asar, and resources\webroot\js\index.js.'
}
function Read-AsciiAt([string]$Path,[Int64]$Offset,[int]$Count){
    $fs=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    try{ [void]$fs.Seek($Offset,[IO.SeekOrigin]::Begin); $b=New-Object byte[] $Count; $r=$fs.Read($b,0,$Count); if($r -ne $Count){throw 'Short read at patch offset.'}; return [Text.Encoding]::ASCII.GetString($b) } finally { $fs.Dispose() }
}
function Write-AsciiAt([string]$Path,[Int64]$Offset,[string]$Text){
    $b=[Text.Encoding]::ASCII.GetBytes($Text); $fs=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try{ [void]$fs.Seek($Offset,[IO.SeekOrigin]::Begin); $fs.Write($b,0,$b.Length); $fs.Flush($true) } finally { $fs.Dispose() }
}

Write-Host ""; Write-Host "Happy Wheels Mod Menu v$Version installer" -ForegroundColor Green
Write-Host "Version 1.0: character switcher removed; all other working mod features retained. Version number remains 1.0."; Write-Host ""

Step 1 'Locating game and validating payload'
$GameDir=Find-GameDirectory $GameDir
$Exe=Join-Path $GameDir 'Happy Wheels.exe'
$Asar=Join-Path $GameDir 'resources\app.asar'
$Index=Join-Path $GameDir 'resources\webroot\js\index.js'
$PayloadAsar=Join-Path $PSScriptRoot 'payload\app.asar'
$BackupDir=Join-Path $GameDir 'hwmod_backup'
$BackupExe=Join-Path $BackupDir 'Happy Wheels.exe.original'
$BackupAsar=Join-Path $BackupDir 'app.asar.original'
$BackupIndex=Join-Path $BackupDir 'index.js.original'
if(-not(Test-Path -LiteralPath $PayloadAsar)){throw 'Missing payload\app.asar.'}
if((Hash $PayloadAsar) -ne $PatchedAsarSha256){throw 'Payload integrity check failed.'}
Write-Host "  Game: $GameDir"

Step 2 'Checking EXE and app.asar build'
$exeHash=Hash $Exe; $asarHash=Hash $Asar
Write-Host "  EXE : $exeHash"; Write-Host "  ASAR: $asarHash"
$knownExe=@($OriginalExeSha256,$V04ExeSha256,$V05ExeSha256,$V07ExeSha256,$V08ExeSha256,$V10OlderExeSha256,$V10PreviousExeSha256,$V10NewestPreviousExeSha256,$PatchedExeSha256) -contains $exeHash
$knownAsar=@($OriginalAsarSha256,$V04AsarSha256,$V05AsarSha256,$V07AsarSha256,$V08AsarSha256,$V10OlderAsarSha256,$V10PreviousAsarSha256,$V10NewestPreviousAsarSha256,$PatchedAsarSha256) -contains $asarHash
if(-not $knownExe -or -not $knownAsar){throw 'Unexpected EXE/app.asar version. Nothing was changed.'}

Step 3 'Checking exact gameplay bundle and v0.7 payload'
$PayloadIndex=Join-Path $PSScriptRoot 'payload\index.js'
$OriginalIndexSha256='da29ebb7182f4fe3180dff93cb1e7257085557c11598cc17165bd39370518dd7'
$V07IndexSha256='772b61b2ba7845ef23b27c7d5057b41da177afa0b1396ac410c15b3113b0e928'
$V08IndexSha256='51345defa9abb3c887d84d15fd9181267e89f6a687587ed0d0f98d9be7e138e6'
$V10OlderIndexSha256='ad266e3654d2436db9e2e28d3c3ac85b08cbed21e0f98db66620b08ec604ffb8'
$V10PreviousIndexSha256='2480d1d89951a9e5ca27437fd369d0b945496c888e1569a01ab7b5125ca8683c'
$PatchedIndexSha256='27f3127836968aacbd2eb802473d0673a9001e0d7087937733f0768dc18ed2d1'
if(-not(Test-Path -LiteralPath $PayloadIndex)){throw 'Missing payload\index.js.'}
if((Hash $PayloadIndex) -ne $PatchedIndexSha256){throw 'Decoded gameplay payload integrity check failed.'}
$indexHash=Hash $Index
$alreadyHooked=($indexHash -eq $PatchedIndexSha256)
$upgradeV10Previous=($indexHash -eq $V10PreviousIndexSha256)
$upgradeV10Older=($indexHash -eq $V10OlderIndexSha256)
$upgradeV08=($indexHash -eq $V08IndexSha256)
$upgradeV07=($indexHash -eq $V07IndexSha256)
if(-not $alreadyHooked -and -not $upgradeV10Previous -and -not $upgradeV10Older -and -not $upgradeV08 -and -not $upgradeV07 -and $indexHash -ne $OriginalIndexSha256){throw "Unexpected resources\webroot\js\index.js hash: $indexHash. Nothing was changed."}
Write-Host "  Installed index.js: $indexHash"
Write-Host '  Exact obfuscated build recognized.' -ForegroundColor Green

Step 4 'Creating/reusing clean backups'
[IO.Directory]::CreateDirectory($BackupDir)|Out-Null
if(-not(Test-Path -LiteralPath $BackupExe)){
    if($exeHash -ne $OriginalExeSha256){throw 'EXE is already modified and no clean EXE backup exists.'}
    Write-Host '  Copying EXE backup...'; [IO.File]::Copy($Exe,$BackupExe,$false)
} else { Write-Host '  Existing clean EXE backup found.' }
if(-not(Test-Path -LiteralPath $BackupAsar)){
    if($asarHash -ne $OriginalAsarSha256){throw 'app.asar is already modified and no clean ASAR backup exists.'}
    [IO.File]::Copy($Asar,$BackupAsar,$false)
} else { Write-Host '  Existing clean ASAR backup found.' }
if(-not(Test-Path -LiteralPath $BackupIndex)){
    if($alreadyHooked -or $upgradeV10Previous -or $upgradeV10Older -or $upgradeV08 -or $upgradeV07){throw 'index.js is already modified and no clean index.js backup exists.'}
    [IO.File]::Copy($Index,$BackupIndex,$false)
} else { Write-Host '  Existing clean index.js backup found.' }

try {
    Step 5 'Patching Electron ASAR integrity value'
    $current=Read-AsciiAt $Exe $PatchOffset 64
    if(@($OriginalHeaderHash,$V04HeaderHash,$V05HeaderHash,$V07HeaderHash,$V08HeaderHash,$V10OlderHeaderHash,$V10PreviousHeaderHash,$V10NewestPreviousHeaderHash) -contains $current){ Write-AsciiAt $Exe $PatchOffset $NewHeaderHash }
    elseif($current -ne $NewHeaderHash){ throw 'Unexpected integrity value at verified EXE offset.' }
    if((Read-AsciiAt $Exe $PatchOffset 64) -ne $NewHeaderHash){throw 'EXE patch verification failed.'}

    Step 6 'Installing Happy Wheels Mod Menu v1.0'
    [IO.File]::Copy($PayloadAsar,$Asar,$true)
    if((Hash $Asar) -ne $PatchedAsarSha256){throw 'ASAR verification failed after copy.'}

    Step 7 'Installing restart-aware gameplay lifecycle hook'
    if(-not $alreadyHooked){
        [IO.File]::Copy($PayloadIndex,$Index,$true)
        Write-Host '  Installed generation-aware session/character capture.' -ForegroundColor Green
    } else { Write-Host '  v1.0 gameplay hook already installed.' -ForegroundColor Green }
    if((Hash $Index) -ne $PatchedIndexSha256){throw 'Gameplay bundle verification failed after copy.'}

    Step 8 'Verifying direct hook and final binary hashes'
    if((Hash $Index) -ne $PatchedIndexSha256){throw 'Direct session hook verification failed.'}
    $finalExe=Hash $Exe; $finalAsar=Hash $Asar
    if($finalExe -ne $PatchedExeSha256){throw "Final EXE hash verification failed: $finalExe"}
    if($finalAsar -ne $PatchedAsarSha256){throw "Final ASAR hash verification failed: $finalAsar"}

    Step 9 'Installation complete'
    Write-Host '  Exact session + character capture is installed.' -ForegroundColor Green
} catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Restoring clean backups...' -ForegroundColor Yellow
    if(Test-Path -LiteralPath $BackupExe){[IO.File]::Copy($BackupExe,$Exe,$true)}
    if(Test-Path -LiteralPath $BackupAsar){[IO.File]::Copy($BackupAsar,$Asar,$true)}
    if(Test-Path -LiteralPath $BackupIndex){[IO.File]::Copy($BackupIndex,$Index,$true)}
    throw
}

Write-Host ""; Write-Host 'INSTALL COMPLETE' -ForegroundColor Green
Write-Host 'Launch Happy Wheels normally through Steam, then START OR RESTART a level.'
Write-Host 'The menu should change to DIRECT HOOK once the level session is constructed.'
Write-Host 'INSERT toggles the menu.'; Write-Host "Backups: $BackupDir"; Write-Host ""
