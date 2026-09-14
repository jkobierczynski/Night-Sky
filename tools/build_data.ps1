# Converts HYG star catalog + DSO catalog into compact JS data files.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# ---------- STARS ----------
Add-Type -AssemblyName Microsoft.VisualBasic
$csv = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser("$root\data\hyg_raw.csv")
$csv.SetDelimiters(',')
$csv.HasFieldsEnclosedInQuotes = $true
$header = $csv.ReadFields()
$idx = @{}
for ($i = 0; $i -lt $header.Count; $i++) { $idx[$header[$i]] = $i }
$lines = $null

$nameCon = @{
  'Sirius'='CMa';'Canopus'='Car';'Rigil Kentaurus'='Cen';'Arcturus'='Boo';'Vega'='Lyr';'Capella'='Aur';
  'Rigel'='Ori';'Procyon'='CMi';'Achernar'='Eri';'Betelgeuse'='Ori';'Hadar'='Cen';'Altair'='Aql';
  'Acrux'='Cru';'Aldebaran'='Tau';'Antares'='Sco';'Spica'='Vir';'Pollux'='Gem';'Fomalhaut'='PsA';
  'Deneb'='Cyg';'Mimosa'='Cru';'Regulus'='Leo';'Adhara'='CMa';'Castor'='Gem';'Shaula'='Sco';
  'Gacrux'='Cru';'Bellatrix'='Ori';'Elnath'='Tau';'Miaplacidus'='Car';'Alnilam'='Ori';'Alnair'='Gru';
  'Alnitak'='Ori';'Alioth'='UMa';'Dubhe'='UMa';'Mirfak'='Per';'Wezen'='CMa';'Regor'='Vel';
  'Kaus Australis'='Sgr';'Alkaid'='UMa';'Sargas'='Sco';'Menkalinan'='Aur';'Atria'='TrA';'Alhena'='Gem';
  'Peacock'='Pav';'Alsephina'='Vel';'Mirzam'='CMa';'Alphard'='Hya';'Polaris'='UMi';'Hamal'='Ari';
  'Algieba'='Leo';'Diphda'='Cet';'Mizar'='UMa';'Nunki'='Sgr';'Menkent'='Cen';'Mirach'='And';
  'Alpheratz'='And';'Rasalhague'='Oph';'Kochab'='UMi';'Saiph'='Ori';'Denebola'='Leo';'Algol'='Per';
  'Tiaki'='Gru';'Muhlifain'='Cen';'Aspidiske'='Car';'Suhail'='Vel';'Alphecca'='CrB';'Mintaka'='Ori';
  'Sadr'='Cyg';'Eltanin'='Dra';'Schedar'='Cas';'Naos'='Pup';'Almach'='And';'Caph'='Cas';
  'Izar'='Boo';'Rasalgethi'='Her';'Zosma'='Leo';'Unukalhai'='Ser';'Cursa'='Eri';'Zubenelgenubi'='Lib';
  'Zubeneschamali'='Lib';'Vindemiatrix'='Vir';'Dschubba'='Sco';'Acrab'='Sco';'Girtab'='Sco';'Lesath'='Sco';
  'Larawag'='Sco';'Kaus Media'='Sgr';'Kaus Borealis'='Sgr';'Alcor'='UMa';'Epsilon Leonis'='Leo';
  'Talitha'='UMa';'Alcyone'='Tau';'Aludra'='CMa';'Markab'='Peg';'Scheat'='Peg';'Algenib'='Peg';
  'Enif'='Peg';'Homam'='Peg';'Matar'='Peg';'Baham'='Peg';'Sadalsuud'='Aqr';'Sadalmelik'='Aqr';
  'Skat'='Aqr';'Ancha'='Aqr';'Situla'='Aqr';'Gienah'='Cyg';'Aljanah'='Cyg';'Delta Cygni'='Cyg';
  'Zeta Cygni'='Cyg';'Albireo'='Cyg';'Eta Cygni'='Cyg';'Thuban'='Dra';'Edasich'='Dra';'Aldhibah'='Dra';
  'Altais'='Dra';'Grumium'='Dra';'Arrakis'='Dra';'Rastaban'='Dra';'Kuma'='Dra';'Giausar'='Dra';
  'Megrez'='UMa';'Phecda'='UMa';'Merak'='UMa';'Tania Australis'='UMa';'Tania Borealis'='UMa';
  'Alula Borealis'='UMa';'Alula Australis'='UMa';'Muscida'='UMa';'Talitha Australis'='UMa';
  'Alkaphrah'='UMa';'Tanvia'='UMa';'Meridia'='UMa';'Avior'='Car';
  'Theta Carinae'='Car';'Vatham'='Car';'Foramen'='Car';'Tureis'='Car';'Ukdah'='Car';'Achird'='Cas';
  'Ruchbah'='Cas';'Segin'='Cas';'Muphrid'='Boo';'Nekkar'='Boo';
  'Princeps'='Boo';'Alkalurops'='Boo';'Alya'='Ser';'Seras'='Ser';
  'Roha'='Ser';'Sualocin'='Del';'Deneb Dulfim'='Del';'Aldulfin'='Del';'Rotanev'='Del';
  'Kitalpha'='Equ';'Beemim'='Equ';'Cebalrai'='Oph';'Yed Prior'='Oph';'Yed Posterior'='Oph';
  'Sabik'='Oph';'Marfik'='Oph';'Imad'='Oph';'Guniibuu'='Oph';
  'Cujam'='Her';'Kajam'='Her';'Sarin'='Her';'Maasym'='Her';'Nusakan'='CrB';
  'Iklil'='CrB';'Merga'='CrB'
}
$nameCon.Remove('Ros alphanumeric') | Out-Null
$nameCon.Remove('Fulu') | Out-Null

$nameToIdx = @{}
$names = New-Object System.Collections.Generic.List[string]
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$count = 0
while (-not $csv.EndOfData) {
  $f = $csv.ReadFields()
  if ($f.Count -lt 36 -or $null -eq $f[$idx['rarad']] -or $null -eq $f[$idx['decrad']] -or $null -eq $f[$idx['mag']]) { continue }
  $magS = $f[$idx['mag']].Trim('"')
  if ($magS -eq '' -or $magS -eq 'NaN') { continue }
  $mag = 0.0; if (-not [double]::TryParse($magS, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$mag)) { continue }
  if ($mag -gt 9.0) { continue }
  $raS = $f[$idx['rarad']].Trim('"'); $decS = $f[$idx['decrad']].Trim('"')
  if ($raS -eq '' -or $decS -eq '' -or $raS -eq 'NaN' -or $decS -eq 'NaN') { continue }
  $ra = [double]$raS; $dec = [double]$decS
  $ciS = $f[$idx['ci']].Trim('"')
  $ci = 0.65
  if ($ciS -ne '' -and $ciS -ne 'NaN') { [void][double]::TryParse($ciS, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$ci) }
  $proper = $f[$idx['proper']].Trim('"')
  $con = $f[$idx['con']].Trim('"')
  $spect = $f[$idx['spect']].Trim('"')
  $distS = $f[$idx['dist']].Trim('"')
  $nameIdx = 65535
  if ($proper -ne '' -and $proper -ne 'Sol') {
    if (-not $nameToIdx.ContainsKey($proper)) {
      $c = ''; if ($nameCon.ContainsKey($proper)) { $c = $nameCon[$proper] }
      elseif ($con -ne '') { $c = $con }
      $ly = ''
      if ($distS -ne '' -and $distS -ne 'NaN') { $ly = '{0:N1}' -f ([double]$distS * 3.26156) }
      $names.Add("$proper|$c|$spect|$ly")
      $nameToIdx[$proper] = $names.Count - 1
    }
    $nameIdx = $nameToIdx[$proper]
  }
  $bw.Write([float]$ra)
  $bw.Write([float]$dec)
  $bw.Write([float]$mag)
  $bw.Write([float]$ci)
  $bw.Write([uint16]$nameIdx)
  $count++
}
$bw.Flush()
$b64 = [Convert]::ToBase64String($ms.ToArray())
$bw.Close(); $ms.Close()

$nameArr = ($names | ForEach-Object { '"' + ($_ -replace '"','') + '"' }) -join ','
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('window.STAR_DATA = {')
[void]$sb.AppendLine("count: $count,")
[void]$sb.AppendLine("b64: `"$b64`",")
[void]$sb.AppendLine("names: [$nameArr]")
[void]$sb.AppendLine('};')
[System.IO.File]::WriteAllText("$root\data\stars_data.js", $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
"stars: $count, named: $($names.Count)"

# ---------- DSOs ----------
$skip = @('?','*','**','***','PD','MWSC')
$rows = Import-Csv "$root\data\dso_raw.csv"
$out = New-Object System.Collections.Generic.List[string]
$seen = @{}
$mapType = @{ 'Gxy'='Galaxy'; 'OC'='Open cluster'; 'GC'='Globular cluster'; 'PN'='Planetary nebula';
  'Neb'='Nebula'; 'OC+Neb'='Cluster + nebula'; 'Ast'='Asterism'; 'GxyCld'='Galaxy cloud';
  'HIIRgn'='H II region'; 'SNR'='Supernova remnant'; 'DN'='Dark nebula'; 'NF'='Nebula'; ''='Object' }
foreach ($d in $rows) {
  if ($skip -contains $d.type) { continue }
  $magOk = $d.mag -ne '' -and $d.mag -ne 'NaN'
  $isGxy = $d.type -eq 'Gxy'
  $named = $d.name -ne ''
  if ($magOk) {
    $m = [double]$d.mag
    $lim = 9.5; if (-not $isGxy) { $lim = 9.0 }
    if ($m -gt $lim) { continue }
  } elseif ($named) { }
  else { continue }
  $desig = ''
  if ($d.cat1 -eq 'M') { $desig = 'M' + $d.id1 }
  elseif ($d.cat1 -ne '' -and $d.cat1 -ne 'M') { $desig = $d.cat1 + $d.id1 }
  elseif ($d.cat1 -eq 'M' -and $d.id1 -ne '') { $desig = 'M' + $d.id1 }
  if ($desig -eq '' -and $d.cat2 -eq 'M' -and $d.id2 -ne '') { $desig = 'M' + $d.id2 }
  elseif ($desig -eq '' -and $d.cat2 -ne '') { $desig = $d.cat2 + $d.id2 }
  if ($desig -eq '') { $desig = $d.name }
  if ($desig -eq '') { continue }
  # dedupe
  $k1 = $desig; $k2 = if ($named) { $d.name + '|' + $d.con } else { '' }
  if ($seen.ContainsKey($k1) -or ($k2 -ne '' -and $seen.ContainsKey($k2))) { continue }
  $seen[$k1] = 1; if ($k2 -ne '') { $seen[$k2] = 1 }
  $ra = 0.0; [void][double]::TryParse($d.rarad, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$ra)
  if ($ra -eq 0.0) { [void][double]::TryParse($d.ra, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$ra); $ra = $ra * 15.0 * [Math]::PI / 180.0 }
  $dec = 0.0; [void][double]::TryParse($d.decrad, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$dec)
  if ($dec -eq 0.0) { [void][double]::TryParse($d.dec, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$dec); $dec = $dec * [Math]::PI / 180.0 }
  $mag = 99; if ($magOk) { $mag = [double]$d.mag }
  $sz = 1.0
  $r1 = 0.0; [void][double]::TryParse($d.r1, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$r1)
  $r2 = 0.0; [void][double]::TryParse($d.r2, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$r2)
  $sz = [Math]::Max($r1, $r2); if ($sz -lt 1.0) { $sz = 1.0 }; if ($sz -gt 720.0) { $sz = 720.0 }
  $t = $mapType[$d.type]; if (-not $t) { $t = 'Object' }
  $nm = ($desig -replace '"','')
  if ($named -and $d.name -ne $desig) { $nm = "$nm ($($d.name -replace '"',''))" }
  $out.Add("[" + ('{0:f5},{1:f5},{2:f1},{3:f3}' -f $ra, $dec, $mag, ($sz/60.0)) + ",`"$nm`",`"$($d.con)`",`"$t`"]")
}
$dsb = New-Object System.Text.StringBuilder
[void]$dsb.AppendLine('window.DSO_DATA = [')
[void]$dsb.AppendLine(($out -join ",`n"))
[void]$dsb.AppendLine('];')
[System.IO.File]::WriteAllText("$root\data\dso_data.js", $dsb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
"dso: $($out.Count)"
