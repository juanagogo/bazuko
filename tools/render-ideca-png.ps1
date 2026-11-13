Add-Type -AssemblyName System.Drawing

$jsonPath = "c:\Program Files\PROYECTOS DE PROGRAMACION\BAZURTO\bazuko\src\data\bogota-real\ideca-cartografia-oficial.json"
$outArtifactPng = "C:\Users\USER\.gemini\antigravity\brain\764ab65a-77d6-4ecb-864c-c24152f3aefa\mapa_oficial_ideca_bogota_supervision.png"
$outPublicPng = "c:\Program Files\PROYECTOS DE PROGRAMACION\BAZURTO\bazuko\public\metro-assets\mapa_oficial_ideca_bogota.png"

$data = Get-Content -Raw -Encoding UTF8 $jsonPath | ConvertFrom-Json

$W = 2400
$H = 1650
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

function Get-Color([string]$hex, [int]$alpha = 255) {
    $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
    return [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}

function Get-FloorColor([int]$floors) {
    if ($floors -ge 25) { return Get-Color "#D9232A" 242 }
    if ($floors -ge 12) { return Get-Color "#F2A900" 240 }
    if ($floors -ge 6)  { return Get-Color "#5C3A21" 238 }
    if ($floors -ge 3)  { return Get-Color "#8B5A2B" 235 }
    return Get-Color "#A67B5B" 230
}

# Colors & Pens
$bgDarkBrush = New-Object System.Drawing.SolidBrush (Get-Color "#1E1914")
$cartonBrush = New-Object System.Drawing.SolidBrush (Get-Color "#CBA26C")
$cartonInnerBrush = New-Object System.Drawing.SolidBrush (Get-Color "#C1955E")
$sectorBgBrush = New-Object System.Drawing.SolidBrush (Get-Color "#BA8D56")
$manzanaBrush = New-Object System.Drawing.SolidBrush (Get-Color "#D8B584" 235)
$cintaBrush = New-Object System.Drawing.SolidBrush (Get-Color "#E9DBB4")
$darkTextBrush = New-Object System.Drawing.SolidBrush (Get-Color "#14110C")
$subTextBrush = New-Object System.Drawing.SolidBrush (Get-Color "#4A3520")
$redTextBrush = New-Object System.Drawing.SolidBrush (Get-Color "#AB1D17")
$goldTextBrush = New-Object System.Drawing.SolidBrush (Get-Color "#F2A900")
$cerrosBrush = New-Object System.Drawing.SolidBrush (Get-Color "#3E5434" 135)

$borderPenThick = New-Object System.Drawing.Pen (Get-Color "#14110C"), 4.5
$borderPenMed = New-Object System.Drawing.Pen (Get-Color "#14110C"), 2.5
$manzanaPen = New-Object System.Drawing.Pen (Get-Color "#14110C" 215), 1.8
$bldgPen = New-Object System.Drawing.Pen (Get-Color "#14110C" 230), 0.9
$bldgHighPen = New-Object System.Drawing.Pen (Get-Color "#14110C" 255), 1.8
$gridPen = New-Object System.Drawing.Pen (Get-Color "#14110C" 28), 1.0
$streetPen = New-Object System.Drawing.Pen (Get-Color "#3B322C" 185), 2.2
$arterialPen = New-Object System.Drawing.Pen (Get-Color "#1A1613" 215), 4.6

# Fonts
$fontHeader = New-Object System.Drawing.Font("Impact", 27, [System.Drawing.FontStyle]::Regular)
$fontSubHeader = New-Object System.Drawing.Font("Consolas", 12, [System.Drawing.FontStyle]::Bold)
$fontSecTitle = New-Object System.Drawing.Font("Impact", 14.5, [System.Drawing.FontStyle]::Regular)
$fontSecSub = New-Object System.Drawing.Font("Consolas", 9.5, [System.Drawing.FontStyle]::Bold)
$fontTape = New-Object System.Drawing.Font("Impact", 12.5, [System.Drawing.FontStyle]::Regular)
$fontLegendTitle = New-Object System.Drawing.Font("Impact", 14, [System.Drawing.FontStyle]::Regular)
$fontLegend = New-Object System.Drawing.Font("Consolas", 9.8, [System.Drawing.FontStyle]::Bold)
$fontMetro = New-Object System.Drawing.Font("Arial", 8.5, [System.Drawing.FontStyle]::Bold)

# Background
$g.FillRectangle($bgDarkBrush, 0, 0, $W, $H)

# Top Header Banner
$g.FillRectangle($cintaBrush, 30, 24, $W - 60, 96)
$g.DrawRectangle($borderPenThick, 30, 24, $W - 60, 96)
$g.FillRectangle((New-Object System.Drawing.SolidBrush (Get-Color "#D9232A")), 44, 36, 14, 72)
$g.FillRectangle((New-Object System.Drawing.SolidBrush (Get-Color "#F2A900")), 64, 36, 8, 72)
$g.DrawString("PLANO DE SUPERVISION - REPLICA EXACTA CARTOGRAFIA OFICIAL IDECA BOGOTA (BAZUKO)", $fontHeader, $darkTextBrush, 86, 34)
$g.DrawString("FUENTE OFICIAL: Unidad Administrativa Especial de Catastro Distrital (IDECA ArcGIS REST MapServer EPSG:4326) | 121 Manzanas | 1,000 Construcciones | 390 Vias", $fontSubHeader, $subTextBrush, 88, 84)

# Helper: Draw a single IDECA Sector Box
function Draw-SectorBox($secObj, [float]$bx, [float]$by, [float]$bw, [float]$bh, [string]$code, [string]$title, [string]$subtitle) {
    $g.FillRectangle($cartonBrush, $bx, $by, $bw, $bh)
    $g.DrawRectangle($borderPenThick, $bx, $by, $bw, $bh)
    $g.FillRectangle($sectorBgBrush, $bx + 8, $by + 8, $bw - 16, $bh - 16)
    $g.DrawRectangle($borderPenMed, $bx + 8, $by + 8, $bw - 16, $bh - 16)

    $state = $g.Save()
    $g.SetClip((New-Object System.Drawing.RectangleF(($bx + 10), ($by + 10), ($bw - 20), ($bh - 20))))

    $halfExtent = 215.0
    $scale = [Math]::Min($bw, $bh) / ($halfExtent * 2.0)
    $cx = $bx + $bw / 2.0
    $cy = $by + $bh / 2.0

    # Grid every 50m
    for ($m = -250; $m -le 250; $m += 50) {
        $gx = [float]($cx + $m * $scale)
        $gy = [float]($cy + $m * $scale)
        $g.DrawLine($gridPen, $gx, $by, $gx, ($by + $bh))
        $g.DrawLine($gridPen, $bx, $gy, ($bx + $bw), $gy)
    }

    # 1. Manzanas Catastrales (Layer 40)
    foreach ($blk in $secObj.blocks) {
        if ($blk.footprint.Count -lt 3) { continue }
        $pts = New-Object System.Drawing.PointF[] $blk.footprint.Count
        for ($i = 0; $i -lt $blk.footprint.Count; $i++) {
            $pt = $blk.footprint[$i]
            $pts[$i] = New-Object System.Drawing.PointF([float]($cx + [double]$pt[0] * $scale), [float]($cy + [double]$pt[1] * $scale))
        }
        $g.FillPolygon($manzanaBrush, $pts)
        $g.DrawPolygon($manzanaPen, $pts)
    }

    # 2. Malla Vial Oficial (Layer 13)
    foreach ($st in $secObj.streets) {
        if ($st.path.Count -lt 2) { continue }
        $pts = New-Object System.Drawing.PointF[] $st.path.Count
        for ($i = 0; $i -lt $st.path.Count; $i++) {
            $pt = $st.path[$i]
            $pts[$i] = New-Object System.Drawing.PointF([float]($cx + [double]$pt[0] * $scale), [float]($cy + [double]$pt[1] * $scale))
        }
        $lbl = "$($st.label) $($st.name)"
        if ($lbl -match "AK|AC|CARACAS|CARRERA 7|CARRERA 10|CALLE 26|CALLE 19|CALLE 13") {
            $g.DrawLines($arterialPen, $pts)
        } else {
            $g.DrawLines($streetPen, $pts)
        }
    }

    # 3. Construcciones Oficiales (Layer 39) con altura CONNPISOS
    foreach ($b in $secObj.buildings) {
        if ($b.footprint.Count -lt 3) { continue }
        $pts = New-Object System.Drawing.PointF[] $b.footprint.Count
        for ($i = 0; $i -lt $b.footprint.Count; $i++) {
            $pt = $b.footprint[$i]
            $pts[$i] = New-Object System.Drawing.PointF([float]($cx + [double]$pt[0] * $scale), [float]($cy + [double]$pt[1] * $scale))
        }
        $floors = [int]$b.levels
        $bBrush = New-Object System.Drawing.SolidBrush (Get-FloorColor $floors)
        $g.FillPolygon($bBrush, $pts)
        if ($floors -ge 12) {
            $g.DrawPolygon($bldgHighPen, $pts)
        } else {
            $g.DrawPolygon($bldgPen, $pts)
        }
        $bBrush.Dispose()
    }

    # Crosshair
    $crossPen = New-Object System.Drawing.Pen (Get-Color "#AB1D17"), 2.0
    $g.DrawEllipse($crossPen, [float]($cx - 6), [float]($cy - 6), 12.0, 12.0)
    $g.Restore($state)

    # Masking Tape Label
    $tapeW = [Math]::Min($bw - 24, 535)
    $g.FillRectangle($cintaBrush, $bx + 12, $by + 12, $tapeW, 54)
    $g.DrawRectangle($borderPenMed, $bx + 12, $by + 12, $tapeW, 54)
    $g.DrawString("$code - $title", $fontSecTitle, $darkTextBrush, ($bx + 20), ($by + 16))
    $g.DrawString("$subtitle | $($secObj.blocks.Count) Manzanas | $($secObj.buildings.Count) Predios", $fontSecSub, $subTextBrush, ($bx + 20), ($by + 42))
}

# Render Left Panel: Unified Bogotá Game Map with Official IDECA Geometry
$ux = 30.0; $uy = 140.0; $uw = 1140.0; $uh = 1480.0
$g.FillRectangle($cartonBrush, $ux, $uy, $uw, $uh)
$g.DrawRectangle($borderPenThick, $ux, $uy, $uw, $uh)
$g.FillRectangle($cartonInnerBrush, $ux + 10, $uy + 10, $uw - 20, $uh - 20)
$g.DrawRectangle($borderPenMed, $ux + 10, $uy + 10, $uw - 20, $uh - 20)

$uState = $g.Save()
$g.SetClip((New-Object System.Drawing.RectangleF(($ux + 12), ($uy + 12), ($uw - 24), ($uh - 24))))

# Grid on unified map
for ($gx = $ux + 60; $gx -lt ($ux + $uw - 120); $gx += 60) {
    $g.DrawLine($gridPen, [float]$gx, [float]$uy, [float]$gx, [float]($uy + $uh))
}
for ($gy = $uy + 60; $gy -lt ($uy + $uh); $gy += 60) {
    $g.DrawLine($gridPen, [float]$ux, [float]$gy, [float]($ux + $uw), [float]$gy)
}

# Cerros Orientales polygon on right edge of Unified Map
$cerrosPts = @(
    (New-Object System.Drawing.PointF([float]($ux + $uw - 165), [float]$uy)),
    (New-Object System.Drawing.PointF([float]($ux + $uw), [float]$uy)),
    (New-Object System.Drawing.PointF([float]($ux + $uw), [float]($uy + $uh))),
    (New-Object System.Drawing.PointF([float]($ux + $uw - 140), [float]($uy + $uh))),
    (New-Object System.Drawing.PointF([float]($ux + $uw - 190), [float]($uy + $uh * 0.68))),
    (New-Object System.Drawing.PointF([float]($ux + $uw - 155), [float]($uy + $uh * 0.36)))
)
$g.FillPolygon($cerrosBrush, $cerrosPts)

$placements = @(
    @{ key = "parque93"; cx = ($ux + 430); cy = ($uy + 235); scale = 0.52; label = "PARQUE DE LA 93 (CHICO NORTE)" },
    @{ key = "zonaT"; cx = ($ux + 480); cy = ($uy + 515); scale = 0.56; label = "ZONA T / CALLE 82 (ZONA ROSA)" },
    @{ key = "zonaG"; cx = ($ux + 790); cy = ($uy + 545); scale = 0.56; label = "ZONA G / ROSALES (MANSION REYES)" },
    @{ key = "centroInternacional"; cx = ($ux + 660); cy = ($uy + 890); scale = 0.62; label = "CENTRO INTERNACIONAL - TORRE COLPATRIA" },
    @{ key = "sanVictorinoCartucho"; cx = ($ux + 380); cy = ($uy + 1155); scale = 0.68; label = "SAN VICTORINO - EL CARTUCHO - AV. CARACAS" }
)

$haloBrush = New-Object System.Drawing.SolidBrush (Get-Color "#B3834C" 90)
$haloPen = New-Object System.Drawing.Pen (Get-Color "#14110C" 160), 1.8
$haloPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash

foreach ($p in $placements) {
    $sec = $data.sectors.($p.key)
    $pcx = [float]$p.cx
    $pcy = [float]$p.cy
    $pscale = [float]$p.scale
    $rad = [float](210.0 * $pscale)
    $g.FillEllipse($haloBrush, ($pcx - $rad), ($pcy - $rad), ($rad * 2), ($rad * 2))
    $g.DrawEllipse($haloPen, ($pcx - $rad), ($pcy - $rad), ($rad * 2), ($rad * 2))

    foreach ($blk in $sec.blocks) {
        if ($blk.footprint.Count -lt 3) { continue }
        $pts = New-Object System.Drawing.PointF[] $blk.footprint.Count
        for ($i = 0; $i -lt $blk.footprint.Count; $i++) {
            $pt = $blk.footprint[$i]
            $pts[$i] = New-Object System.Drawing.PointF([float]($pcx + [double]$pt[0] * $pscale), [float]($pcy + [double]$pt[1] * $pscale))
        }
        $g.FillPolygon($manzanaBrush, $pts)
        $g.DrawPolygon($manzanaPen, $pts)
    }
    foreach ($st in $sec.streets) {
        if ($st.path.Count -lt 2) { continue }
        $pts = New-Object System.Drawing.PointF[] $st.path.Count
        for ($i = 0; $i -lt $st.path.Count; $i++) {
            $pt = $st.path[$i]
            $pts[$i] = New-Object System.Drawing.PointF([float]($pcx + [double]$pt[0] * $pscale), [float]($pcy + [double]$pt[1] * $pscale))
        }
        $g.DrawLines($streetPen, $pts)
    }
    foreach ($b in $sec.buildings) {
        if ($b.footprint.Count -lt 3) { continue }
        $pts = New-Object System.Drawing.PointF[] $b.footprint.Count
        for ($i = 0; $i -lt $b.footprint.Count; $i++) {
            $pt = $b.footprint[$i]
            $pts[$i] = New-Object System.Drawing.PointF([float]($pcx + [double]$pt[0] * $pscale), [float]($pcy + [double]$pt[1] * $pscale))
        }
        $floors = [int]$b.levels
        $bBrush = New-Object System.Drawing.SolidBrush (Get-FloorColor $floors)
        $g.FillPolygon($bBrush, $pts)
        $g.DrawPolygon($bldgPen, $pts)
        $bBrush.Dispose()
    }
}

# Arterial Corridors & Metro Line 1 Viaduct
$avCaracasX = [float]($ux + 360)
$craSeptimaX = [float]($ux + 680)
$calle26Y = [float]($uy + 890)
$calle13Y = [float]($uy + 1210)
$calle82Y = [float]($uy + 515)
$calle93Y = [float]($uy + 235)

$corridorPen = New-Object System.Drawing.Pen (Get-Color "#14110C" 200), 10.0
$goldDashPen = New-Object System.Drawing.Pen (Get-Color "#F2A900"), 2.2
$goldDashPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash

# Carrera 7 & Calle 26 & Calle 13 & Calle 82 & Calle 93
$g.DrawLine($corridorPen, $craSeptimaX, ($uy + 30), $craSeptimaX, ($uy + $uh - 30))
$g.DrawLine($goldDashPen, $craSeptimaX, ($uy + 30), $craSeptimaX, ($uy + $uh - 30))
$g.DrawLine($corridorPen, ($ux + 30), $calle26Y, ($ux + $uw - 140), $calle26Y)
$g.DrawLine($corridorPen, ($ux + 30), $calle13Y, ($ux + $uw - 140), $calle13Y)
$g.DrawLine($arterialPen, ($ux + 100), $calle82Y, ($ux + $uw - 150), $calle82Y)
$g.DrawLine($arterialPen, ($ux + 100), $calle93Y, ($ux + $uw - 150), $calle93Y)

# Viaducto Metro Linea 1 (Av. Caracas)
$metroBasePen = New-Object System.Drawing.Pen (Get-Color "#14110C"), 18.0
$metroRedPen = New-Object System.Drawing.Pen (Get-Color "#D9232A"), 10.0
$g.DrawLine($metroBasePen, $avCaracasX, ($uy + 30), $avCaracasX, ($uy + $uh - 30))
$g.DrawLine($metroRedPen, $avCaracasX, ($uy + 30), $avCaracasX, ($uy + $uh - 30))
$g.DrawLine($goldDashPen, $avCaracasX, ($uy + 30), $avCaracasX, ($uy + $uh - 30))

# Elevated Metro Stations
$stationBrush = New-Object System.Drawing.SolidBrush (Get-Color "#2E7D32")
$whitePen = New-Object System.Drawing.Pen (Get-Color "#FFFFFF"), 2.5
$metroStations = @(
    @{ y = $calle93Y; name = "EST. CALLE 93 (NORTE)" },
    @{ y = $calle82Y; name = "EST. CALLE 72 / ZONA T" },
    @{ y = $calle26Y; name = "EST. CENTRO INT. (C.26)" },
    @{ y = ($calle13Y - 55); name = "EST. SAN VICTORINO (L1)" }
)
foreach ($ms in $metroStations) {
    $sy = [float]$ms.y
    $g.FillRectangle($stationBrush, ($avCaracasX - 22), ($sy - 13), 44, 26)
    $g.DrawRectangle($whitePen, ($avCaracasX - 22), ($sy - 13), 44, 26)
    $g.FillRectangle($bgDarkBrush, ($avCaracasX - 215), ($sy - 13), 185, 26)
    $g.DrawString($ms.name, $fontMetro, $goldTextBrush, ($avCaracasX - 208), ($sy - 7))
}

# Sector Tape Labels on Unified Map
foreach ($p in $placements) {
    $pcx = [float]$p.cx
    $pcy = [float]$p.cy
    $rad = [float](210.0 * [float]$p.scale)
    $lx = $pcx - 160
    $ly = $pcy - $rad - 34
    $g.FillRectangle($cintaBrush, $lx, $ly, 320, 30)
    $g.DrawRectangle($borderPenMed, $lx, $ly, 320, 30)
    $g.DrawString($p.label, $fontTape, $darkTextBrush, ($lx + 10), ($ly + 5))
}

# Legend Box at Bottom Left of Unified Map
$legX = $ux + 24; $legY = $uy + $uh - 188; $legW = 685; $legH = 162
$g.FillRectangle($cintaBrush, $legX, $legY, $legW, $legH)
$g.DrawRectangle($borderPenThick, $legX, $legY, $legW, $legH)
$g.DrawString("LEYENDA CARTOGRAFICA OFICIAL IDECA - BAZUKO", $fontLegendTitle, $darkTextBrush, ($legX + 16), ($legY + 10))

$items = @(
    @{ c = "#D8B584"; x = 16; y = 42; t = "Manzana Catastral Oficial (Capa 40 IDECA)" },
    @{ c = "#A67B5B"; x = 16; y = 66; t = "Construccion 1-2 Pisos (Comercio / Casa)" },
    @{ c = "#8B5A2B"; x = 16; y = 90; t = "Construccion 3-11 Pisos (Ladrillo Bogotano)" },
    @{ c = "#F2A900"; x = 16; y = 114; t = "Torres 12-24 Pisos (Financiero / Residencial)" },
    @{ c = "#D9232A"; x = 365; y = 42; t = "Rascacielos +25 Pisos (Colpatria)" },
    @{ c = "#2E7D32"; x = 365; y = 66; t = "Estacion Elevada Metro L1 / Troncal" },
    @{ c = "#14110C"; x = 365; y = 90; t = "Malla Vial Oficial (Capa 13 IDECA)" }
)
foreach ($it in $items) {
    $ib = New-Object System.Drawing.SolidBrush (Get-Color $it.c)
    $g.FillRectangle($ib, ($legX + $it.x), ($legY + $it.y), 20, 14)
    $g.DrawRectangle($bldgPen, ($legX + $it.x), ($legY + $it.y), 20, 14)
    $g.DrawString($it.t, $fontLegend, $darkTextBrush, ($legX + $it.x + 28), ($legY + $it.y - 1))
    $ib.Dispose()
}
$g.DrawString("GEOMETRIA REAL EN MOTOR: 121 Manzanas | 1,000 Edificios con Pisos | 390 Vias Oficiales", $fontLegend, $redTextBrush, ($legX + 16), ($legY + 135))

$g.Restore($uState)

# Render Right Panel: 5 Official IDECA Sector Boxes
Draw-SectorBox $data.sectors.centroInternacional 1200 140 570 475 "SEC-01" "CENTRO INTERNACIONAL" "Torre Colpatria - Cra 7 - Calle 26"
Draw-SectorBox $data.sectors.sanVictorinoCartucho 1800 140 570 475 "SEC-02" "SAN VICTORINO / EL CARTUCHO" "Av. Caracas - Calle 12 - Plaza Mariposa"
Draw-SectorBox $data.sectors.zonaT 1200 642 570 475 "SEC-03" "ZONA T / CALLE 82" "Cra 13 - Calle 82 - Zona Rosa"
Draw-SectorBox $data.sectors.zonaG 1800 642 570 475 "SEC-04" "ZONA G / ROSALES" "Cra 5 - Calle 70 - Mansion Los Reyes"
Draw-SectorBox $data.sectors.parque93 1200 1145 1170 475 "SEC-05" "PARQUE DE LA 93 / CHICO NORTE" "Cra 11A a Cra 13 - Calle 93A a Calle 93B - Trazado Catastral Completo"

$bmp.Save($outArtifactPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save($outPublicPng, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "Saved PNGs successfully: $outArtifactPng and $outPublicPng"
